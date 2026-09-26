// Модель данных колоды и состояния партии (ТЗ, раздел 4).

export const DECKS = ['routine', 'deruan', 'night', 'gates', 'court', 'mirror', 'omen'] as const;
export type DeckId = (typeof DECKS)[number];

/** Шкалы с кризисами (0–10, опасны оба края). */
export const CRISIS_TRACKS = ['masquerade', 'court', 'city', 'night'] as const;
export const TRACKS = [...CRISIS_TRACKS, 'capacity'] as const;
export type CrisisTrackId = (typeof CRISIS_TRACKS)[number];
export type TrackId = (typeof TRACKS)[number];

export const TRACK_MIN = 0;
export const TRACK_MAX = 10;
export const TRACK_START = 5;

export type CompareOp = '>=' | '<=' | '>' | '<' | '==' | '!=';
export const COMPARE_OPS: CompareOp[] = ['>=', '<=', '>', '<', '==', '!='];

export type Condition =
  | { flag: string }
  | { notFlag: string }
  | { track: TrackId | 'population'; op: CompareOp; value: number }
  | { timer: string; op: CompareOp; value: number }
  | { anyOf: Condition[] }
  | { allOf: Condition[] };

export interface Delay {
  cards?: number;
  interludes?: number;
}

export type Effect =
  | { type: 'track'; track: TrackId; delta: number }
  | { type: 'population'; delta: number }
  | { type: 'setFlag'; flag: string }
  | { type: 'clearFlag'; flag: string }
  | { type: 'timer'; id: string; delta: number }
  | { type: 'addCard'; card: string; delay?: Delay }
  | { type: 'removeCard'; card: string }
  | { type: 'note'; text: string };

export interface Option {
  label: string;
  effects: Effect[];
  gmNote?: string;
  opensScene?: string;
}

export interface Card {
  id: string;
  title: string;
  deck: DeckId;
  timeOfDay?: string;
  face: string;
  speaker?: string;
  image?: string;
  left?: Option;
  right?: Option;
  gmNote?: string;
  requires?: Condition[];
  escalation?: string;
  /** Секунды; null — без таймера. По умолчанию 60, для mirror — null. */
  timer?: number | null;
  oneShot?: boolean;
  interlude?: number;
  tags?: string[];
  /** Вариант «по умолчанию при бездействии» (ТЗ 5.2, в). */
  idleDefault?: Side;
}

export type Side = 'left' | 'right';

export interface Scene {
  id: string;
  title: string;
  playerText: string;
  gmNotes?: string;
  outcomes: Option[];
  crisisOf?: { track: CrisisTrackId; edge: Edge };
}

export type Edge = 'low' | 'high';

export interface PlotTimerDef {
  id: string;
  title: string;
  /** Число стадий (для отображения «стадия N из M»). */
  max?: number;
}

export interface DeckData {
  title?: string;
  cards: Card[];
  scenes: Scene[];
  plotTimers?: PlotTimerDef[];
}

// ---------- состояние партии ----------

export type TimeoutPolicy = 'pause' | 'random' | 'worst';

export interface Settings {
  timerDefault: number;
  onTimeout: TimeoutPolicy;
  /** Показывать игрокам точные числа сдвига шкал, а не только ↑/↓. */
  showDeltaNumbers: boolean;
  weeksPerCardMin: number;
  weeksPerCardMax: number;
  crisisRollbackLow: number;
  crisisRollbackHigh: number;
  autobuild: { routine: number; lines: number; mirror: number; omen: number };
  /** Сезон начала партии: 0 — зима, 1 — весна, 2 — лето, 3 — осень. */
  startSeason: number;
}

export const DEFAULT_SETTINGS: Settings = {
  timerDefault: 60,
  onTimeout: 'pause',
  showDeltaNumbers: false,
  weeksPerCardMin: 1,
  weeksPerCardMax: 2,
  crisisRollbackLow: 2,
  crisisRollbackHigh: 8,
  autobuild: { routine: 3, lines: 4, mirror: 1, omen: 1 },
  startSeason: 1,
};

export interface PendingCard {
  card: string;
  /** Глобальный номер карты, начиная с которого карта должна войти в очередь. */
  dueCardCount?: number;
  /** Номер интерлюдии, в которую карта должна войти обязательно. */
  dueInterlude?: number;
  source?: string;
}

export type SceneRequest =
  | { kind: 'crisis'; id: string; track: CrisisTrackId; edge: Edge; sceneId?: string; rollback: number }
  | {
      kind: 'escalation';
      id: string;
      sceneId?: string;
      cardId: string;
      penaltyTrack: CrisisTrackId;
    }
  | { kind: 'scene'; id: string; sceneId: string; cardId?: string };

export interface PlayRecord {
  cardId: string;
  title: string;
  /** Текст решения, как его видят игроки. */
  decision: string;
  side?: Side | 'escalation' | 'ack';
}

export interface InterludeState {
  number: number;
  status: 'draft' | 'running' | 'ending' | 'summary';
  queue: string[];
  pos: number;
  startTracks: Record<TrackId, number>;
  startFlags: string[];
  startPool: string[];
  startPopulation: number;
  plays: PlayRecord[];
  endProcessed: boolean;
}

export type JournalKind =
  | 'interlude'
  | 'card'
  | 'escalation'
  | 'scene'
  | 'crisis'
  | 'manual'
  | 'timeout'
  | 'system';

export interface JournalEntry {
  id: number;
  kind: JournalKind;
  realTime: string;
  week: number;
  interlude: number;
  /** Что видят игроки; null — запись только для GM. */
  public: string | null;
  /** GM-детали: эффекты, флаги, заметки. */
  gm: string[];
}

export interface Reveal {
  seq: number;
  deltas: Partial<Record<TrackId, number>>;
}

export interface GameState {
  version: 1;
  tracks: Record<TrackId, number>;
  population: number;
  timers: Record<string, number>;
  flags: string[];
  played: string[];
  removed: string[];
  pending: PendingCard[];
  /** Сколько карт сыграно за всю партию (для отложенных addCard). */
  cardCount: number;
  week: number;
  interlude: InterludeState;
  sceneQueue: SceneRequest[];
  /** GM разрешил эскалацию для текущей карты. */
  escalationAllowed: boolean;
  /** Партия ждёт решения GM после истечения таймера. */
  awaitingGm: boolean;
  playerScreenHidden: boolean;
  reveal: Reveal | null;
  journal: JournalEntry[];
  nextId: number;
  settings: Settings;
}
