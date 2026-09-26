import { describe, expect, it } from 'vitest';
import demo from '../../data/demo-deck.json';
import type { Card, DeckData, GameState, Scene } from './types';
import { parseDeckText, validateDeck } from './validate';
import {
  acknowledge,
  choose,
  currentView,
  escalate,
  handleTimeout,
  interludeSummary,
  moveSceneRequest,
  newGame,
  nextInterlude,
  resolveScene,
  setDraftQueue,
  setTrack,
  startInterlude,
  updateSceneRequest,
  type Ctx,
} from './game';
import { autobuild } from './build';
import { availableIds } from './rules';
import { publicView } from './public';
import { journalToMarkdown, publicJournal } from './journal';
import { makeSave, parseSave } from './save';

const seq = (...vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

function loadDemo(): DeckData {
  const r = validateDeck(demo);
  expect(r.errors).toEqual([]);
  return r.deck!;
}

function start(deck: DeckData, queue: string[], patch: (s: GameState) => void = () => {}): { s: GameState; ctx: Ctx } {
  const ctx: Ctx = { deck, rng: seq(0) };
  let s = newGame(deck);
  patch(s);
  s = setDraftQueue(s, queue);
  s = startInterlude(s, ctx);
  return { s, ctx };
}

// Синтетическая колода 49 карт + 11 сцен (критерий 9.1)
function bigDeck(): unknown {
  const decks = ['routine', 'deruan', 'night', 'gates', 'court', 'mirror', 'omen'];
  const cards: Partial<Card>[] = [];
  for (let i = 0; i < 49; i++) {
    const deck = decks[i % 7];
    cards.push({
      id: `c${String(i + 1).padStart(2, '0')}`,
      title: `Карта ${i + 1}`,
      deck: deck as Card['deck'],
      face: `Лицо карты ${i + 1}`,
      ...(deck === 'omen' && i % 2
        ? {}
        : {
            left: { label: 'Влево', effects: [{ type: 'track', track: 'court', delta: 1 }] },
            right: { label: 'Вправо', effects: [{ type: 'setFlag', flag: `f${i}` }] },
          }),
      ...(i === 10 ? { requires: [{ flag: 'f3' }], escalation: 's_extra1' } : {}),
    });
  }
  const scenes: Partial<Scene>[] = [];
  for (const track of ['masquerade', 'court', 'city', 'night'] as const)
    for (const edge of ['low', 'high'] as const)
      scenes.push({
        id: `x_${track}_${edge}`,
        title: `Кризис ${track} ${edge}`,
        playerText: '...',
        crisisOf: { track, edge },
        outcomes: [
          { label: 'А', effects: [] },
          { label: 'Б', effects: [] },
        ],
      });
  for (let i = 1; i <= 3; i++)
    scenes.push({ id: `s_extra${i}`, title: `Сцена ${i}`, playerText: '', outcomes: [{ label: 'А', effects: [] }, { label: 'Б', effects: [] }] });
  return { cards, scenes };
}

describe('импорт колоды (9.1)', () => {
  it('49 карт и 11 сцен импортируются без ошибок', () => {
    const r = validateDeck(bigDeck());
    expect(r.errors).toEqual([]);
    expect(r.deck!.cards).toHaveLength(49);
    expect(r.deck!.scenes).toHaveLength(11);
  });

  it('демо-колода валидна', () => {
    const d = loadDemo();
    expect(d.scenes).toHaveLength(11);
  });

  it('ошибка указывает на карту', () => {
    const raw = bigDeck() as { cards: Record<string, unknown>[] };
    raw.cards[6].deck = 'nigth';
    delete raw.cards[12].left;
    (raw.cards[20] as { left: { effects: unknown[] } }).left.effects.push({ type: 'track', track: 'mascarade', delta: 1 });
    const r = validateDeck(raw);
    expect(r.deck).toBeNull();
    expect(r.errors.join('\n')).toContain('Карта #7 «c07»: неизвестная колода "nigth"');
    expect(r.errors.join('\n')).toContain('Карта #13 «c13»: нет варианта left');
    expect(r.errors.join('\n')).toContain('Карта #21 «c21», вариант left, эффект 2: неизвестная шкала "mascarade"');
  });

  it('битые ссылки на сцены и карты', () => {
    const raw = bigDeck() as { cards: Record<string, unknown>[] };
    raw.cards[0].escalation = 's_nope';
    const r = validateDeck(raw);
    expect(r.errors[0]).toContain('«c01»');
    expect(r.errors[0]).toContain('s_nope');
  });

  it('синтаксическая ошибка JSON с номером строки', () => {
    const r = parseDeckText('{\n  "cards": [\n    { "id": "a", }\n  ]\n}');
    expect(r.deck).toBeNull();
    expect(r.errors[0]).toMatch(/Некорректный JSON/);
  });
});

describe('выбор и условия (9.2)', () => {
  it('выбор меняет шкалы и флаги', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['c07_first_petitioner', 'r01_tithe']);
    const s2 = choose(s, ctx, 'left');
    expect(s2.tracks.night).toBe(6);
    expect(s2.tracks.court).toBe(4);
    expect(s2.flags).toContain('open_gates');
    expect(s2.population).toBe(1);
    expect(s2.played).toContain('c07_first_petitioner');
    expect(s2.interlude.pos).toBe(1);
    // исходное состояние не мутировано
    expect(s.tracks.night).toBe(5);
  });

  it('карта с requires попадает в пул только при выполнении условий', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['c07_first_petitioner']);
    expect(availableIds(deck, s)).not.toContain('n02_hungry');
    expect(availableIds(deck, s)).not.toContain('g02_caravan');
    const s2 = choose(s, ctx, 'left');
    expect(availableIds(deck, s2)).toContain('n02_hungry');
    expect(availableIds(deck, s2)).toContain('g02_caravan'); // anyOf
    expect(availableIds(deck, s2)).not.toContain('c07_first_petitioner'); // oneShot
  });

  it('условие по таймеру и шкале', () => {
    const deck = loadDemo();
    let s = newGame(deck);
    expect(availableIds(deck, s)).not.toContain('k03_summons');
    s = { ...s, timers: { ...s.timers, lucian_patience: 2 } };
    expect(availableIds(deck, s)).toContain('k03_summons');
    s = { ...s, tracks: { ...s.tracks, city: 7 } };
    expect(availableIds(deck, s)).toContain('g02_caravan');
  });

  it('шкалы ограничены 0–10', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['r04_patrol'], (x) => (x.tracks.masquerade = 1));
    const s2 = choose(s, ctx, 'right');
    expect(s2.tracks.masquerade).toBe(0);
  });

  it('addCard с задержкой в интерлюдию и removeCard', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['d02_archive', 'd03_portrait', 'r01_tithe']);
    const s2 = choose(s, ctx, 'right'); // removeCard d03_portrait
    expect(s2.interlude.queue).toEqual(['d02_archive', 'r01_tithe']);
    expect(s2.removed).toContain('d03_portrait');
    const s3 = choose(s, ctx, 'left'); // addCard d03 через 1 интерлюдию
    expect(s3.pending).toEqual([expect.objectContaining({ card: 'd03_portrait', dueInterlude: 2 })]);
  });

  it('знамение без вариантов принимается', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['o01_bells', 'r01_tithe']);
    expect(choose(s, ctx, 'left')).toBe(s);
    const s2 = acknowledge(s, ctx);
    expect(s2.interlude.pos).toBe(1);
  });
});

describe('кризис (9.3)', () => {
  it('шкала на краю останавливает игру и открывает кризисную сцену; после исхода — откат', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['r04_patrol', 'r01_tithe'], (x) => (x.tracks.masquerade = 2));
    const s2 = choose(s, ctx, 'right'); // маскарад -2 → 0
    const v = currentView(s2, deck);
    expect(v.kind).toBe('scene');
    if (v.kind !== 'scene') return;
    expect(v.request.kind).toBe('crisis');
    expect(v.scene?.id).toBe('x_masq_low');
    const s3 = resolveScene(s2, ctx, { outcome: 0 });
    expect(s3.tracks.masquerade).toBe(2);
    expect(currentView(s3, deck).kind).toBe('card');
  });

  it('откат настраивается в сцене; верхний край → 8', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['k01_envoy', 'r01_tithe'], (x) => (x.tracks.court = 9));
    const s2 = choose(s, ctx, 'right'); // двор +2 → 10
    expect(s2.sceneQueue[0]).toMatchObject({ kind: 'crisis', track: 'court', edge: 'high', rollback: 8 });
    const s3 = updateSceneRequest(s2, s2.sceneQueue[0].id, { rollback: 7 });
    const s4 = resolveScene(s3, ctx, { outcome: 1 });
    expect(s4.tracks.court).toBe(7);
  });

  it('несколько кризисов идут в очередь, GM меняет порядок', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['c07_first_petitioner', 'r01_tithe'], (x) => {
      x.tracks.night = 9;
      x.tracks.court = 1;
    });
    const s2 = choose(s, ctx, 'left'); // night 10, court 0
    expect(s2.sceneQueue.map((r) => r.kind === 'crisis' && r.track)).toEqual(['court', 'night']);
    const s3 = moveSceneRequest(s2, s2.sceneQueue[1].id, -1);
    expect(s3.sceneQueue.map((r) => r.kind === 'crisis' && r.track)).toEqual(['night', 'court']);
    const s4 = resolveScene(s3, ctx, { outcome: 1 }); // night: «Возглавить» — маскарад −2, откат ночи к 8
    expect(s4.tracks.night).toBe(8);
    expect(currentView(s4, deck).kind).toBe('scene');
    const s5 = resolveScene(s4, ctx, { outcome: 1 });
    expect(s5.tracks.court).toBe(2);
    expect(currentView(s5, deck).kind).toBe('card');
  });
});

describe('эскалация (9.4)', () => {
  it('открывает сцену, добавляет рутину и применяет −1', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['c07_first_petitioner']);
    const s2 = escalate(s, ctx);
    const v = currentView(s2, deck);
    expect(v.kind).toBe('scene');
    if (v.kind !== 'scene' || v.request.kind !== 'escalation') throw new Error('ожидалась эскалация');
    expect(v.scene?.id).toBe('s_petitioner_story');
    expect(s2.interlude.queue).toHaveLength(2);
    expect(deck.cards.find((c) => c.id === s2.interlude.queue[1])?.deck).toBe('routine');
    // GM меняет шкалу для −1
    const s3 = updateSceneRequest(s2, v.request.id, { penaltyTrack: 'city' });
    const s4 = resolveScene(s3, ctx, { outcome: 1 });
    expect(s4.tracks.city).toBe(4);
    expect(s4.tracks.court).toBe(6); // исход сцены
    expect(s4.flags).toContain('rouen_like_all');
    expect(s4.interlude.plays[0].decision).toContain('Разбираемся лично');
    expect(currentView(s4, deck).kind).toBe('card');
  });

  it('без связанной сцены эскалация недоступна, пока GM не разрешит', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['r01_tithe']);
    expect(escalate(s, ctx)).toBe(s);
    const s2 = escalate({ ...s, escalationAllowed: true }, ctx);
    expect(s2.sceneQueue).toHaveLength(1);
    const s3 = resolveScene(s2, ctx, { custom: [{ type: 'track', track: 'city', delta: 2 }], customLabel: 'Договорились' });
    expect(s3.journal.some((e) => e.public?.includes('Договорились'))).toBe(true);
  });
});

describe('таймер (5.2)', () => {
  it('pause → ждём GM; random; worst', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['r01_tithe', 'r02_roof']);
    expect(handleTimeout(s, ctx).awaitingGm).toBe(true);
    const worst = handleTimeout({ ...s, settings: { ...s.settings, onTimeout: 'worst' } }, ctx);
    expect(worst.interlude.plays[0].side).toBe('right'); // idleDefault
    const rnd = handleTimeout({ ...s, settings: { ...s.settings, onTimeout: 'random' } }, { ...ctx, rng: seq(0.9) });
    expect(rnd.interlude.plays[0].side).toBe('right');
  });
});

describe('ёмкость и конец интерлюдии (5.6)', () => {
  it('население > ёмкости → маскарад −1 и карта-конфликт', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['r01_tithe'], (x) => (x.population = 7));
    const s2 = choose(s, ctx, 'left');
    expect(s2.tracks.masquerade).toBe(4);
    expect(s2.pending.some((p) => p.source === 'capacity' && p.dueInterlude === 2)).toBe(true);
    expect(currentView(s2, deck).kind).toBe('summary');
    const s3 = nextInterlude(s2, ctx);
    const b = autobuild(s3, deck, seq(0.3));
    const conflict = s2.pending.find((p) => p.source === 'capacity')!.card;
    expect(b.queue).toContain(conflict);
  });

  it('итоги интерлюдии', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['c07_first_petitioner']);
    const s2 = choose(s, ctx, 'left');
    const sum = interludeSummary(s2, deck);
    expect(sum.tracksBefore.night).toBe(5);
    expect(sum.tracksAfter.night).toBe(6);
    expect(sum.flagsSet).toContain('open_gates');
    expect(sum.unlocked).toEqual(expect.arrayContaining(['n02_hungry', 'g02_caravan', 'k02_harpy']));
  });
});

describe('автосборка (5.3)', () => {
  it('3 рутины, линии, зеркало, знамение, без дублей и сыгранных', () => {
    const deck = loadDemo();
    const s = newGame(deck);
    const { queue } = autobuild(s, deck, seq(0.1, 0.7, 0.4));
    const decks = queue.map((id) => deck.cards.find((c) => c.id === id)!.deck);
    expect(decks.filter((d) => d === 'routine')).toHaveLength(3);
    expect(decks.filter((d) => d === 'mirror')).toHaveLength(1);
    expect(decks.filter((d) => d === 'omen')).toHaveLength(1);
    expect(decks.filter((d) => ['deruan', 'night', 'gates', 'court'].includes(d))).toHaveLength(4);
    expect(new Set(queue).size).toBe(queue.length);
    // карты с невыполненными условиями не попадают
    expect(queue).not.toContain('n02_hungry');
  });
});

describe('безопасность спойлеров (9.5)', () => {
  it('публичная проекция не содержит флагов, заметок, эффектов', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['c07_first_petitioner', 'r03_ghoul_errand'], (x) => x.flags.push('secret_flag_x'));
    const views = [publicView(s, deck)];
    const s2 = escalate(s, ctx);
    views.push(publicView(s2, deck));
    const s3 = resolveScene(s2, ctx, { outcome: 0 });
    views.push(publicView(s3, deck));
    const s4 = choose(s3, ctx, 'right');
    views.push(publicView(s4, deck));
    const json = JSON.stringify(views) + JSON.stringify(publicJournal(s4));
    for (const secret of [
      'secret_flag_x',
      'open_gates',
      'madeleine_exposed',
      'Не агент Луциана',
      'Её зовут Ноэми',
      'setFlag',
      'effects',
      'gmNote',
      'засветится',
      's_petitioner_story',
      'requires',
    ])
      expect(json).not.toContain(secret);
    expect(views[0].card?.left).toBe('Принять под правила домена');
    expect(views[0].card?.canEscalate).toBe(true);
    expect(views[1].scene?.title).toBe('История просительницы');
  });

  it('скрытый экран не отдаёт карту', () => {
    const deck = loadDemo();
    const { s } = start(deck, ['c07_first_petitioner']);
    const v = publicView({ ...s, playerScreenHidden: true }, deck);
    expect(v.card).toBeUndefined();
    expect(v.hidden).toBe(true);
  });

  it('точные числа сдвига только по настройке', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['c07_first_petitioner', 'r01_tithe']);
    const s2 = choose(s, ctx, 'left');
    expect(publicView(s2, deck).reveal?.deltas.night).toBe('up');
    expect(publicView({ ...s2, settings: { ...s2.settings, showDeltaNumbers: true } }, deck).reveal?.deltas.court).toBe(-1);
  });
});

describe('сохранение (9.6) и журнал (9.7)', () => {
  it('сохранение переживает сериализацию', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['c07_first_petitioner', 'r01_tithe']);
    const s2 = choose(s, ctx, 'left');
    const text = JSON.stringify(makeSave(deck, s2, [s]));
    const r = parseSave(text);
    expect(r.error).toBeUndefined();
    expect(r.save!.game).toEqual(s2);
    expect(r.save!.history).toHaveLength(1);
    expect(parseSave('{"format":"x"}').error).toBeTruthy();
  });

  it('Markdown: «что решили» отдельно от GM-деталей', () => {
    const deck = loadDemo();
    const { s, ctx } = start(deck, ['c07_first_petitioner', 'r01_tithe']);
    let s2 = choose(s, ctx, 'left');
    s2 = setTrack(s2, ctx, 'city', 9);
    const gm = journalToMarkdown(s2, { gm: true });
    const pl = journalToMarkdown(s2, { gm: false });
    expect(gm).toContain('### Что решили');
    expect(gm).toContain('### Детали для GM');
    expect(gm).toContain('open_gates');
    expect(pl).toContain('Первый проситель» — Принять под правила домена');
    expect(pl).not.toContain('open_gates');
    expect(pl).not.toContain('Детали для GM');
    expect(pl).not.toContain('Правка');
  });
});
