// Публичная проекция состояния — всё, что видит экран игроков (ТЗ 3.1, 7).
// Экран игроков получает ТОЛЬКО этот объект: ни флагов, ни заметок, ни эффектов, ни пула.
import type { DeckId, GameState, DeckData, TrackId } from './types';
import { currentView, escalationAvailable, fallbackScene, interludeSummary } from './game';
import { cardTimerSeconds, gameTimeLabel } from './rules';

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
    base.card = {
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
    };
  } else if (v.kind === 'scene') {
    const sc = v.scene ?? fallbackScene(v.request, deck);
    base.scene = { title: sc.title, text: sc.playerText, crisis: v.request.kind === 'crisis' };
  } else if (v.kind === 'summary') {
    const sum = interludeSummary(s, deck);
    base.summary = {
      before: sum.tracksBefore,
      after: sum.tracksAfter,
      decisions: sum.plays.map((p) => ({ title: p.title, decision: p.decision })),
    };
  }
  return base;
}
