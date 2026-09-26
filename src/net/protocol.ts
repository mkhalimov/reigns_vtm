// Протокол комнаты: Рассказчик (хост) ↔ устройства игроков. Хост шлёт ТОЛЬКО публичные данные.
import type { PublicState } from '../engine/public';
import type { PublicJournalEntry } from '../engine/journal';
import type { Choice, DecisionMode } from '../engine/votes';
import type { TimerView } from '../channel';

export const PEER_PREFIX = 'rouen-vtm-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(len = 5): string {
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  return [...a].map((x) => ALPHABET[x % ALPHABET.length]).join('');
}

export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface RoomView {
  mode: DecisionMode;
  leaderName: string | null;
  isLeader: boolean;
  myVote: Choice | null;
  votes: { name: string; choice: Choice }[];
  players: number;
  tie: boolean;
}

export type HostMsg =
  | { type: 'state'; pub: PublicState; journal: PublicJournalEntry[]; room: RoomView }
  | { type: 'timer'; timer: TimerView };

export type GuestMsg =
  | { type: 'join'; clientId: string; name: string }
  | { type: 'vote'; cardKey: string; choice: Choice }
  | { type: 'unvote'; cardKey: string };

export function joinUrl(code: string): string {
  return `${location.origin}${location.pathname}#/join/${code}`;
}

/**
 * Сервер знакомств PeerJS. По умолчанию — публичный 0.peerjs.com (сами данные идут напрямую между
 * устройствами). Свой сервер: переменная сборки VITE_PEER_SERVER или localStorage 'rouen-peer-server',
 * формат `https://host:port/path` или `http://localhost:9000/`.
 */
export function peerOptions(): { host?: string; port?: number; path?: string; secure?: boolean; debug: 0 } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem('rouen-peer-server');
  } catch {
    /* нет localStorage */
  }
  raw = raw || (import.meta.env.VITE_PEER_SERVER as string | undefined) || null;
  if (!raw) return { debug: 0 };
  try {
    const u = new URL(raw);
    const secure = u.protocol === 'https:';
    return { host: u.hostname, port: Number(u.port) || (secure ? 443 : 80), path: u.pathname || '/', secure, debug: 0 };
  } catch {
    return { debug: 0 };
  }
}
