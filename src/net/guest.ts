// Устройство игрока: подключается к комнате Рассказчика по коду.
import { useSyncExternalStore } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import type { Choice } from '../engine/votes';
import type { PublicState } from '../engine/public';
import type { PublicJournalEntry } from '../engine/journal';
import type { TimerView } from '../channel';
import { PEER_PREFIX, peerOptions, type GuestMsg, type HostMsg, type RoomView } from './protocol';

export interface GuestState {
  status: 'idle' | 'connecting' | 'connected' | 'lost';
  error: string | null;
  code: string;
  name: string;
  pub: PublicState | null;
  journal: PublicJournalEntry[];
  room: RoomView | null;
  timer: TimerView;
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

function saved(): { name: string; code: string } {
  try {
    return { name: '', code: '', ...JSON.parse(localStorage.getItem(LS) ?? '{}') };
  } catch {
    return { name: '', code: '' };
  }
}

let g: GuestState = {
  status: 'idle',
  error: null,
  ...saved(),
  pub: null,
  journal: [],
  room: null,
  timer: { remaining: null, total: null, paused: false },
};
const listeners = new Set<() => void>();
const set = (patch: Partial<GuestState>) => {
  g = { ...g, ...patch };
  listeners.forEach((l) => l());
};
export const useGuest = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => g,
  );

let peer: Peer | null = null;
let conn: DataConnection | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let wanted = false;

export function join(code: string, name: string): void {
  wanted = true;
  try {
    localStorage.setItem(LS, JSON.stringify({ code, name }));
  } catch {
    /* ничего страшного */
  }
  set({ code, name, status: 'connecting', error: null });
  ensurePeer();
}

export function leave(): void {
  wanted = false;
  if (retryTimer) clearTimeout(retryTimer);
  conn?.close();
  peer?.destroy();
  peer = null;
  conn = null;
  set({ status: 'idle', pub: null, room: null });
}

function scheduleRetry(ms = 3000) {
  if (!wanted) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (peer && !peer.destroyed && !peer.disconnected) connect();
    else ensurePeer();
  }, ms);
}

function ensurePeer() {
  if (peer && !peer.destroyed) {
    if (peer.disconnected) peer.reconnect();
    else connect();
    return;
  }
  const p = new Peer(peerOptions());
  peer = p;
  p.on('open', () => connect());
  p.on('disconnected', () => {
    if (wanted && !p.destroyed) setTimeout(() => !p.destroyed && p.reconnect(), 2000);
  });
  p.on('error', (err: { type?: string }) => {
    if (err.type === 'peer-unavailable') {
      set({ status: 'lost', error: 'Комната не найдена. Проверьте код, или Рассказчик ещё не открыл комнату.' });
      scheduleRetry(4000);
    } else if (err.type === 'browser-incompatible') {
      set({ status: 'lost', error: 'Этот браузер не поддерживает WebRTC.' });
    } else {
      set({ status: 'lost', error: 'Нет связи. Переподключаемся…' });
      p.destroy();
      peer = null;
      scheduleRetry(4000);
    }
  });
}

function connect() {
  if (!peer || !wanted) return;
  conn?.close();
  const c = peer.connect(PEER_PREFIX + g.code, { reliable: true });
  conn = c;
  c.on('open', () => {
    set({ status: 'connected', error: null });
    sendRaw({ type: 'join', clientId: clientId(), name: g.name });
  });
  c.on('data', (raw) => {
    const msg = raw as HostMsg;
    if (msg.type === 'state') set({ pub: msg.pub, journal: msg.journal, room: msg.room });
    else if (msg.type === 'timer') set({ timer: msg.timer });
  });
  c.on('close', () => {
    if (conn !== c) return;
    set({ status: 'lost', error: 'Связь с Рассказчиком потеряна. Переподключаемся…' });
    scheduleRetry();
  });
}

function sendRaw(msg: GuestMsg) {
  if (conn?.open) void conn.send(msg);
}

/** Повторное нажатие на свой вариант снимает голос. */
export function vote(choice: Choice): void {
  const key = g.pub?.cardKey;
  if (!key) return;
  if (g.room?.myVote === choice) sendRaw({ type: 'unvote', cardKey: key });
  else sendRaw({ type: 'vote', cardKey: key, choice });
}

// телефон уснул и проснулся — сразу пробуем восстановить связь
if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted && g.status !== 'connected') scheduleRetry(100);
  });
