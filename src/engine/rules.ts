// Условия, доступность карт, описания эффектов.
import {
  TRACK_MAX,
  TRACK_MIN,
  type Card,
  type CompareOp,
  type Condition,
  type DeckData,
  type Effect,
  type GameState,
  type Settings,
} from './types';
import { deckDef, roundName, trackName } from './scenario';

export const clampTrack = (v: number) => Math.max(TRACK_MIN, Math.min(TRACK_MAX, Math.round(v)));

export function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case '>=':
      return a >= b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '<':
      return a < b;
    case '==':
      return a === b;
    case '!=':
      return a !== b;
  }
}

export function checkCondition(c: Condition, s: GameState): boolean {
  if ('anyOf' in c) return c.anyOf.some((x) => checkCondition(x, s));
  if ('allOf' in c) return c.allOf.every((x) => checkCondition(x, s));
  if ('flag' in c) return s.flags.includes(c.flag);
  if ('notFlag' in c) return !s.flags.includes(c.notFlag);
  if ('track' in c) {
    const v = c.track === 'population' ? s.population : s.tracks[c.track];
    return compare(v, c.op, c.value);
  }
  if ('timer' in c) return compare(s.timers[c.timer] ?? 0, c.op, c.value);
  return false;
}

export const checkAll = (conds: Condition[] | undefined, s: GameState) =>
  !conds || conds.every((c) => checkCondition(c, s));

export function describeCondition(c: Condition, deck?: DeckData): string {
  if ('anyOf' in c) return `одно из (${c.anyOf.map((x) => describeCondition(x, deck)).join(' | ')})`;
  if ('allOf' in c) return `все (${c.allOf.map((x) => describeCondition(x, deck)).join(' & ')})`;
  if ('flag' in c) return `флаг ${c.flag}`;
  if ('notFlag' in c) return `НЕ флаг ${c.notFlag}`;
  if ('track' in c) return `${trackName(deck, c.track)} ${c.op} ${c.value}`;
  return `таймер ${c.timer} ${c.op} ${c.value}`;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function describeEffect(e: Effect, deck?: DeckData): string {
  const cardTitle = (id: string) => {
    const c = deck?.cards.find((x) => x.id === id);
    return c ? `«${c.title}» (${id})` : id;
  };
  switch (e.type) {
    case 'track':
      return `${trackName(deck, e.track)} ${signed(e.delta)}${e.temporary ? ` (до конца раунда)` : ''}`;
    case 'population':
      return `${trackName(deck, 'population')} ${signed(e.delta)}`;
    case 'setFlag':
      return `⚑ +${e.flag}`;
    case 'clearFlag':
      return `⚑ −${e.flag}`;
    case 'timer': {
      const t = deck?.plotTimers?.find((x) => x.id === e.id);
      return `⏳ ${t?.title ?? e.id} ${signed(e.delta)}`;
    }
    case 'addCard': {
      const round = roundName(deck).toLowerCase();
      const d = e.delay?.interludes
        ? ` через ${e.delay.interludes} (${round})`
        : e.delay?.cards
          ? ` через ${e.delay.cards} карт`
          : e.delay?.interludes === 0
            ? ` в этот раунд`
            : ' следующей';
      return `➕ карта ${cardTitle(e.card)}${d}`;
    }
    case 'removeCard':
      return `✖ убрать карту ${cardTitle(e.card)}`;
    case 'note':
      return `✎ ${e.text}`;
  }
}

/** Секунды таймера для карты; null — без таймера. Порядок: карта → колода → настройка партии. */
export function cardTimerSeconds(card: Card, settings: Settings, deck?: DeckData): number | null {
  if (!card.left && !card.right) return null;
  if (card.timer === null) return null;
  if (card.timer !== undefined) return card.timer;
  const dt = deckDef(deck, card.deck).timer;
  if (dt !== undefined) return dt;
  return settings.timerDefault;
}

export const isOneShot = (c: Card) => c.oneShot !== false;

/** Карта может попасть в пул: не удалена, не сыграна (если одноразовая), условия выполнены. */
export function isAvailable(c: Card, s: GameState): boolean {
  if (s.removed.includes(c.id)) return false;
  if (isOneShot(c) && s.played.includes(c.id)) return false;
  return checkAll(c.requires, s);
}

export function availableIds(deck: DeckData, s: GameState): string[] {
  return deck.cards.filter((c) => isAvailable(c, s)).map((c) => c.id);
}

export const DEFAULT_SEASONS = ['Зима', 'Весна', 'Лето', 'Осень'];

export function gameTimeLabel(week: number, startSeason: number, deck?: DeckData): string {
  const seasons = deck?.calendar?.seasons?.length ? deck.calendar.seasons : DEFAULT_SEASONS;
  const per = Math.max(1, deck?.calendar?.weeksPerSeason ?? 13);
  const n = seasons.length;
  const seasonIdx = Math.floor(week / per);
  const season = seasons[(startSeason + seasonIdx) % n];
  const year = Math.floor((startSeason + seasonIdx) / n);
  return `${season}${year > 0 ? ` (год ${year + 1})` : ''}, неделя ${(week % per) + 1}`;
}
