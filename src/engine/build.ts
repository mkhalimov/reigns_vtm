// Автосборка интерлюдии (ТЗ 5.3).
import type { Card, DeckData, GameState } from './types';
import { duePending, type Rng } from './game';
import { isAvailable } from './rules';

const LINE_DECKS = new Set(['deruan', 'night', 'gates', 'court']);

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Приоритет карт линий: рекомендованные на эту интерлюдию, открытые флагами, «догоняющие». */
function linePriority(c: Card, interlude: number): number {
  let p = 0;
  if (c.interlude === interlude) p += 4;
  else if (c.interlude !== undefined && c.interlude < interlude) p += 3;
  else if (c.interlude !== undefined && c.interlude > interlude) p -= 5;
  if (c.requires?.length) p += 2;
  return p;
}

export interface BuildResult {
  queue: string[];
  notes: string[];
}

export function autobuild(s: GameState, deck: DeckData, rng: Rng = Math.random): BuildResult {
  const n = s.interlude.number;
  const { routine, lines, mirror, omen } = s.settings.autobuild;
  const notes: string[] = [];
  const due = duePending(s).map((p) => p.card);
  const taken = new Set(due);
  const pool = deck.cards.filter((c) => isAvailable(c, s) && !taken.has(c.id));

  const take = (cands: Card[], count: number, label: string): Card[] => {
    const got = cands.filter((c) => !taken.has(c.id)).slice(0, Math.max(0, count));
    got.forEach((c) => taken.add(c.id));
    if (got.length < count) notes.push(`${label}: доступно только ${got.length} из ${count}`);
    return got;
  };
  const byDeck = (d: string) =>
    shuffle(
      pool.filter((c) => c.deck === d),
      rng,
    ).sort((a, b) => linePriority(b, n) - linePriority(a, n));

  const routineCards = take(byDeck('routine'), routine, 'Рутина');
  const lineCards = take(
    shuffle(
      pool.filter((c) => LINE_DECKS.has(c.deck)),
      rng,
    ).sort((a, b) => linePriority(b, n) - linePriority(a, n)),
    lines,
    'Линии',
  );
  const mirrorCards = take(byDeck('mirror'), mirror, 'Зеркало');
  const omenCards = take(byDeck('omen'), omen, 'Знамения');

  // Порядок: знамение открывает сезон, зеркало — ближе к концу, остальное вперемешку
  const middle = shuffle([...routineCards, ...lineCards, ...due.map((id) => deck.cards.find((c) => c.id === id)!).filter(Boolean)], rng);
  const at = Math.max(0, middle.length - 1 - Math.floor(rng() * 2));
  middle.splice(at, 0, ...mirrorCards);
  const queue = [...omenCards, ...middle].map((c) => c.id);
  if (due.length) notes.push(`Обязательные отложенные карты: ${due.join(', ')}`);
  return { queue, notes };
}
