// Комната Рассказчика: связь с телефонами игроков через публичный MQTT-ретранслятор (WebSocket по TLS).
// Партия живёт только в браузере GM; устройства игроков получают PublicState, журнал «что решили» и голоса.
// Всё зашифровано ключом из кода комнаты, ретранслятор видит только шифротекст.
import { useSyncExternalStore } from 'react';
import mqtt, { type MqttClient } from 'mqtt';
import type { Choice, Vote } from '../engine/votes';
import type { PublicState } from '../engine/public';
import type { PublicJournalEntry } from '../engine/journal';
import type { TimerView } from '../channel';
import { deviceKey, open, roomKey, seal, type RoomKey } from './crypto';
import { canVote, type Deciders } from '../engine/votes';
import type { PublicCard } from '../engine/public';
import {
  brokers,
  HEARTBEAT_MS,
  OFFLINE_AFTER_MS,
  privateTopic,
  randomCode,
  topics,
  type GuestMsg,
  type HostMsg,
  type PrivateMsg,
  type RoomInfo,
  type Seat,
} from './protocol';

export type HostSeat = Seat;

/** Когда место последний раз подавало голос/пинг (вне стора, чтобы пинги не вызывали рассылку). */
const lastSeen = new Map<string, number>();

export interface HostState {
  status: 'off' | 'opening' | 'open' | 'error';
  code: string | null;
  broker: number;
  error: string | null;
  seats: HostSeat[];
  /** Голоса по id мест (персонажей). */
  votes: Vote[];
  voteKey: string | null;
  leaderId: string | null;
}

const LS_KEY = 'rouen-room';
const JOURNAL_LIMIT = 120;

let h: HostState = { status: 'off', code: null, broker: 0, error: null, seats: [], votes: [], voteKey: null, leaderId: null };
const listeners = new Set<() => void>();
function set(patch: Partial<HostState>) {
  h = { ...h, ...patch };
  listeners.forEach((l) => l());
  onChange?.();
}

export const getHost = () => h;
export const useHost = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => h,
  );

/** Хуки App: пришёл голос / изменился состав — пересчитать решение и разослать состояние. */
let onChange: (() => void) | null = null;
let onVote: (() => void) | null = null;
export function setHostHandlers(handlers: { onVote: () => void; onChange: () => void }) {
  onVote = handlers.onVote;
  onChange = handlers.onChange;
}

let client: MqttClient | null = null;
let key: RoomKey | null = null;
let session = 0;
let hbTimer: ReturnType<typeof setInterval> | null = null;
/** Секреты устройств (clientId → ключ личного канала). Игрокам не рассылаются. */
let secrets: Record<string, string> = {};

function remember() {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        open: h.status !== 'off',
        code: h.code,
        broker: h.broker,
        leaderId: h.leaderId,
        seats: h.seats.map((s) => ({ ...s, online: false })),
        secrets,
      }),
    );
  } catch {
    /* нет localStorage — комната просто не переоткроется сама */
  }
}

/** Персонажи из колоды — места для игроков. Занятость сохраняется, если id совпадают. */
export function setSeats(chars: { id: string; name: string }[]): void {
  const seats = chars.map((c) => {
    const old = h.seats.find((s) => s.id === c.id);
    return { id: c.id, name: c.name, holder: old?.holder ?? null, online: old?.online ?? false };
  });
  if (JSON.stringify(seats) === JSON.stringify(h.seats)) return;
  // без remember(): при загрузке это вызывается до restoreRoom и затёрло бы сохранённую комнату
  set({ seats, votes: h.votes.filter((v) => seats.some((s) => s.id === v.playerId)) });
}

export function restoreRoom(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null');
    if (!saved) return;
    const seats: HostSeat[] = Array.isArray(saved.seats) ? saved.seats : [];
    secrets = saved.secrets && typeof saved.secrets === 'object' ? saved.secrets : {};
    h = {
      ...h,
      leaderId: saved.leaderId ?? null,
      code: saved.code ?? null,
      broker: saved.broker ?? 0,
      seats: h.seats.map((s) => ({ ...s, holder: seats.find((x) => x.id === s.id)?.holder ?? null })),
    };
    if (saved.open && saved.code) void openRoom(saved.code);
  } catch {
    /* повреждённая запись — игнорируем */
  }
}

function stopClient(): void {
  session++;
  if (hbTimer) clearInterval(hbTimer);
  hbTimer = null;
  client?.end(true);
  client = null;
}

export async function openRoom(code: string = h.code ?? randomCode()): Promise<void> {
  stopClient();
  const my = session;
  set({ status: 'opening', code, error: null });
  remember();
  key = await roomKey(code);
  if (my !== session) return;
  const list = brokers();
  const start = h.code === code && h.broker < list.length ? h.broker : 0;
  tryBroker(my, list, start, 0);
}

function tryBroker(my: number, list: string[], idx: number, attempt: number): void {
  if (my !== session) return;
  const url = list[idx % list.length];
  const t = topics(key!.topic);
  const c = mqtt.connect(url, {
    clientId: `rouen-h-${randomCode(8)}`,
    clean: true,
    connectTimeout: 8000,
    reconnectPeriod: 3000,
    keepalive: 30,
  });
  client = c;
  let everConnected = false;
  const giveUp = setTimeout(() => {
    if (everConnected || my !== session) return;
    c.end(true);
    const next = attempt + 1;
    set({ error: `Ретранслятор ${new URL(url).hostname} недоступен, пробуем другой…` });
    if (next >= list.length * 2) set({ status: 'error', error: 'Не удалось подключиться ни к одному ретранслятору. Проверьте интернет (VPN не мешает).' });
    else tryBroker(my, list, idx + 1, next);
  }, 10000);

  c.on('connect', () => {
    if (my !== session) return;
    everConnected = true;
    clearTimeout(giveUp);
    c.subscribe(t.up, { qos: 1 });
    set({ status: 'open', error: null, broker: idx % list.length });
    remember();
    republish();
    void pushSecret(true);
    if (hbTimer) clearInterval(hbTimer);
    hbTimer = setInterval(() => {
      void publish({ type: 'hb', t: Date.now() });
      sweep();
    }, HEARTBEAT_MS);
  });
  c.on('reconnect', () => {
    if (my === session && everConnected) set({ status: 'opening', error: 'Связь с ретранслятором потеряна, переподключаемся…' });
  });
  c.on('message', (_topic, payload) => {
    if (my !== session || !key) return;
    void open<GuestMsg>(key, new Uint8Array(payload)).then((msg) => msg && handle(msg));
  });
}

async function publish(msg: HostMsg, retain = false): Promise<void> {
  if (!client || !key || !client.connected) return;
  const t = topics(key.topic);
  const data = await seal(key, msg);
  client.publish(t.state, data as unknown as Buffer, { qos: retain ? 1 : 0, retain });
}

function handle(msg: GuestMsg): void {
  const now = Date.now();
  const clientId = String(msg.clientId ?? '').slice(0, 64);
  if (!clientId) return;
  const touch = () => {
    const seat = h.seats.find((s) => s.holder === clientId);
    if (!seat) return null;
    lastSeen.set(seat.id, now);
    if (!seat.online) set({ seats: h.seats.map((s) => (s === seat ? { ...s, online: true } : s)) });
    return seat;
  };
  switch (msg.type) {
    case 'join': {
      learnSecret(clientId, msg.secret);
      const seat = h.seats.find((s) => s.id === msg.seat);
      if (!seat) return;
      // занятое кем-то другим место, пока тот на связи, не отдаём
      if (seat.holder && seat.holder !== clientId && seat.online) return republish();
      set({
        seats: h.seats.map((s) =>
          s.id === seat.id
            ? { ...s, holder: clientId, online: true }
            : s.holder === clientId
              ? { ...s, holder: null, online: false }
              : s,
        ),
        votes: h.votes.filter((v) => v.playerId !== seat.id || seat.holder === clientId),
      });
      lastSeen.set(seat.id, now);
      remember();
      onVote?.();
      void pushSecret(true);
      return;
    }
    case 'ping':
      learnSecret(clientId, msg.secret);
      touch();
      return;
    case 'leave': {
      const seat = h.seats.find((s) => s.holder === clientId);
      if (seat) {
        set({ seats: h.seats.map((s) => (s === seat ? { ...s, online: false } : s)) });
        onVote?.();
      }
      return;
    }
    case 'vote':
    case 'unvote': {
      const seat = touch();
      if (!seat || msg.cardKey !== h.voteKey) return;
      // личная/спорная карта: голос не адресата не принимается
      if (msg.type === 'vote' && !canVote(seat.id, restrict, h.votes)) return;
      const rest = h.votes.filter((v) => v.playerId !== seat.id);
      if (msg.type === 'vote' && isChoice(msg.choice)) set({ votes: [...rest, { playerId: seat.id, choice: msg.choice }] });
      else set({ votes: rest });
      onVote?.();
      return;
    }
  }
}

const isChoice = (c: unknown): c is Choice => c === 'left' || c === 'right' || c === 'escalate' || c === 'ack';

/** Молчащие дольше OFFLINE_AFTER_MS считаются отключившимися. */
function sweep(): void {
  const now = Date.now();
  const stale = (s: HostSeat) => s.online && now - (lastSeen.get(s.id) ?? 0) > OFFLINE_AFTER_MS;
  if (!h.seats.some(stale)) return;
  set({ seats: h.seats.map((s) => (stale(s) ? { ...s, online: false } : s)) });
  onVote?.();
}

export function closeRoom(): void {
  const c = client;
  const k = key;
  if (c?.connected && k) {
    // стираем сохранённое состояние на ретрансляторе и сообщаем игрокам
    const t = topics(k.topic);
    void seal(k, { type: 'closed' } satisfies HostMsg).then((d) => {
      c.publish(t.state, d as unknown as Buffer, { qos: 0 });
      c.publish(t.state, '', { retain: true, qos: 1 }, () => c.end());
    });
    client = null;
    session++;
    if (hbTimer) clearInterval(hbTimer);
    hbTimer = null;
  } else stopClient();
  set({ status: 'off', error: null, seats: h.seats.map((s) => ({ ...s, online: false })), votes: [] });
  remember();
}

export function newCode(): void {
  closeRoom();
  set({ seats: h.seats.map((s) => ({ ...s, holder: null, online: false })), leaderId: null, broker: 0 });
  void openRoom(randomCode());
}

export function setLeader(id: string | null): void {
  set({ leaderId: id });
  remember();
  onVote?.();
}

/** Освободить место (игрок сменил устройство или ушёл). */
export function freeSeat(id: string): void {
  set({
    seats: h.seats.map((s) => (s.id === id ? { ...s, holder: null, online: false } : s)),
    votes: h.votes.filter((v) => v.playerId !== id),
  });
  remember();
  onVote?.();
}

/** Новая карта → голоса обнуляются. */
export function resetVotes(k: string | null): void {
  if (k === h.voteKey) return;
  set({ voteKey: k, votes: [] });
}

export const connectedIds = () => h.seats.filter((s) => s.online).map((s) => s.id);

// ---------- рассылка ----------

let last: { pub: PublicState; journal: PublicJournalEntry[]; mode: RoomInfo['mode']; tie: boolean } | null = null;
/** Кто вправе решать текущую карту. */
let restrict: Deciders | null = null;

function roomInfo(): RoomInfo {
  const secretCard = !!last!.pub.card?.secret;
  return {
    mode: last!.mode,
    leaderSeat: h.leaderId,
    seats: h.seats,
    // по секретной карте не показываем, кто за что проголосовал
    votes: secretCard ? [] : h.votes.map((v) => ({ seat: v.playerId, choice: v.choice })),
    tie: last!.tie,
  };
}

function learnSecret(clientId: string, secret: unknown): void {
  if (typeof secret !== 'string' || secret.length < 20 || secret.length > 80 || secrets[clientId] === secret) return;
  secrets[clientId] = secret;
  remember();
  void pushSecret(true);
}

// ---------- личный канал: секретные карты ----------

let secretWanted: { seat: string; cardKey: string; card: PublicCard } | null = null;
let secretSent: { clientId: string; cardKey: string } | null = null;

async function sendPrivate(clientId: string, msg: PrivateMsg): Promise<void> {
  const sec = secrets[clientId];
  if (!sec || !client?.connected || !key) return;
  const dk = await deviceKey(sec);
  client.publish(privateTopic(key.topic, dk.topic), (await seal(dk, msg)) as unknown as Buffer, { qos: 1, retain: true });
}

async function pushSecret(force = false): Promise<void> {
  const holder = secretWanted ? h.seats.find((s) => s.id === secretWanted!.seat)?.holder ?? null : null;
  const want = secretWanted && holder ? { clientId: holder, cardKey: secretWanted.cardKey } : null;
  if (!force && JSON.stringify(want) === JSON.stringify(secretSent)) return;
  if (secretSent && (!want || want.clientId !== secretSent.clientId)) await sendPrivate(secretSent.clientId, { type: 'secret', cardKey: null });
  if (want && secretWanted) await sendPrivate(want.clientId, { type: 'secret', cardKey: secretWanted.cardKey, card: secretWanted.card });
  secretSent = want;
}

/** Текущая секретная карта (или null) — уходит только на телефон адресата. */
export function setSecretCard(s: { seat: string; cardKey: string; card: PublicCard } | null): void {
  secretWanted = s;
  void pushSecret();
}

function republish(): void {
  if (!last) return;
  void publish({ type: 'state', t: Date.now(), pub: last.pub, journal: last.journal.slice(-JOURNAL_LIMIT), room: roomInfo() }, true);
}

export function broadcastState(pub: PublicState, journal: PublicJournalEntry[], mode: RoomInfo['mode'], tie: boolean): void {
  last = { pub, journal, mode, tie };
  restrict = pub.card?.restrict ?? null;
  republish();
}

let lastTimerSent = '';
export function broadcastTimer(timer: TimerView): void {
  const s = JSON.stringify(timer);
  if (s === lastTimerSent) return;
  lastTimerSent = s;
  void publish({ type: 'timer', t: Date.now(), timer });
}
