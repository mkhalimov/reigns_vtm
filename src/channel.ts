// Второе окно на том же устройстве (ТВ/проектор): получает ТОЛЬКО публичную проекцию.
import type { PublicState } from './engine/public';
import type { PublicJournalEntry } from './engine/journal';
import type { Side } from './engine/types';

export interface TimerView {
  remaining: number | null;
  total: number | null;
  paused: boolean;
}

export type ToPlayers = { type: 'state'; pub: PublicState; timer: TimerView; journal: PublicJournalEntry[] };
export type FromPlayers =
  | { type: 'hello' }
  | { type: 'choose'; side: Side; cardKey: string }
  | { type: 'escalate'; cardKey: string }
  | { type: 'ack'; cardKey: string };

export const CHANNEL = 'rouen-table';

export function openChannel(): BroadcastChannel | null {
  try {
    return new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}
