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
  type TrackId,
} from './types';

export const TRACK_LABELS: Record<TrackId | 'population', string> = {
  masquerade: 'Маскарад',
  court: 'Двор',
  city: 'Город',
  night: 'Ночь',
  capacity: 'Ёмкость',
  population: 'Население',
};

export const TRACK_ICONS: Record<TrackId, string> = {
  masquerade: '🩸',
  court: '👑',
  city: '🏚',
  night: '🕯',
  capacity: '📦',
};

export const DECK_LABELS: Record<string, string> = {
  routine: 'Рутина',
  deruan: 'Де Руан',
  night: 'Ночь',
  gates: 'Ворота',
  court: 'Двор',
  mirror: 'Зеркало',
  omen: 'Знамения',
};

export const DECK_ICONS: Record<string, string> = {
  routine: '📜',
  deruan: '⚜',
  night: '🌑',
  gates: '🚪',
  court: '👑',
  mirror: '🪞',
  omen: '✴',
};

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

export function describeCondition(c: Condition): string {
  if ('anyOf' in c) return `одно из (${c.anyOf.map(describeCondition).join(' | ')})`;
  if ('allOf' in c) return `все (${c.allOf.map(describeCondition).join(' & ')})`;
  if ('flag' in c) return `флаг ${c.flag}`;
  if ('notFlag' in c) return `НЕ флаг ${c.notFlag}`;
  if ('track' in c) return `${TRACK_LABELS[c.track]} ${c.op} ${c.value}`;
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
      return `${TRACK_LABELS[e.track]} ${signed(e.delta)}`;
    case 'population':
      return `Население ${signed(e.delta)}`;
    case 'setFlag':
      return `⚑ +${e.flag}`;
    case 'clearFlag':
      return `⚑ −${e.flag}`;
    case 'timer': {
      const t = deck?.plotTimers?.find((x) => x.id === e.id);
      return `⏳ ${t?.title ?? e.id} ${signed(e.delta)}`;
    }
    case 'addCard': {
      const d = e.delay?.interludes
        ? ` через ${e.delay.interludes} интерл.`
        : e.delay?.cards
          ? ` через ${e.delay.cards} карт`
          : e.delay?.interludes === 0
            ? ' в эту интерлюдию'
            : ' следующей';
      return `➕ карта ${cardTitle(e.card)}${d}`;
    }
    case 'removeCard':
      return `✖ убрать карту ${cardTitle(e.card)}`;
    case 'note':
      return `✎ ${e.text}`;
  }
}

/** Секунды таймера для карты; null — без таймера. */
export function cardTimerSeconds(card: Card, settings: Settings): number | null {
  if (!card.left && !card.right) return null;
  if (card.timer === null) return null;
  if (card.timer !== undefined) return card.timer;
  if (card.deck === 'mirror') return null;
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

export const SEASONS = ['Зима', 'Весна', 'Лето', 'Осень'];

export function gameTimeLabel(week: number, startSeason: number): string {
  const seasonIdx = Math.floor(week / 13);
  const season = SEASONS[(startSeason + seasonIdx) % 4];
  const year = Math.floor((startSeason + seasonIdx) / 4);
  return `${season}${year > 0 ? ` (год ${year + 1})` : ''}, неделя ${(week % 13) + 1}`;
}
