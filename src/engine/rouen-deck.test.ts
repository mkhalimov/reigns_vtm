// Проверки боевой колоды data/rouen-deck.json (конвертирована из «Руан — колода на игру»).
import { describe, expect, it } from 'vitest';
import raw from '../../data/rouen-deck.json';
import type { Condition, DeckData, Effect, GameState } from './types';
import { validateDeck } from './validate';
import { acknowledge, choose, currentView, escalate, newGame, nextInterlude, resolveScene, setDraftQueue, startInterlude, type Ctx } from './game';
import { autobuild } from './build';
import { publicView, secretCardFor } from './public';
import { applyRoll, placeEvent, rollEvents } from './events';
import { decidersOf } from './game';

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
    expect(d.cards.filter((c) => !c.event)).toHaveLength(49);
    expect(d.cards.filter((c) => c.event)).toHaveLength(30);
    expect(d.characters?.map((c) => c.name)).toEqual(['Магнус', 'Ева', 'Борис']);
    expect(d.scenes.filter((s) => /^s_[а-яa-z]{1,2}_/.test(s.id) && s.outcomes.length === 2)).toHaveLength(11);
    expect(d.scenes.filter((s) => s.crisisOf)).toHaveLength(8);
    expect(d.cards.filter((c) => c.interlude === 1)).toHaveLength(16);
    expect(d.cards.filter((c) => c.interlude === 2)).toHaveLength(17);
    expect(d.cards.filter((c) => c.interlude === 3)).toHaveLength(16);
  });

  it('у каждой карты есть мастерское описание, и оно не уходит игрокам', () => {
    const d = deck();
    expect(d.cards.filter((c) => !c.event).every((c) => (c.gmNote ?? '').length > 100)).toBe(true);
    const ctx: Ctx = { deck: d, rng: () => 0 };
    let s = newGame(d);
    expect(s.population).toBe(3); // котерия живёт в домене
    s = startInterlude(setDraftQueue(s, ['c01_keys', 'c03_steps']), ctx);
    const pub = publicView(s, d);
    expect(pub.card?.face).toContain('Дюпен');
    expect(pub.trackInfo.masquerade).toContain('скрыт от смертных');
    const json = JSON.stringify(pub);
    for (const secret of ['Гастон', 'Суть.', 'Женевьева', 'Мадам Блез', 'старые_слуги']) expect(json).not.toContain(secret);
    s = choose(s, ctx, 'left');
    s = choose(s, ctx, 'right'); // карта 3 ▶ — сцена «Мёртвые хозяева»
    const scenePub = JSON.stringify(publicView(s, d));
    expect(scenePub).toContain('Мёртвые хозяева');
    for (const secret of ['Этьен', 'Маргерит', 'Оковы']) expect(scenePub).not.toContain(secret);
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

  it('личные карты: решает адресат; спорная — двое и третий', () => {
    const d = deck();
    const c = (id: string) => d.cards.find((x) => x.id.startsWith(id))!;
    expect(decidersOf(c('c04_'))).toEqual({ deciders: ['magnus'] });
    expect(decidersOf(c('c06_'))).toEqual({ deciders: ['eva'] });
    expect(decidersOf(c('c02_'))).toEqual({ deciders: ['magnus', 'boris'], tiebreaker: 'eva' });
    expect(decidersOf(c('c07_'))).toBeNull();
    expect(d.cards.filter((x) => x.owner).length).toBe(18);
    expect(c('c14_').timer).toBeNull();
  });

  it('секретная карта не уходит в общую проекцию и хронику', () => {
    const d = deck();
    const ctx: Ctx = { deck: d, rng: () => 0 };
    let s = startInterlude(setDraftQueue(newGame(d), ['c32_mankada_letter', 'c01_keys']), ctx);
    const pub = publicView(s, d);
    expect(pub.card?.secret).toBe(true);
    expect(pub.card?.left).toBeUndefined();
    expect(JSON.stringify(pub)).not.toContain('Манкад');
    expect(JSON.stringify(pub)).not.toContain('крестик');
    const sec = secretCardFor(s, d)!;
    expect(sec.seat).toBe('boris');
    expect(sec.card.title).toContain('Манкад');
    expect(sec.card.face).toContain('крестик');
    expect(sec.card.left).toBeTruthy();
    s = choose(s, ctx, 'left');
    const pubJournal = JSON.stringify(s.journal.map((e) => e.public));
    expect(pubJournal).not.toContain('Манкад');
    expect(pubJournal).not.toContain('крестик');
    expect(pubJournal).toContain('Личная карта (Борис)');
  });

  it('временные эффекты откатываются в конце интерлюдии', () => {
    const d = deck();
    const ctx: Ctx = { deck: d, rng: () => 0 };
    let s = startInterlude(setDraftQueue(newGame(d), ['ev_mild_02']), ctx);
    s = choose(s, ctx, 'left'); // 📦+1 на интерлюдию, 🩸−1
    expect(s.tracks.capacity).toBe(5); // после конца интерлюдии ёмкость вернулась
    expect(s.tracks.masquerade).toBe(4); // а маскарад — нет
    expect(s.journal.some((e) => e.gm.some((g) => g.includes('Временные эффекты')))).toBe(true);
  });

  it('бросок событий: уровни, повторы, притяжение, «немедленно»', () => {
    const d = deck();
    const seq = (...v: number[]) => {
      let i = 0;
      return () => v[i++ % v.length];
    };
    const s = newGame(d);
    expect(rollEvents(s, d, seq(0.2)).tier).toBe('none'); // d100=21
    const mild = rollEvents(s, d, seq(0.6, 0)); // 61 → мягкое, d12=1
    expect(mild).toMatchObject({ tier: 'mild', die: { sides: 12, value: 1 }, eventId: 'ev_mild_01' });
    // средние — один раз за арку: сдвиг на ближайшее несыгранное
    const played = { ...s, played: ['ev_med_01'] };
    expect(rollEvents(played, d, seq(0.85, 0)).eventId).toBe('ev_med_02');
    // d10 = 10 — выбор мастера
    expect(rollEvents(s, d, seq(0.85, 0.95)).eventId).toBeUndefined();
    // модификаторы: две шкалы в опасной зоне → +6
    const danger = { ...s, tracks: { ...s.tracks, masquerade: 2, court: 9 } };
    expect(rollEvents(danger, d, seq(0.49, 0)).total).toBe(56);
    // притяжение по флагу
    const attracted = rollEvents({ ...s, flags: ['крыло_заперто'] }, d, seq(0.6, 0));
    expect(attracted.attracted).toContain('ev_mild_04');
    // «Немедленно» — первой картой
    const ctx: Ctx = { deck: d, rng: () => 0.99 };
    let g = setDraftQueue(newGame(d), ['c01_keys', 'c07_first_petitioner']);
    g = applyRoll(g, { deck: d, rng: seq(0.9, 0) });
    g = placeEvent(g, ctx, 'ev_med_01');
    expect(g.interlude.queue[0]).toBe('ev_med_01');
  });
});
