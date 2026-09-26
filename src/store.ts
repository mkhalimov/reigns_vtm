// Единый стор партии: колода + состояние + история для undo. Автосохранение после каждого действия.
import { useSyncExternalStore } from 'react';
import rouenDeck from '../data/rouen-deck.json';
import type { DeckData, GameState } from './engine/types';
import { migrateState, newGame, type Ctx } from './engine/game';
import { validateDeck } from './engine/validate';
import { makeSave, type SaveFile } from './engine/save';
import { loadValue, saveValue } from './persist';

const HISTORY_LIMIT = 200;
const PERSISTED_HISTORY = 60;
const SAVE_KEY = 'save';

export interface AppState {
  loaded: boolean;
  deck: DeckData;
  game: GameState;
  history: GameState[];
  /** Что показывает основное окно: пульт или вид игроков. */
  view: 'gm' | 'players';
  lastSavedAt: string | null;
}

/** Встроенная колода по умолчанию: data/rouen-deck.json. */
export const builtInDeck = validateDeck(rouenDeck).deck!;

let state: AppState = {
  loaded: false,
  deck: builtInDeck,
  game: newGame(builtInDeck),
  history: [],
  view: 'gm',
  lastSavedAt: null,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function set(patch: Partial<AppState>, persist = true): void {
  state = { ...state, ...patch };
  emit();
  if (persist && state.loaded) void persistNow();
}

async function persistNow(): Promise<void> {
  const { deck, game, history } = state;
  await saveValue(SAVE_KEY, makeSave(deck, game, history.slice(-PERSISTED_HISTORY)));
  state = { ...state, lastSavedAt: new Date().toISOString() };
  emit();
}

export const getState = () => state;

export function useApp<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sel(state),
  );
}

export const ctx = (): Ctx => ({ deck: state.deck });

/** Применить действие движка. Каждое изменение попадает в историю (полный undo). */
export function dispatch(fn: (g: GameState, c: Ctx) => GameState): void {
  const next = fn(state.game, ctx());
  if (next === state.game) return;
  set({ game: next, history: [...state.history, state.game].slice(-HISTORY_LIMIT) });
}

export function undo(): void {
  const h = state.history;
  if (!h.length) return;
  set({ game: h[h.length - 1], history: h.slice(0, -1) });
}

export function setView(view: AppState['view']): void {
  set({ view }, false);
}

export function replaceDeck(deck: DeckData, mode: 'keep' | 'new'): void {
  if (mode === 'new') set({ deck, game: newGame(deck, state.game.settings), history: [] });
  else set({ deck, game: migrateState(state.game, deck), history: [...state.history, state.game].slice(-HISTORY_LIMIT) });
}

export function loadSave(save: SaveFile): void {
  set({ deck: save.deck, game: save.game, history: save.history ?? [] });
}

export function newGameSameDeck(): void {
  set({ game: newGame(state.deck, state.game.settings), history: [...state.history, state.game].slice(-HISTORY_LIMIT) });
}

export async function init(): Promise<void> {
  const saved = await loadValue<SaveFile>(SAVE_KEY);
  if (saved?.format === 'rouen-save') {
    const dv = validateDeck(saved.deck);
    if (dv.deck) {
      state = {
        ...state,
        deck: dv.deck,
        game: migrateState(saved.game, dv.deck),
        history: (saved.history ?? []).map((h) => migrateState(h, dv.deck!)),
        lastSavedAt: saved.savedAt,
      };
    }
  }
  set({ loaded: true }, false);
}

export const currentSave = () => makeSave(state.deck, state.game, state.history.slice(-PERSISTED_HISTORY));
