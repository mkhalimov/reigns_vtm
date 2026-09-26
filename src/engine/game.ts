// Игровой движок: чистые функции «состояние → новое состояние» (ТЗ, раздел 5).
import {
  CRISIS_TRACKS,
  DEFAULT_SETTINGS,
  TRACK_START,
  TRACKS,
  type Card,
  type DeckData,
  type Effect,
  type GameState,
  type InterludeState,
  type JournalEntry,
  type Option,
  type PlayRecord,
  type Scene,
  type SceneRequest,
  type Settings,
  type Side,
  type TrackId,
} from './types';
import { availableIds, clampTrack, describeEffect, isAvailable, TRACK_LABELS } from './rules';

export type Rng = () => number;

export interface Ctx {
  deck: DeckData;
  rng?: Rng;
  now?: () => Date;
}

const rngOf = (ctx: Ctx) => ctx.rng ?? Math.random;
const pick = <T>(arr: T[], rng: Rng): T => arr[Math.floor(rng() * arr.length) % arr.length];

export const cardById = (deck: DeckData, id: string): Card | undefined => deck.cards.find((c) => c.id === id);
export const sceneById = (deck: DeckData, id: string | undefined): Scene | undefined =>
  id ? deck.scenes.find((s) => s.id === id) : undefined;

const clone = <T>(v: T): T => structuredClone(v);

function tracksSnapshot(s: GameState): Record<TrackId, number> {
  return { ...s.tracks };
}

function emptyInterlude(number: number, s: GameState, deck: DeckData): InterludeState {
  return {
    number,
    status: 'draft',
    queue: [],
    pos: 0,
    startTracks: tracksSnapshot(s),
    startFlags: [...s.flags],
    startPool: availableIds(deck, s),
    startPopulation: s.population,
    plays: [],
    endProcessed: false,
  };
}

export function newGame(deck: DeckData, settings: Partial<Settings> = {}): GameState {
  const tracks = Object.fromEntries(TRACKS.map((t) => [t, TRACK_START])) as Record<TrackId, number>;
  const s: GameState = {
    version: 1,
    tracks,
    population: 0,
    timers: Object.fromEntries((deck.plotTimers ?? []).map((t) => [t.id, 0])),
    flags: [],
    played: [],
    removed: [],
    pending: [],
    cardCount: 0,
    week: 0,
    interlude: undefined as unknown as InterludeState,
    sceneQueue: [],
    escalationAllowed: false,
    awaitingGm: false,
    playerScreenHidden: false,
    reveal: null,
    journal: [],
    nextId: 1,
    settings: { ...DEFAULT_SETTINGS, ...settings, autobuild: { ...DEFAULT_SETTINGS.autobuild, ...settings.autobuild } },
  };
  s.interlude = emptyInterlude(1, s, deck);
  return s;
}

// ---------- журнал ----------

function log(s: GameState, ctx: Ctx, kind: JournalEntry['kind'], pub: string | null, gm: string[] = []): void {
  s.journal.push({
    id: s.nextId++,
    kind,
    realTime: (ctx.now?.() ?? new Date()).toISOString(),
    week: s.week,
    interlude: s.interlude.number,
    public: pub,
    gm,
  });
}

// ---------- запросы ----------

export type View =
  | { kind: 'draft' }
  | { kind: 'card'; card: Card }
  | { kind: 'scene'; request: SceneRequest; scene?: Scene }
  | { kind: 'summary' };

export function currentView(s: GameState, deck: DeckData): View {
  if (s.sceneQueue.length) {
    const r = s.sceneQueue[0];
    return { kind: 'scene', request: r, scene: sceneForRequest(r, deck) };
  }
  const i = s.interlude;
  if (i.status === 'draft') return { kind: 'draft' };
  if (i.status === 'summary' || i.status === 'ending') return { kind: 'summary' };
  const card = cardById(deck, i.queue[i.pos]);
  if (!card) return { kind: 'summary' };
  return { kind: 'card', card };
}

export function sceneForRequest(r: SceneRequest, deck: DeckData): Scene | undefined {
  if (r.kind === 'crisis')
    return sceneById(deck, r.sceneId) ?? deck.scenes.find((x) => x.crisisOf?.track === r.track && x.crisisOf.edge === r.edge);
  return sceneById(deck, r.sceneId);
}

/** Заглушка, если в колоде нет нужной сцены. */
export function fallbackScene(r: SceneRequest, deck: DeckData): Scene {
  if (r.kind === 'crisis') {
    const high = r.edge === 'high';
    return {
      id: `crisis_${r.track}_${r.edge}`,
      title: `Кризис: ${TRACK_LABELS[r.track]} ${high ? '— 10' : '— 0'}`,
      playerText: high
        ? `${TRACK_LABELS[r.track]} выходит из-под контроля. Это придётся разыграть лично.`
        : `${TRACK_LABELS[r.track]} рушится. Это придётся разыграть лично.`,
      outcomes: [],
    };
  }
  const card = r.kind !== 'scene' || r.cardId ? cardById(deck, r.cardId ?? '') : undefined;
  return {
    id: 'personal',
    title: card ? `Разбираемся лично: ${card.title}` : 'Сцена',
    playerText: card?.face ?? '',
    outcomes: [],
  };
}

export const escalationAvailable = (s: GameState, card: Card) => Boolean(card.escalation) || s.escalationAllowed;

// ---------- эффекты ----------

interface ApplyResult {
  gm: string[];
}

function applyEffects(s: GameState, effects: Effect[], ctx: Ctx, source: string): ApplyResult {
  const gm: string[] = [];
  for (const e of effects) {
    gm.push(describeEffect(e, ctx.deck));
    switch (e.type) {
      case 'track':
        s.tracks[e.track] = clampTrack(s.tracks[e.track] + e.delta);
        break;
      case 'population':
        s.population = Math.max(0, s.population + e.delta);
        break;
      case 'setFlag':
        if (!s.flags.includes(e.flag)) s.flags.push(e.flag);
        break;
      case 'clearFlag':
        s.flags = s.flags.filter((f) => f !== e.flag);
        break;
      case 'timer':
        s.timers[e.id] = Math.max(0, (s.timers[e.id] ?? 0) + e.delta);
        break;
      case 'addCard': {
        s.removed = s.removed.filter((id) => id !== e.card);
        if (e.delay?.interludes) {
          s.pending.push({ card: e.card, dueInterlude: s.interlude.number + e.delay.interludes, source });
        } else if (e.delay?.interludes === 0) {
          if (s.interlude.status === 'running') s.interlude.queue.push(e.card);
          else s.pending.push({ card: e.card, dueInterlude: s.interlude.number, source });
        } else {
          s.pending.push({ card: e.card, dueCardCount: s.cardCount + (e.delay?.cards ?? 0), source });
        }
        break;
      }
      case 'removeCard': {
        if (!s.removed.includes(e.card)) s.removed.push(e.card);
        const i = s.interlude;
        // pos уже указывает на следующую несыгранную карту
        i.queue = [...i.queue.slice(0, i.pos), ...i.queue.slice(i.pos).filter((id) => id !== e.card)];
        s.pending = s.pending.filter((p) => p.card !== e.card);
        break;
      }
      case 'note':
        break;
    }
  }
  return { gm };
}

/** Отложенные addCard, чей срок по числу карт наступил, встают следующими в очередь. */
function flushDuePendingCards(s: GameState): void {
  const i = s.interlude;
  if (i.status !== 'running') return;
  const due = s.pending.filter((p) => p.dueCardCount !== undefined && p.dueCardCount <= s.cardCount);
  if (!due.length) return;
  s.pending = s.pending.filter((p) => !due.includes(p));
  // вставляем после текущей позиции (pos уже указывает на следующую карту)
  i.queue.splice(i.pos, 0, ...due.map((p) => p.card));
}

function advanceTime(s: GameState, ctx: Ctx): void {
  const { weeksPerCardMin: a, weeksPerCardMax: b } = s.settings;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  s.week += lo + Math.floor(rngOf(ctx)() * (hi - lo + 1));
}

function queueCrises(s: GameState, ctx: Ctx): void {
  for (const t of CRISIS_TRACKS) {
    const v = s.tracks[t];
    if (v !== 0 && v !== 10) continue;
    if (s.sceneQueue.some((r) => r.kind === 'crisis' && r.track === t)) continue;
    const edge = v === 0 ? 'low' : 'high';
    const scene = ctx.deck.scenes.find((x) => x.crisisOf?.track === t && x.crisisOf.edge === edge);
    s.sceneQueue.push({
      kind: 'crisis',
      id: `r${s.nextId++}`,
      track: t,
      edge,
      sceneId: scene?.id,
      rollback: edge === 'low' ? s.settings.crisisRollbackLow : s.settings.crisisRollbackHigh,
    });
    log(s, ctx, 'crisis', `Кризис: ${TRACK_LABELS[t]} ${edge === 'low' ? 'упала до 0' : 'достигла 10'}.`, [
      scene ? `Сцена: ${scene.title} (${scene.id})` : 'Кризисная сцена не найдена — заглушка',
    ]);
  }
}

function trackDeltas(before: Record<TrackId, number>, after: Record<TrackId, number>) {
  const d: Partial<Record<TrackId, number>> = {};
  for (const t of TRACKS) if (after[t] !== before[t]) d[t] = after[t] - before[t];
  return d;
}

function setReveal(s: GameState, before: Record<TrackId, number>): void {
  const deltas = trackDeltas(before, s.tracks);
  s.reveal = { seq: (s.reveal?.seq ?? 0) + 1, deltas };
}

/** Проверка конца интерлюдии: Ёмкость (5.6), затем кризисы, затем итоги. */
function settle(s: GameState, ctx: Ctx): void {
  const i = s.interlude;
  if (s.sceneQueue.length) return;
  if (i.status !== 'running' && i.status !== 'ending') return;
  if (i.pos < i.queue.length) {
    i.status = 'running';
    return;
  }
  if (!i.endProcessed) {
    i.endProcessed = true;
    i.status = 'ending';
    if (s.population > s.tracks.capacity) {
      const before = tracksSnapshot(s);
      s.tracks.masquerade = clampTrack(s.tracks.masquerade - 1);
      const gm = [`Население ${s.population} > Ёмкость ${s.tracks.capacity}`, 'Маскарад −1'];
      const conflict = pickCapacityConflict(s, ctx);
      if (conflict) {
        s.pending.push({ card: conflict.id, dueInterlude: i.number + 1, source: 'capacity' });
        gm.push(`➕ карта-конфликт «${conflict.title}» (${conflict.id}) в следующую интерлюдию`);
      } else gm.push('Нет подходящей карты-конфликта в колоде night (тег capacity_conflict)');
      log(s, ctx, 'system', 'Город не может прокормить всех сородичей домена. Маскарад трещит.', gm);
      setReveal(s, before);
      queueCrises(s, ctx);
      if (s.sceneQueue.length) return;
    }
  }
  i.status = 'summary';
  log(s, ctx, 'interlude', `Интерлюдия ${i.number} завершена.`, []);
}

function pickCapacityConflict(s: GameState, ctx: Ctx): Card | undefined {
  const inPlay = new Set([...s.pending.map((p) => p.card), ...s.interlude.queue]);
  const cands = ctx.deck.cards.filter(
    (c) => c.deck === 'night' && !inPlay.has(c.id) && !s.removed.includes(c.id) && !(c.oneShot !== false && s.played.includes(c.id)),
  );
  const tagged = cands.filter((c) => c.tags?.some((t) => t === 'capacity_conflict' || t === 'capacity'));
  const list = tagged.length ? tagged : cands.filter((c) => isAvailable(c, s));
  return list.length ? pick(list, rngOf(ctx)) : undefined;
}

// ---------- действия интерлюдии ----------

export function setDraftQueue(state: GameState, queue: string[]): GameState {
  const s = clone(state);
  const i = s.interlude;
  if (i.status === 'draft') i.queue = [...queue];
  else if (i.status === 'running') i.queue = [...i.queue.slice(0, i.pos), ...queue];
  return s;
}

/** Первые pos карт уже сыграны; редактируется только хвост очереди. */
export const upcomingQueue = (s: GameState) =>
  s.interlude.status === 'draft' ? s.interlude.queue : s.interlude.queue.slice(s.interlude.pos);

/** Отложенные карты, которые обязаны войти в интерлюдию s.interlude.number. */
export function duePending(s: GameState) {
  return s.pending.filter(
    (p) =>
      (p.dueInterlude !== undefined && p.dueInterlude <= s.interlude.number) ||
      (p.dueCardCount !== undefined && p.dueCardCount <= s.cardCount),
  );
}

export function startInterlude(state: GameState, ctx: Ctx): GameState {
  const s = clone(state);
  const i = s.interlude;
  if (i.status !== 'draft') return state;
  // отложенные карты, срок которых наступил, входят обязательно
  const due = duePending(s);
  for (const p of due) if (!i.queue.includes(p.card)) i.queue.push(p.card);
  s.pending = s.pending.filter((p) => !due.includes(p));
  i.status = 'running';
  i.pos = 0;
  i.startTracks = tracksSnapshot(s);
  i.startFlags = [...s.flags];
  i.startPool = availableIds(ctx.deck, s);
  i.startPopulation = s.population;
  s.escalationAllowed = false;
  s.awaitingGm = false;
  s.reveal = null;
  log(s, ctx, 'interlude', `Интерлюдия ${i.number} началась.`, [
    `Очередь: ${i.queue.join(', ')}`,
    ...(due.length ? [`Обязательные отложенные: ${due.map((p) => p.card).join(', ')}`] : []),
  ]);
  settle(s, ctx);
  return s;
}

export function nextInterlude(state: GameState, ctx: Ctx): GameState {
  const s = clone(state);
  if (s.interlude.status !== 'summary') return state;
  s.interlude = emptyInterlude(s.interlude.number + 1, s, ctx.deck);
  s.reveal = null;
  return s;
}

function finishCard(s: GameState, ctx: Ctx, card: Card, play: PlayRecord): void {
  const i = s.interlude;
  if (!s.played.includes(card.id)) s.played.push(card.id);
  i.plays.push(play);
  i.pos += 1;
  s.cardCount += 1;
  s.escalationAllowed = false;
  s.awaitingGm = false;
  advanceTime(s, ctx);
}

export type ChoiceVia = 'players' | 'gm' | 'timeout';

export function choose(state: GameState, ctx: Ctx, side: Side, via: ChoiceVia = 'players'): GameState {
  const view = currentView(state, ctx.deck);
  if (view.kind !== 'card') return state;
  const card = view.card;
  const opt: Option | undefined = card[side];
  if (!opt) return state;
  const s = clone(state);
  const before = tracksSnapshot(s);
  finishCard(s, ctx, card, { cardId: card.id, title: card.title, decision: opt.label, side });
  const { gm } = applyEffects(s, opt.effects, ctx, card.id);
  const viaText = via === 'gm' ? ' (решение GM)' : via === 'timeout' ? ' (время вышло)' : '';
  log(s, ctx, 'card', `«${card.title}» — ${opt.label}`, [
    `${side === 'left' ? '◀' : '▶'} ${card.id}${viaText}`,
    ...gm,
    ...(opt.gmNote ? [`⚑ ${opt.gmNote}`] : []),
  ]);
  setReveal(s, before);
  flushDuePendingCards(s);
  queueCrises(s, ctx);
  if (opt.opensScene) s.sceneQueue.push({ kind: 'scene', id: `r${s.nextId++}`, sceneId: opt.opensScene, cardId: card.id });
  settle(s, ctx);
  return s;
}

/** Карта-знамение без вариантов: просто принять. */
export function acknowledge(state: GameState, ctx: Ctx): GameState {
  const view = currentView(state, ctx.deck);
  if (view.kind !== 'card' || view.card.left || view.card.right) return state;
  const s = clone(state);
  finishCard(s, ctx, view.card, { cardId: view.card.id, title: view.card.title, decision: 'Знамение принято', side: 'ack' });
  log(s, ctx, 'card', `«${view.card.title}» — знамение.`, [view.card.id]);
  s.reveal = null;
  flushDuePendingCards(s);
  settle(s, ctx);
  return s;
}

/** «Разбираемся лично» (5.4). */
export function escalate(state: GameState, ctx: Ctx): GameState {
  const view = currentView(state, ctx.deck);
  if (view.kind !== 'card' || !escalationAvailable(state, view.card)) return state;
  const card = view.card;
  const s = clone(state);
  const rng = rngOf(ctx);
  finishCard(s, ctx, card, { cardId: card.id, title: card.title, decision: 'Разбираемся лично', side: 'escalation' });
  // Цена времени: +1 карта рутины в текущую интерлюдию
  const inQueue = new Set(s.interlude.queue);
  const routine = ctx.deck.cards.filter((c) => c.deck === 'routine' && isAvailable(c, s) && !inQueue.has(c.id));
  const fallback = ctx.deck.cards.filter((c) => c.deck === 'routine' && !s.removed.includes(c.id) && !inQueue.has(c.id));
  const extra = routine.length ? pick(routine, rng) : fallback.length ? pick(fallback, rng) : undefined;
  if (extra) s.interlude.queue.push(extra.id);
  const penaltyTrack = pick([...CRISIS_TRACKS], rng);
  s.sceneQueue.push({ kind: 'escalation', id: `r${s.nextId++}`, sceneId: card.escalation, cardId: card.id, penaltyTrack });
  log(s, ctx, 'escalation', `«${card.title}» — разбираемся лично.`, [
    `⚡ ${card.escalation ?? 'сцена без заготовки'}`,
    extra ? `Цена времени: ➕ рутина «${extra.title}» (${extra.id})` : 'Цена времени: нет доступной карты рутины',
    `Предложенная шкала для −1: ${TRACK_LABELS[penaltyTrack]}`,
  ]);
  s.reveal = null;
  flushDuePendingCards(s);
  return s;
}

export interface ResolveInput {
  outcome?: number;
  custom?: Effect[];
  customLabel?: string;
}

export function resolveScene(state: GameState, ctx: Ctx, input: ResolveInput): GameState {
  const req = state.sceneQueue[0];
  if (!req) return state;
  const s = clone(state);
  const scene = sceneForRequest(req, ctx.deck) ?? fallbackScene(req, ctx.deck);
  const before = tracksSnapshot(s);
  const opt: Option | undefined =
    input.custom !== undefined
      ? { label: input.customLabel?.trim() || 'Свой исход', effects: input.custom }
      : scene.outcomes[input.outcome ?? -1];
  if (!opt) return state;
  s.sceneQueue.shift();
  const { gm } = applyEffects(s, opt.effects, ctx, scene.id);
  if (req.kind === 'escalation') {
    s.tracks[req.penaltyTrack] = clampTrack(s.tracks[req.penaltyTrack] - 1);
    gm.push(`Цена времени: ${TRACK_LABELS[req.penaltyTrack]} −1`);
  }
  if (req.kind === 'crisis') {
    s.tracks[req.track] = clampTrack(req.rollback);
    gm.push(`Откат: ${TRACK_LABELS[req.track]} → ${s.tracks[req.track]}`);
  }
  log(s, ctx, req.kind === 'crisis' ? 'crisis' : 'scene', `Сцена «${scene.title}»: ${opt.label}`, [
    ...gm,
    ...(opt.gmNote ? [`⚑ ${opt.gmNote}`] : []),
  ]);
  const last = s.interlude.plays[s.interlude.plays.length - 1];
  if (req.kind === 'escalation' && last?.cardId === req.cardId && last.side === 'escalation')
    last.decision = `Разбираемся лично → ${opt.label}`;
  setReveal(s, before);
  queueCrises(s, ctx);
  settle(s, ctx);
  return s;
}

export function updateSceneRequest(state: GameState, id: string, patch: Partial<SceneRequest>): GameState {
  const s = clone(state);
  s.sceneQueue = s.sceneQueue.map((r) => (r.id === id ? ({ ...r, ...patch } as SceneRequest) : r));
  return s;
}

export function moveSceneRequest(state: GameState, id: string, dir: -1 | 1): GameState {
  const s = clone(state);
  const q = s.sceneQueue;
  const i = q.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= q.length) return state;
  [q[i], q[j]] = [q[j], q[i]];
  return s;
}

/** GM открывает любую сцену вручную. */
export function openScene(state: GameState, ctx: Ctx, sceneId: string): GameState {
  const scene = sceneById(ctx.deck, sceneId);
  if (!scene) return state;
  const s = clone(state);
  if (scene.crisisOf) {
    const { track, edge } = scene.crisisOf;
    s.sceneQueue.unshift({
      kind: 'crisis',
      id: `r${s.nextId++}`,
      track,
      edge,
      sceneId,
      rollback: edge === 'low' ? s.settings.crisisRollbackLow : s.settings.crisisRollbackHigh,
    });
  } else s.sceneQueue.unshift({ kind: 'scene', id: `r${s.nextId++}`, sceneId });
  log(s, ctx, 'scene', null, [`GM открыл сцену ${scene.title} (${scene.id})`]);
  return s;
}

/** Снять сцену из очереди без исхода (только GM). */
export function dropSceneRequest(state: GameState, ctx: Ctx, id: string): GameState {
  const s = clone(state);
  const r = s.sceneQueue.find((x) => x.id === id);
  if (!r) return state;
  s.sceneQueue = s.sceneQueue.filter((x) => x.id !== id);
  log(s, ctx, 'manual', null, [`GM снял сцену из очереди (${r.kind}${r.kind === 'crisis' ? `: ${r.track}` : ''})`]);
  settle(s, ctx);
  return s;
}

export function handleTimeout(state: GameState, ctx: Ctx): GameState {
  const view = currentView(state, ctx.deck);
  if (view.kind !== 'card' || state.awaitingGm) return state;
  const card = view.card;
  const policy = state.settings.onTimeout;
  let side: Side | undefined;
  if (policy === 'random') {
    const sides = (['left', 'right'] as Side[]).filter((x) => card[x]);
    if (sides.length) side = pick(sides, rngOf(ctx));
  } else if (policy === 'worst' && card.idleDefault && card[card.idleDefault]) side = card.idleDefault;
  if (side) {
    const s = clone(state);
    log(s, ctx, 'timeout', 'Время вышло.', [`Политика: ${policy}, выбран ${side}`]);
    return choose(s, ctx, side, 'timeout');
  }
  const s = clone(state);
  s.awaitingGm = true;
  log(s, ctx, 'timeout', 'Время вышло — ждём решения Рассказчика.', []);
  return s;
}

// ---------- ручные правки GM ----------

export function setTrack(state: GameState, ctx: Ctx, track: TrackId | 'population', value: number): GameState {
  const s = clone(state);
  const old = track === 'population' ? s.population : s.tracks[track];
  if (track === 'population') s.population = Math.max(0, Math.round(value));
  else s.tracks[track] = clampTrack(value);
  const now = track === 'population' ? s.population : s.tracks[track];
  if (now === old) return state;
  log(s, ctx, 'manual', null, [`Правка: ${TRACK_LABELS[track]} ${old} → ${now}`]);
  return s;
}

export function setPlotTimer(state: GameState, ctx: Ctx, id: string, value: number): GameState {
  const s = clone(state);
  const old = s.timers[id] ?? 0;
  s.timers[id] = Math.max(0, Math.round(value));
  log(s, ctx, 'manual', null, [`Правка: таймер ${id} ${old} → ${s.timers[id]}`]);
  return s;
}

export function toggleFlag(state: GameState, ctx: Ctx, flag: string, on: boolean): GameState {
  const f = flag.trim();
  if (!f || state.flags.includes(f) === on) return state;
  const s = clone(state);
  s.flags = on ? [...s.flags, f] : s.flags.filter((x) => x !== f);
  log(s, ctx, 'manual', null, [`Правка: ⚑ ${on ? '+' : '−'}${f}`]);
  return s;
}

export function patchState(state: GameState, patch: Partial<Pick<GameState, 'escalationAllowed' | 'playerScreenHidden' | 'awaitingGm'>>): GameState {
  return { ...clone(state), ...patch };
}

export function updateSettings(state: GameState, patch: Partial<Settings>): GameState {
  const s = clone(state);
  s.settings = { ...s.settings, ...patch, autobuild: { ...s.settings.autobuild, ...patch.autobuild } };
  return s;
}

export function addJournalNote(state: GameState, ctx: Ctx, text: string, isPublic: boolean): GameState {
  if (!text.trim()) return state;
  const s = clone(state);
  log(s, ctx, 'manual', isPublic ? text.trim() : null, isPublic ? [] : [`✎ ${text.trim()}`]);
  return s;
}

// ---------- итоги ----------

export interface Summary {
  number: number;
  tracksBefore: Record<TrackId, number>;
  tracksAfter: Record<TrackId, number>;
  populationBefore: number;
  populationAfter: number;
  plays: PlayRecord[];
  flagsSet: string[];
  flagsCleared: string[];
  unlocked: string[];
}

export function interludeSummary(s: GameState, deck: DeckData): Summary {
  const i = s.interlude;
  const pool = availableIds(deck, s);
  return {
    number: i.number,
    tracksBefore: i.startTracks,
    tracksAfter: { ...s.tracks },
    populationBefore: i.startPopulation,
    populationAfter: s.population,
    plays: i.plays,
    flagsSet: s.flags.filter((f) => !i.startFlags.includes(f)),
    flagsCleared: i.startFlags.filter((f) => !s.flags.includes(f)),
    unlocked: pool.filter((id) => !i.startPool.includes(id)),
  };
}

/** Приводит старое/импортированное сохранение к текущей форме. */
export function migrateState(raw: GameState, deck: DeckData): GameState {
  const base = newGame(deck);
  return {
    ...base,
    ...raw,
    settings: { ...base.settings, ...raw.settings, autobuild: { ...base.settings.autobuild, ...raw.settings?.autobuild } },
    tracks: { ...base.tracks, ...raw.tracks },
    timers: { ...base.timers, ...raw.timers },
  };
}
