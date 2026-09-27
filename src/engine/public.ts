// Публичная проекция состояния — всё, что видит экран игроков (ТЗ 3.1, 7).
// Экран игроков получает ТОЛЬКО этот объект: ни флагов, ни заметок, ни эффектов, ни пула.
import type { DeckId, GameState, DeckData, TrackId } from './types';
import { cardById, characterName, currentView, decidersOf, deciderText, escalationAvailable, fallbackScene, interludeSummary } from './game';
import type { Card } from './types';
import type { Deciders } from './votes';
import { cardTimerSeconds, gameTimeLabel, trackInfo } from './rules';

export interface PublicCard {
  title: string;
  deck: DeckId;
  timeOfDay?: string;
  face: string;
  speaker?: string;
  image?: string;
  left?: string;
  right?: string;
  canEscalate: boolean;
  timer: number | null;
  /** Есть ли варианты ◀/▶ (у секретной карты подписи скрыты, но варианты есть). */
  options: boolean;
  /** Кто решает: id мест (персонажей). null — вся котерия. */
  restrict: Deciders | null;
  /** Подпись «кто решает» для экрана. */
  decider?: string;
  /** Секретная карта: содержимое видит только адресат на своём телефоне. */
  secret?: boolean;
  /** Случайное событие. */
  event?: boolean;
}

/** Полная (немаскированная) карта для экрана игрока. */
export function cardView(s: GameState, deck: DeckData, c: Card): PublicCard {
  return {
    title: c.title,
    deck: c.deck,
    timeOfDay: c.timeOfDay,
    face: c.face,
    speaker: c.speaker,
    image: c.image,
    left: c.left?.label,
    right: c.right?.label,
    canEscalate: escalationAvailable(s, c),
    timer: cardTimerSeconds(c, s.settings),
    options: Boolean(c.left || c.right),
    restrict: decidersOf(c),
    decider: deciderText(c, deck),
    secret: c.secret || undefined,
    event: c.event ? true : undefined,
  };
}

/** Секретная карта для адресата: уходит только на его телефон. */
export function secretCardFor(s: GameState, deck: DeckData): { seat: string; cardKey: string; card: PublicCard } | null {
  const v = currentView(s, deck);
  if (s.playerScreenHidden || v.kind !== 'card' || !v.card.secret || !v.card.owner) return null;
  return { seat: v.card.owner, cardKey: `${s.interlude.number}:${s.interlude.pos}:${v.card.id}`, card: cardView(s, deck, v.card) };
}

export interface PublicState {
  hidden: boolean;
  mode: 'draft' | 'card' | 'scene' | 'summary';
  interlude: number;
  cardIndex: number;
  cardTotal: number;
  time: string;
  tracks: Record<TrackId, number>;
  population: number;
  /** Описания шкал для игроков. */
  trackInfo: Record<TrackId, string>;
  card?: PublicCard;
  /** Ключ текущей карты (чтобы UI сбрасывал анимации/таймер). */
  cardKey?: string;
  awaitingGm: boolean;
  scene?: { title: string; text: string; crisis: boolean };
  reveal: { seq: number; deltas: Partial<Record<TrackId, number | 'up' | 'down'>> } | null;
  summary?: {
    before: Record<TrackId, number>;
    after: Record<TrackId, number>;
    decisions: { title: string; decision: string }[];
  };
}

export function publicView(s: GameState, deck: DeckData): PublicState {
  const v = currentView(s, deck);
  const i = s.interlude;
  const base: PublicState = {
    hidden: s.playerScreenHidden,
    mode: v.kind,
    interlude: i.number,
    cardIndex: Math.min(i.pos + 1, i.queue.length),
    cardTotal: i.queue.length,
    time: gameTimeLabel(s.week, s.settings.startSeason),
    tracks: { ...s.tracks },
    population: s.population,
    trackInfo: trackInfo(deck),
    awaitingGm: s.awaitingGm,
    reveal: s.reveal
      ? {
          seq: s.reveal.seq,
          deltas: Object.fromEntries(
            Object.entries(s.reveal.deltas).map(([k, d]) => [
              k,
              s.settings.showDeltaNumbers ? d : (d as number) > 0 ? 'up' : 'down',
            ]),
          ),
        }
      : null,
  };
  if (s.playerScreenHidden) {
    // При скрытом экране не отдаём даже текущую карту
    return { ...base, mode: 'draft', reveal: null };
  }
  if (v.kind === 'card') {
    const c = v.card;
    base.cardKey = `${i.number}:${i.pos}:${c.id}`;
    const full = cardView(s, deck, c);
    base.card = c.secret
      ? {
          ...full,
          title: `Личная карта: ${characterName(deck, c.owner) ?? '?'}`,
          face: 'Эту карту видит только её адресат — на своём телефоне. Он решает сам, а рассказывать ли остальным — его выбор.',
          timeOfDay: undefined,
          speaker: undefined,
          image: undefined,
          left: undefined,
          right: undefined,
        }
      : full;
  } else if (v.kind === 'scene') {
    const sc = v.scene ?? fallbackScene(v.request, deck);
    const src = v.request.kind !== 'crisis' && v.request.cardId ? cardById(deck, v.request.cardId) : undefined;
    base.scene = src?.secret
      ? { title: `Личное дело: ${characterName(deck, src.owner) ?? '?'}`, text: 'Разыгрывается наедине с Рассказчиком.', crisis: false }
      : { title: sc.title, text: sc.playerText, crisis: v.request.kind === 'crisis' };
  } else if (v.kind === 'summary') {
    const sum = interludeSummary(s, deck);
    base.summary = {
      before: sum.tracksBefore,
      after: sum.tracksAfter,
      decisions: sum.plays.map((p) => {
        const c = cardById(deck, p.cardId);
        return c?.secret
          ? { title: `Личная карта (${characterName(deck, c.owner) ?? '?'})`, decision: 'решение принято' }
          : { title: p.title, decision: p.decision };
      }),
    };
  }
  return base;
}
