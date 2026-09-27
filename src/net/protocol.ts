// Протокол комнаты: Рассказчик (хост) ↔ устройства игроков через публичный MQTT-ретранслятор.
// Хост шлёт ТОЛЬКО публичные данные, всё шифруется ключом из кода комнаты (см. crypto.ts).
import type { PublicState } from '../engine/public';
import type { PublicJournalEntry } from '../engine/journal';
import type { Choice, DecisionMode } from '../engine/votes';
import type { TimerView } from '../channel';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(len = 5): string {
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  return [...a].map((x) => ALPHABET[x % ALPHABET.length]).join('');
}

export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Публичные MQTT-брокеры (WebSocket по TLS). Хост берёт первый доступный, номер попадает в ссылку/QR.
 * Свой брокер: переменная сборки VITE_MQTT_URL или localStorage 'rouen-mqtt-url'.
 */
export function brokers(): string[] {
  let custom: string | null = null;
  try {
    custom = localStorage.getItem('rouen-mqtt-url');
  } catch {
    /* нет localStorage */
  }
  custom = custom || (import.meta.env.VITE_MQTT_URL as string | undefined) || null;
  if (custom) return [custom];
  return ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
}

export const topics = (roomTopic: string) => ({
  state: `rouen-vtm/v1/${roomTopic}/state`,
  up: `rouen-vtm/v1/${roomTopic}/up`,
});

export interface Seat {
  id: string;
  name: string;
  /** clientId устройства, занявшего персонажа. */
  holder: string | null;
  online: boolean;
}

export interface RoomInfo {
  mode: DecisionMode;
  leaderSeat: string | null;
  seats: Seat[];
  votes: { seat: string; choice: Choice }[];
  tie: boolean;
}

export type HostMsg =
  | { type: 'state'; t: number; pub: PublicState; journal: PublicJournalEntry[]; room: RoomInfo }
  | { type: 'timer'; t: number; timer: TimerView }
  | { type: 'hb'; t: number }
  | { type: 'closed' };

export type GuestMsg =
  | { type: 'join'; clientId: string; seat: string }
  | { type: 'vote'; clientId: string; cardKey: string; choice: Choice }
  | { type: 'unvote'; clientId: string; cardKey: string }
  | { type: 'ping'; clientId: string }
  | { type: 'leave'; clientId: string };

/** Вид комнаты для конкретного игрока (вычисляется на его устройстве). */
export interface RoomView {
  mode: DecisionMode;
  leaderName: string | null;
  isLeader: boolean;
  myVote: Choice | null;
  votes: { name: string; choice: Choice }[];
  players: number;
  tie: boolean;
}

export function roomViewFor(room: RoomInfo, clientId: string): RoomView {
  const mySeat = room.seats.find((s) => s.holder === clientId)?.id ?? null;
  const name = (id: string) => room.seats.find((s) => s.id === id)?.name ?? '?';
  return {
    mode: room.mode,
    leaderName: room.leaderSeat ? name(room.leaderSeat) : null,
    isLeader: !!mySeat && room.leaderSeat === mySeat,
    myVote: room.votes.find((v) => v.seat === mySeat)?.choice ?? null,
    votes: room.votes.map((v) => ({ name: name(v.seat), choice: v.choice })),
    players: room.seats.filter((s) => s.online).length,
    tie: room.tie,
  };
}

export function joinUrl(code: string, broker: number): string {
  return `${location.origin}${location.pathname}#/join/${code}${broker ? `/${broker}` : ''}`;
}

export const HEARTBEAT_MS = 5000;
export const PING_MS = 8000;
export const OFFLINE_AFTER_MS = 22000;
