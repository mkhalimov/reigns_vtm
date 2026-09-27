// Устройство игрока: находит комнату по коду на публичном ретрансляторе, выбирает персонажа, голосует.
import { useSyncExternalStore } from 'react';
import mqtt, { type MqttClient } from 'mqtt';
import type { Choice } from '../engine/votes';
import type { PublicState } from '../engine/public';
import type { PublicJournalEntry } from '../engine/journal';
import type { TimerView } from '../channel';
import { open, roomKey, seal, type RoomKey } from './crypto';
import { brokers, PING_MS, randomCode, topics, type GuestMsg, type HostMsg, type RoomInfo } from './protocol';

export interface GuestState {
  /** idle — ввод кода; connecting — связь с ретранслятором; searching — ищем комнату; connected — комната найдена. */
  status: 'idle' | 'connecting' | 'searching' | 'connected';
  stage: string;
  error: string | null;
  code: string;
  clientId: string;
  pub: PublicState | null;
  journal: PublicJournalEntry[];
  room: RoomInfo | null;
  timer: TimerView;
  /** Рассказчик давно молчит. */
  hostSilent: boolean;
  closed: boolean;
}

const LS = 'rouen-guest';

function clientId(): string {
  try {
    let id = localStorage.getItem('rouen-client-id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('rouen-client-id', id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function savedCode(): string {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '{}').code ?? '';
  } catch {
    return '';
  }
}

let g: GuestState = {
  status: 'idle',
  stage: '',
  error: null,
  code: savedCode(),
  clientId: clientId(),
  pub: null,
  journal: [],
  room: null,
  timer: { remaining: null, total: null, paused: false },
  hostSilent: false,
  closed: false,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<GuestState>) => {
  g = { ...g, ...patch };
  listeners.forEach((l) => l());
};
export const getGuest = () => g;
export const useGuest = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => g,
  );

let client: MqttClient | null = null;
let key: RoomKey | null = null;
let session = 0;
let lastHostMsg = 0;
let willPayload: Uint8Array = new Uint8Array();
let timers: ReturnType<typeof setInterval>[] = [];

function stop() {
  session++;
  timers.forEach(clearInterval);
  timers = [];
  client?.end(true);
  client = null;
}

export async function join(code: string, brokerHint = 0): Promise<void> {
  stop();
  const my = session;
  try {
    localStorage.setItem(LS, JSON.stringify({ code }));
  } catch {
    /* ничего страшного */
  }
  set({ code, status: 'connecting', stage: 'Подключаемся к ретранслятору…', error: null, pub: null, room: null, closed: false });
  if (!crypto?.subtle) {
    set({ status: 'idle', error: 'Браузер не поддерживает шифрование. Откройте сайт по https.' });
    return;
  }
  key = await roomKey(code);
  // «Последняя воля» — ретранслятор сам сообщит хосту, если телефон пропадёт
  willPayload = await seal(key, { type: 'leave', clientId: g.clientId } satisfies GuestMsg);
  if (my !== session) return;
  const list = brokers();
  tryBroker(my, list, brokerHint % list.length, 0);
  timers.push(
    setInterval(() => {
      if (my !== session) return;
      const silent = g.status === 'connected' && Date.now() - lastHostMsg > 20000;
      if (silent !== g.hostSilent) set({ hostSilent: silent });
    }, 3000),
  );
  timers.push(
    setInterval(() => {
      if (my === session && g.room?.seats.some((s) => s.holder === g.clientId)) void send({ type: 'ping', clientId: g.clientId });
    }, PING_MS),
  );
}

function tryBroker(my: number, list: string[], idx: number, attempt: number): void {
  if (my !== session || !key) return;
  const url = list[idx % list.length];
  const host = new URL(url).hostname;
  const t = topics(key.topic);
  const will = { topic: t.up, payload: willPayload as unknown as Buffer, qos: 0 as const, retain: false };
  const c = mqtt.connect(url, {
    clientId: `rouen-g-${randomCode(8)}`,
    clean: true,
    connectTimeout: 8000,
    reconnectPeriod: 3000,
    keepalive: 30,
    will,
  });
  client = c;
  let found = false;

  const next = (why: string) => {
    if (found || my !== session) return;
    c.end(true);
    const n = attempt + 1;
    const cycled = n >= list.length;
    set({
      status: 'searching',
      stage: why,
      error: cycled ? 'Комната не найдена. Проверьте код и что Рассказчик открыл комнату. Продолжаем искать…' : null,
    });
    setTimeout(() => tryBroker(my, list, idx + 1, n), cycled ? 3000 : 0);
  };
  const connectTimer = setTimeout(() => !c.connected && next(`${host} недоступен, пробуем другой…`), 10000);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  c.on('connect', () => {
    if (my !== session) return;
    clearTimeout(connectTimer);
    c.subscribe(t.state, { qos: 1 });
    if (!found) {
      set({ status: 'searching', stage: `Ищем комнату ${g.code}…` });
      // хост шлёт сердцебиение каждые 5 с и хранит состояние на ретрансляторе
      searchTimer = setTimeout(() => next(`На ${host} комнаты нет, пробуем другой ретранслятор…`), 8000);
    }
  });
  c.on('message', (_topic, payload) => {
    if (my !== session || !key || !payload.length) return;
    void open<HostMsg>(key, new Uint8Array(payload)).then((msg) => {
      if (!msg || my !== session) return;
      if (msg.type === 'closed') {
        set({ closed: true, pub: null });
        return;
      }
      // сохранённое на ретрансляторе состояние могло остаться от закрытой сессии — ждём живого сигнала
      const fresh = msg.type !== 'state' || Date.now() - msg.t < 60000;
      if (fresh) {
        lastHostMsg = Date.now();
        if (!found) {
          found = true;
          if (searchTimer) clearTimeout(searchTimer);
          set({ status: 'connected', stage: '', error: null, closed: false, hostSilent: false });
        }
      }
      if (msg.type === 'state') set({ pub: msg.pub, journal: msg.journal, room: msg.room });
      else if (msg.type === 'timer') set({ timer: msg.timer });
    });
  });
  c.on('reconnect', () => {
    if (my === session && found) set({ stage: 'Связь прервалась, переподключаемся…' });
  });
  c.on('connect', () => {
    if (my === session && found) set({ stage: '' });
  });
}

async function send(msg: GuestMsg): Promise<void> {
  if (!client?.connected || !key) return;
  client.publish(topics(key.topic).up, (await seal(key, msg)) as unknown as Buffer, { qos: 1 });
}

export function leave(): void {
  void send({ type: 'leave', clientId: g.clientId });
  setTimeout(stop, 300);
  set({ status: 'idle', pub: null, room: null, stage: '', error: null });
}

export function pickSeat(seat: string): void {
  void send({ type: 'join', clientId: g.clientId, seat });
}

export function mySeat(): string | null {
  return g.room?.seats.find((s) => s.holder === g.clientId)?.id ?? null;
}

/** Повторное нажатие на свой вариант снимает голос. */
export function vote(choice: Choice): void {
  const cardKey = g.pub?.cardKey;
  const seat = mySeat();
  if (!cardKey || !seat) return;
  const mine = g.room?.votes.find((v) => v.seat === seat)?.choice;
  void send(mine === choice ? { type: 'unvote', clientId: g.clientId, cardKey } : { type: 'vote', clientId: g.clientId, cardKey, choice });
}
