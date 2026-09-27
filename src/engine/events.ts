// Пул случайных событий: бросок в начале интерлюдии (d100 + модификаторы, затем кубик уровня).
import { CRISIS_TRACKS, type Card, type DeckData, type EventRoll, type EventTier, type GameState } from './types';
import type { Ctx, Rng } from './game';
import { TRACK_LABELS } from './rules';

export const TIER_LABELS: Record<EventTier | 'none', string> = {
  none: '⚪ Тихо — событий нет',
  mild: '🟢 Мягкое событие',
  medium: '🟡 Среднее событие',
  heavy: '🟠 Тяжёлое событие',
  catastrophe: '🔴 Катастрофа',
};

const DIE: Record<EventTier, number> = { mild: 12, medium: 10, heavy: 6, catastrophe: 6 };

export function tierOf(total: number): EventTier | 'none' {
  if (total <= 50) return 'none';
  if (total <= 82) return 'mild';
  if (total <= 94) return 'medium';
  if (total <= 99) return 'heavy';
  return 'catastrophe';
}

export const eventsOf = (deck: DeckData, tier?: EventTier) =>
  deck.cards.filter((c) => c.event && (!tier || c.event.tier === tier)).sort((a, b) => a.event!.roll[0] - b.event!.roll[0]);

/** Мягкие повторяются; средние, тяжёлые и катастрофы — один раз. */
const used = (s: GameState, c: Card) => c.event!.tier !== 'mild' && (s.played.includes(c.id) || s.removed.includes(c.id));

/** Модификаторы шага 1. */
export function rollModifiers(s: GameState): { label: string; value: number }[] {
  const mods: { label: string; value: number }[] = [];
  const danger = CRISIS_TRACKS.filter((t) => s.tracks[t] <= 2 || s.tracks[t] >= 8);
  if (danger.length)
    mods.push({ label: `Шкалы в опасной зоне: ${danger.map((t) => TRACK_LABELS[t]).join(', ')}`, value: 3 * danger.length });
  const prev = s.interlude.number - 1;
  if (prev >= 1) {
    const prevEntries = s.journal.filter((e) => e.interlude === prev);
    if (prevEntries.some((e) => e.kind === 'crisis' && e.public?.startsWith('Кризис:')))
      mods.push({ label: 'В прошлой интерлюдии был кризис', value: 5 });
    const personal = prevEntries.filter((e) => e.kind === 'escalation').length;
    if (personal >= 2) mods.push({ label: `Котерия лично занималась делами (${personal}) в прошлой интерлюдии`, value: -10 });
  }
  return mods;
}

const d = (sides: number, rng: Rng) => 1 + Math.floor(rng() * sides);

/**
 * Полный бросок. Для повторов среднего/тяжёлого/катастрофы сдвигается на ближайшее несыгранное событие того же уровня.
 * d10 = 10 у средних — выбор мастера (eventId не задан).
 */
export function rollEvents(s: GameState, deck: DeckData, rng: Rng = Math.random): EventRoll {
  const d100 = d(100, rng);
  const mods = rollModifiers(s);
  const total = Math.max(1, Math.min(100, d100 + mods.reduce((a, m) => a + m.value, 0)));
  const tier = tierOf(total);
  const roll: EventRoll = { interlude: s.interlude.number, d100, mods, total, tier, attracted: [], notes: [] };
  if (tier === 'none') return roll;
  const pool = eventsOf(deck, tier);
  if (!pool.length) {
    roll.notes.push('В колоде нет событий этого уровня.');
    return roll;
  }
  const value = d(DIE[tier], rng);
  roll.die = { sides: DIE[tier], value };
  roll.attracted = pool.filter((c) => !used(s, c) && c.event!.attracts?.some((f) => s.flags.includes(f))).map((c) => c.id);
  const hit = pool.find((c) => c.event!.roll.includes(value));
  if (!hit) {
    roll.notes.push('Выбор мастера из событий этого уровня.');
    return roll;
  }
  if (!used(s, hit)) {
    roll.eventId = hit.id;
    return roll;
  }
  // ближайшее несыгранное того же уровня
  const idx = pool.indexOf(hit);
  for (let k = 1; k < pool.length; k++)
    for (const j of [idx + k, idx - k]) {
      const c = pool[j];
      if (c && !used(s, c)) {
        roll.eventId = c.id;
        roll.notes.push(`«${hit.title}» уже было — сдвиг на ближайшее несыгранное.`);
        return roll;
      }
    }
  roll.notes.push('Все события этого уровня уже сыграны.');
  return roll;
}

/** GM бросает события в начале интерлюдии (результат сохраняется в партии). */
export function applyRoll(state: GameState, ctx: Ctx): GameState {
  const s = structuredClone(state);
  const r = rollEvents(s, ctx.deck, ctx.rng);
  s.lastRoll = r;
  const ev = r.eventId ? ctx.deck.cards.find((c) => c.id === r.eventId) : undefined;
  s.journal.push({
    id: s.nextId++,
    kind: 'system',
    realTime: (ctx.now?.() ?? new Date()).toISOString(),
    week: s.week,
    interlude: s.interlude.number,
    public: null,
    gm: [
      `🎲 Бросок событий: d100=${r.d100}${r.mods.map((m) => ` ${m.value > 0 ? '+' : '−'}${Math.abs(m.value)}`).join('')} → ${r.total}: ${TIER_LABELS[r.tier]}`,
      ...(r.die ? [`d${r.die.sides}=${r.die.value}${ev ? ` → «${ev.title}»` : ''}`] : []),
      ...r.notes,
    ],
  });
  return s;
}

/** Положить событие в очередь интерлюдии: «Немедленно» — первым, остальные — в случайное место. */
export function placeEvent(state: GameState, ctx: Ctx, cardId: string): GameState {
  const card = ctx.deck.cards.find((c) => c.id === cardId);
  const i = state.interlude;
  if (!card || (i.status !== 'draft' && i.status !== 'running')) return state;
  const s = structuredClone(state);
  const q = s.interlude;
  const from = q.status === 'running' ? q.pos + (s.sceneQueue.length ? 0 : 1) : 0;
  const at = card.event?.immediate ? from : from + Math.floor((ctx.rng ?? Math.random)() * (q.queue.length - from + 1));
  q.queue.splice(Math.min(at, q.queue.length), 0, card.id);
  if (s.lastRoll && s.lastRoll.interlude === q.number) s.lastRoll.placed = card.id;
  return s;
}
