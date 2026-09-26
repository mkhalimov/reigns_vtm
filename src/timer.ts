// Таймер карты (ТЗ 3.1, 5.2). Живёт вне истории партии: undo его не трогает.
import { useSyncExternalStore } from 'react';

export interface TimerState {
  key: string | null;
  total: number | null;
  remaining: number | null;
  paused: boolean;
  disabled: boolean;
}

let t: TimerState = { key: null, total: null, remaining: null, paused: false, disabled: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<TimerState>) => {
  t = { ...t, ...patch };
  listeners.forEach((l) => l());
};

export const getTimer = () => t;
export const useTimer = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => t,
  );

/** Новая карта → новый отсчёт. */
export function syncTimer(key: string | null, seconds: number | null): void {
  if (key === t.key) return;
  set({ key, total: seconds, remaining: seconds, paused: false, disabled: false });
}

export const pauseTimer = (paused: boolean) => set({ paused });
export const resetTimer = () => set({ remaining: t.total, paused: false });
export const disableTimer = (disabled: boolean) => set({ disabled });

/** Один тик; возвращает true, если время только что истекло. */
export function tick(): boolean {
  if (t.remaining === null || t.paused || t.disabled || t.remaining <= 0) return false;
  const remaining = t.remaining - 1;
  set({ remaining });
  return remaining === 0;
}
