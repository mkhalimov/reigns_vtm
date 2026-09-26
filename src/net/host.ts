// Комната Рассказчика: принимает подключения игроков по WebRTC (PeerJS) и рассылает публичную проекцию.
// Партия живёт только в браузере GM; устройства игроков получают PublicState, журнал «что решили» и голоса.
import { useSyncExternalStore } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import type { Choice, Vote } from '../engine/votes';
import type { PublicState } from '../engine/public';
import type { PublicJournalEntry } from '../engine/journal';
import type { TimerView } from '../channel';
import { PEER_PREFIX, peerOptions, randomCode, type GuestMsg, type HostMsg, type RoomView } from './protocol';

export interface RoomPlayer {
  id: string;
  name: string;
  connected: boolean;
}

export interface HostState {
  status: 'off' | 'opening' | 'open' | 'error';
  code: string | null;
  error: string | null;
  players: RoomPlayer[];
  votes: Vote[];
  voteKey: string | null;
  leaderId: string | null;
}

const LS_KEY = 'rouen-room';

let h: HostState = { status: 'off', code: null, error: null, players: [], votes: [], voteKey: null, leaderId: null };
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

let peer: Peer | null = null;
const conns = new Map<string, DataConnection>();
let retries = 0;

/** Хук App: пришёл голос или изменился состав — пересчитать решение. */
let onChange: (() => void) | null = null;
let onVote: (() => void) | null = null;
export function setHostHandlers(handlers: { onVote: () => void; onChange: () => void }) {
  onVote = handlers.onVote;
  onChange = handlers.onChange;
}

function remember() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ open: h.status === 'open' || h.status === 'opening', code: h.code, leaderId: h.leaderId, players: h.players.map((p) => ({ ...p, connected: false })) }));
  } catch {
    /* нет localStorage — комната просто не переоткроется сама */
  }
}

export function restoreRoom(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null');
    if (!saved) return;
    h = { ...h, leaderId: saved.leaderId ?? null, players: saved.players ?? [], code: saved.code ?? null };
    if (saved.open && saved.code) openRoom(saved.code);
  } catch {
    /* повреждённая запись — игнорируем */
  }
}

export function openRoom(code: string = h.code ?? randomCode()): void {
  closePeer();
  set({ status: 'opening', code, error: null });
  remember();
  const p = new Peer(PEER_PREFIX + code, peerOptions());
  peer = p;
  p.on('open', () => {
    retries = 0;
    set({ status: 'open', error: null });
    remember();
  });
  p.on('connection', (conn) => attach(conn));
  p.on('disconnected', () => {
    // потеряна связь с сервером знакомств; уже установленные соединения продолжают работать
    if (peer === p && !p.destroyed) setTimeout(() => !p.destroyed && p.reconnect(), 2000);
  });
  p.on('error', (err: { type?: string; message?: string }) => {
    if (peer !== p) return;
    if (err.type === 'unavailable-id' && retries < 6) {
      // после перезагрузки страницы старая регистрация кода держится ещё несколько секунд
      retries++;
      set({ status: 'opening', error: 'Код ещё занят прошлой сессией, повторяем…' });
      setTimeout(() => peer === p && openRoom(code), 4000);
      return;
    }
    if (err.type === 'peer-unavailable') return;
    set({ status: 'error', error: describe(err) });
  });
}

function describe(err: { type?: string; message?: string }): string {
  switch (err.type) {
    case 'unavailable-id':
      return 'Этот код занят. Нажмите «Новый код».';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Нет связи с сервером знакомств (нужен интернет для открытия комнаты).';
    case 'browser-incompatible':
      return 'Браузер не поддерживает WebRTC.';
    default:
      return err.message ?? String(err.type ?? 'ошибка');
  }
}

function attach(conn: DataConnection) {
  let clientId: string | null = null;
  conn.on('data', (raw) => {
    const msg = raw as GuestMsg;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'join') {
      clientId = String(msg.clientId).slice(0, 64);
      const name = String(msg.name ?? '').trim().slice(0, 40) || 'Игрок';
      const old = conns.get(clientId);
      if (old && old !== conn) old.close();
      conns.set(clientId, conn);
      const exists = h.players.some((pl) => pl.id === clientId);
      set({
        players: exists
          ? h.players.map((pl) => (pl.id === clientId ? { ...pl, name, connected: true } : pl))
          : [...h.players, { id: clientId, name, connected: true }],
      });
      remember();
      sendTo(clientId);
      return;
    }
    if (!clientId) return;
    if (msg.type === 'vote' && msg.cardKey === h.voteKey && isChoice(msg.choice)) {
      set({ votes: [...h.votes.filter((v) => v.playerId !== clientId), { playerId: clientId, choice: msg.choice }] });
      onVote?.();
    } else if (msg.type === 'unvote' && msg.cardKey === h.voteKey) {
      set({ votes: h.votes.filter((v) => v.playerId !== clientId) });
    }
  });
  conn.on('close', () => {
    if (!clientId || conns.get(clientId) !== conn) return;
    conns.delete(clientId);
    set({ players: h.players.map((pl) => (pl.id === clientId ? { ...pl, connected: false } : pl)) });
    onVote?.(); // в голосовании могли остаться только проголосовавшие
  });
}

const isChoice = (c: unknown): c is Choice => c === 'left' || c === 'right' || c === 'escalate' || c === 'ack';

function closePeer() {
  conns.forEach((c) => c.close());
  conns.clear();
  if (peer && !peer.destroyed) peer.destroy();
  peer = null;
}

export function closeRoom(): void {
  closePeer();
  set({ status: 'off', error: null, players: h.players.map((p) => ({ ...p, connected: false })), votes: [] });
  remember();
}

export function newCode(): void {
  openRoom(randomCode());
}

export function setLeader(id: string | null): void {
  set({ leaderId: id });
  remember();
  onVote?.();
}

export function removePlayer(id: string): void {
  conns.get(id)?.close();
  conns.delete(id);
  set({ players: h.players.filter((p) => p.id !== id), votes: h.votes.filter((v) => v.playerId !== id), leaderId: h.leaderId === id ? null : h.leaderId });
  remember();
}

/** Новая карта → голоса обнуляются. */
export function resetVotes(key: string | null): void {
  if (key === h.voteKey) return;
  set({ voteKey: key, votes: [] });
}

export const connectedIds = () => h.players.filter((p) => p.connected).map((p) => p.id);

// ---------- рассылка ----------

let last: { pub: PublicState; journal: PublicJournalEntry[]; mode: RoomView['mode']; tie: boolean } | null = null;

function roomView(forId: string): RoomView {
  const name = (id: string) => h.players.find((p) => p.id === id)?.name ?? '?';
  return {
    mode: last!.mode,
    leaderName: h.leaderId ? name(h.leaderId) : null,
    isLeader: h.leaderId === forId,
    myVote: h.votes.find((v) => v.playerId === forId)?.choice ?? null,
    votes: h.votes.filter((v) => conns.has(v.playerId)).map((v) => ({ name: name(v.playerId), choice: v.choice })),
    players: conns.size,
    tie: last!.tie,
  };
}

function send(conn: DataConnection, msg: HostMsg) {
  try {
    if (conn.open) void conn.send(msg);
  } catch {
    /* соединение закрывается — игрок переподключится */
  }
}

function sendTo(id: string) {
  const c = conns.get(id);
  if (!c || !last) return;
  send(c, { type: 'state', pub: last.pub, journal: last.journal, room: roomView(id) });
  if (lastTimer) send(c, { type: 'timer', timer: lastTimer });
}

export function broadcastState(pub: PublicState, journal: PublicJournalEntry[], mode: RoomView['mode'], tie: boolean): void {
  last = { pub, journal, mode, tie };
  conns.forEach((_, id) => sendTo(id));
}

let lastTimer: TimerView | null = null;
export function broadcastTimer(timer: TimerView): void {
  lastTimer = timer;
  conns.forEach((c) => send(c, { type: 'timer', timer }));
}
