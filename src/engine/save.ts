// Сохранение партии одним JSON-файлом (ТЗ 4.6, 7).
import type { DeckData, GameState } from './types';
import { describeJsonError, validateDeck } from './validate';
import { migrateState } from './game';

export interface SaveFile {
  format: 'rouen-save';
  version: 1;
  savedAt: string;
  deck: DeckData;
  game: GameState;
  history?: GameState[];
}

export function makeSave(deck: DeckData, game: GameState, history?: GameState[]): SaveFile {
  return { format: 'rouen-save', version: 1, savedAt: new Date().toISOString(), deck, game, history };
}

export function parseSave(text: string): { save: SaveFile | null; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { save: null, error: describeJsonError(text, e) };
  }
  const r = raw as Partial<SaveFile>;
  if (!r || r.format !== 'rouen-save') return { save: null, error: 'Это не файл сохранения «Руана» (нет format: "rouen-save").' };
  const dv = validateDeck(r.deck);
  if (!dv.deck) return { save: null, error: `Колода в сохранении повреждена:\n${dv.errors.join('\n')}` };
  if (!r.game || typeof r.game !== 'object' || !r.game.tracks || !r.game.interlude)
    return { save: null, error: 'В сохранении нет состояния партии (game).' };
  const game = migrateState(r.game, dv.deck);
  const history = Array.isArray(r.history) ? r.history.map((h) => migrateState(h, dv.deck!)) : [];
  return { save: { format: 'rouen-save', version: 1, savedAt: r.savedAt ?? '', deck: dv.deck, game, history } };
}
