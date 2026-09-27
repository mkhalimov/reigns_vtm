// Проверки боевой колоды data/rouen-deck.json (конвертирована из «Руан — колода на игру»).
import { describe, expect, it } from 'vitest';
import raw from '../../data/rouen-deck.json';
import type { Condition, DeckData, Effect, GameState } from './types';
import { validateDeck } from './validate';
import { acknowledge, choose, currentView, escalate, newGame, nextInterlude, resolveScene, setDraftQueue, startInterlude, type Ctx } from './game';
import { autobuild } from './build';

const deck = (): DeckData => {
  const r = validateDeck(raw);
  expect(r.errors).toEqual([]);
  return r.deck!;
};

function conditionFlags(c: Condition): string[] {
  if ('anyOf' in c) return c.anyOf.flatMap(conditionFlags);
  if ('allOf' in c) return c.allOf.flatMap(conditionFlags);
  if ('flag' in c) return [c.flag];
  return [];
}

function allEffects(d: DeckData): Effect[] {
  return [
    ...d.cards.flatMap((c) => [...(c.left?.effects ?? []), ...(c.right?.effects ?? [])]),
    ...d.scenes.flatMap((s) => s.outcomes.flatMap((o) => o.effects)),
  ];
}

describe('колода «Руан»', () => {
  it('49 карт, 11 сцен из документа + кризисы, без ошибок', () => {
    const d = deck();
    expect(d.cards).toHaveLength(49);
    expect(d.characters?.map((c) => c.name)).toEqual(['Магнус', 'Ева', 'Борис']);
    expect(d.scenes.filter((s) => /^s_[а-яa-z]{1,2}_/.test(s.id) && s.outcomes.length === 2)).toHaveLength(11);
    expect(d.scenes.filter((s) => s.crisisOf)).toHaveLength(8);
    expect(d.cards.filter((c) => c.interlude === 1)).toHaveLength(16);
    expect(d.cards.filter((c) => c.interlude === 2)).toHaveLength(17);
    expect(d.cards.filter((c) => c.interlude === 3)).toHaveLength(16);
  });

  it('каждый флаг из условий ставится хотя бы одним эффектом', () => {
    const d = deck();
    const set = new Set(allEffects(d).flatMap((e) => (e.type === 'setFlag' ? [e.flag] : [])));
    const needed = d.cards.flatMap((c) => (c.requires ?? []).flatMap(conditionFlags));
    expect(needed.filter((f) => !set.has(f))).toEqual([]);
  });

  it('три интерлюдии проходятся без зависаний', () => {
    const d = deck();
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ctx: Ctx = { deck: d, rng };
    let s: GameState = newGame(d);
    let played = 0;
    for (let n = 1; n <= 3; n++) {
      s = setDraftQueue(s, autobuild(s, d, rng).queue);
      s = startInterlude(s, ctx);
      for (let guard = 0; guard < 100; guard++) {
        const v = currentView(s, d);
        if (v.kind === 'summary') break;
        if (v.kind === 'scene') s = resolveScene(s, ctx, v.scene?.outcomes.length ? { outcome: guard % 2 } : { custom: [] });
        else if (v.kind === 'card') {
          played++;
          if (!v.card.left && !v.card.right) s = acknowledge(s, ctx);
          else if (v.card.escalation && guard % 3 === 0) s = escalate(s, ctx);
          else s = choose(s, ctx, rng() < 0.5 ? 'left' : 'right');
        }
      }
      expect(currentView(s, d).kind).toBe('summary');
      s = nextInterlude(s, ctx);
    }
    expect(played).toBeGreaterThan(15);
    expect(s.journal.length).toBeGreaterThan(20);
  });
});
