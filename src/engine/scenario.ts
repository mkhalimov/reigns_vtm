// Описание сценария: шкалы, колоды, население, оформление. Здесь же — помощники для подписей
// и значения для старых файлов, в которых этих полей ещё не было.
import type { DeckData, DeckDef, DeckRole, PopulationDef, TrackDef, TrackId } from './types';

export const DEFAULT_ROUND = 'Интерлюдия';
export const APP_NAME = 'Мастер сценариев';

export const EMPTY_DECK: DeckData = { title: '', tracks: [], decks: [], cards: [], scenes: [], plotTimers: [] };

/** Сценарий загружен (есть хотя бы одна карта). */
export const hasScenario = (d: DeckData) => d.cards.length > 0;

// ---------- значения для старых файлов (до появления tracks/decks в сценарии) ----------

export const LEGACY_TRACKS: TrackDef[] = [
  { id: 'masquerade', name: 'Маскарад', icon: '🩸' },
  { id: 'court', name: 'Двор', icon: '👑' },
  { id: 'city', name: 'Город', icon: '🏚' },
  { id: 'night', name: 'Ночь', icon: '🕯' },
  { id: 'capacity', name: 'Ёмкость', icon: '📦', crisis: false },
];

export const LEGACY_DECKS: DeckDef[] = [
  { id: 'routine', name: 'Рутина', icon: '📜', color: '#8a7f73', role: 'routine' },
  { id: 'deruan', name: 'Де Руан', icon: '⚜', color: '#b08d3c', role: 'line' },
  { id: 'night', name: 'Ночь', icon: '🌑', color: '#5a4fb3', role: 'line' },
  { id: 'gates', name: 'Ворота', icon: '🚪', color: '#3f8a7a', role: 'line' },
  { id: 'court', name: 'Двор', icon: '👑', color: '#a83a5a', role: 'line' },
  { id: 'mirror', name: 'Зеркало', icon: '🪞', color: '#7fa5c9', role: 'mirror', timer: null },
  { id: 'omen', name: 'Знамения', icon: '✴', color: '#c46a2f', role: 'omen' },
  { id: 'event', name: 'Событие', icon: '🎲', color: '#9a6fb0', role: 'event' },
];

export const LEGACY_POPULATION: PopulationDef = {
  label: 'Население',
  capacityTrack: 'capacity',
  overflow: {
    track: 'masquerade',
    delta: -1,
    message: 'Город не может прокормить всех сородичей домена. Маскарад трещит.',
    conflictDeck: 'night',
    conflictTag: 'capacity_conflict',
  },
};

const ROLE_BY_ID: Record<string, DeckRole> = { routine: 'routine', mirror: 'mirror', omen: 'omen', event: 'event' };
const PALETTE = ['#8a7f73', '#b08d3c', '#5a4fb3', '#3f8a7a', '#a83a5a', '#7fa5c9', '#c46a2f', '#9a6fb0', '#5aa36b', '#c9a227'];

/** Колоды, которых нет в списке decks, создаются автоматически по id из карт. */
export function autoDecks(ids: string[], known: DeckDef[]): DeckDef[] {
  const out = [...known];
  for (const id of ids)
    if (!out.some((d) => d.id === id))
      out.push({ id, name: id, color: PALETTE[out.length % PALETTE.length], role: ROLE_BY_ID[id] ?? 'line' });
  return out;
}

// ---------- подписи ----------

export const trackDef = (deck: DeckData, id: TrackId) => deck.tracks.find((t) => t.id === id);
export const crisisTracks = (deck: DeckData) => deck.tracks.filter((t) => t.crisis !== false).map((t) => t.id);
export const isCrisisTrack = (deck: DeckData, id: TrackId) => trackDef(deck, id)?.crisis !== false;

export function trackName(deck: DeckData | undefined, id: string): string {
  if (id === 'population') return deck?.population?.label ?? 'Население';
  return deck?.tracks.find((t) => t.id === id)?.name ?? id;
}

export const trackIcon = (deck: DeckData | undefined, id: string) =>
  id === 'population' ? '👥' : (deck?.tracks.find((t) => t.id === id)?.icon ?? '◆');

export const deckDef = (deck: DeckData | undefined, id: string): DeckDef =>
  deck?.decks.find((d) => d.id === id) ?? { id, name: id, role: 'other' };

export const decksWithRole = (deck: DeckData, role: DeckRole) => deck.decks.filter((d) => (d.role ?? 'line') === role).map((d) => d.id);

export const roundName = (deck: DeckData | undefined) => deck?.meta?.round ?? DEFAULT_ROUND;

export const brandOf = (deck: DeckData | undefined) =>
  deck?.meta?.brand ?? (deck?.title ? deck.title : APP_NAME);

/** Описания шкал для игроков. */
export function trackInfo(deck: DeckData): Record<TrackId, string> {
  return Object.fromEntries(
    deck.tracks.map((t) => [
      t.id,
      t.description ??
        (t.crisis === false
          ? `${t.name}.`
          : `${t.name}.\n\nОпасны оба края: **0** и **10** приводят к кризису.`),
    ]),
  );
}
