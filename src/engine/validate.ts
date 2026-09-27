// Импорт колоды из JSON с понятными сообщениями об ошибках (ТЗ 9.1).
import {
  COMPARE_OPS,
  CRISIS_TRACKS,
  DECKS,
  TRACKS,
  type Card,
  type Condition,
  type DeckData,
  type Effect,
  type Option,
  type Scene,
} from './types';

export interface DeckParseResult {
  deck: DeckData | null;
  errors: string[];
  warnings: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Переводит позицию ошибки JSON.parse в «строка N, столбец M». */
export function describeJsonError(text: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /position (\d+)/.exec(msg);
  if (m) {
    const pos = Number(m[1]);
    const before = text.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    const lineText = text.split('\n')[line - 1] ?? '';
    return `Некорректный JSON: строка ${line}, столбец ${col}.\n  ${lineText.trim().slice(0, 120)}\n(${msg})`;
  }
  const lc = /line (\d+) column (\d+)/.exec(msg);
  if (lc) return `Некорректный JSON: строка ${lc[1]}, столбец ${lc[2]}. (${msg})`;
  return `Некорректный JSON: ${msg}`;
}

export function parseDeckText(text: string): DeckParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { deck: null, errors: [describeJsonError(text, e)], warnings: [] };
  }
  return validateDeck(raw);
}

function checkCondition(c: unknown, where: string, errors: string[]): void {
  if (!isObj(c)) {
    errors.push(`${where}: условие должно быть объектом`);
    return;
  }
  if ('anyOf' in c || 'allOf' in c) {
    const list = c.anyOf ?? c.allOf;
    if (!Array.isArray(list)) {
      errors.push(`${where}: anyOf/allOf должен быть массивом`);
      return;
    }
    list.forEach((sub, i) => checkCondition(sub, `${where} → [${i}]`, errors));
    return;
  }
  if ('flag' in c) {
    if (!isStr(c.flag) || !c.flag) errors.push(`${where}: flag должен быть непустой строкой`);
    return;
  }
  if ('notFlag' in c) {
    if (!isStr(c.notFlag) || !c.notFlag) errors.push(`${where}: notFlag должен быть непустой строкой`);
    return;
  }
  if ('track' in c || 'timer' in c) {
    if ('track' in c && !([...TRACKS, 'population'] as unknown[]).includes(c.track))
      errors.push(`${where}: неизвестная шкала "${String(c.track)}" (ожидается: ${TRACKS.join(', ')}, population)`);
    if ('timer' in c && (!isStr(c.timer) || !c.timer)) errors.push(`${where}: timer должен быть строкой`);
    if (!COMPARE_OPS.includes(c.op as never))
      errors.push(`${where}: неизвестный оператор "${String(c.op)}" (ожидается: ${COMPARE_OPS.join(' ')})`);
    if (!isNum(c.value)) errors.push(`${where}: value должно быть числом`);
    return;
  }
  errors.push(`${where}: непонятное условие ${JSON.stringify(c)}`);
}

function checkEffect(e: unknown, where: string, errors: string[]): void {
  if (!isObj(e)) {
    errors.push(`${where}: эффект должен быть объектом`);
    return;
  }
  switch (e.type) {
    case 'track':
      if (!(TRACKS as readonly unknown[]).includes(e.track))
        errors.push(`${where}: неизвестная шкала "${String(e.track)}" (ожидается: ${TRACKS.join(', ')})`);
      if (!isNum(e.delta)) errors.push(`${where}: delta должно быть числом`);
      break;
    case 'population':
      if (!isNum(e.delta)) errors.push(`${where}: delta должно быть числом`);
      break;
    case 'setFlag':
    case 'clearFlag':
      if (!isStr(e.flag) || !e.flag) errors.push(`${where}: flag должен быть непустой строкой`);
      break;
    case 'timer':
      if (!isStr(e.id) || !e.id) errors.push(`${where}: id таймера должен быть строкой`);
      if (!isNum(e.delta)) errors.push(`${where}: delta должно быть числом`);
      break;
    case 'addCard':
      if (!isStr(e.card) || !e.card) errors.push(`${where}: card должен быть id карты`);
      if (e.delay !== undefined) {
        if (!isObj(e.delay)) errors.push(`${where}: delay должен быть объектом {cards} или {interludes}`);
        else {
          if (e.delay.cards !== undefined && !isNum(e.delay.cards)) errors.push(`${where}: delay.cards должно быть числом`);
          if (e.delay.interludes !== undefined && !isNum(e.delay.interludes))
            errors.push(`${where}: delay.interludes должно быть числом`);
        }
      }
      break;
    case 'removeCard':
      if (!isStr(e.card) || !e.card) errors.push(`${where}: card должен быть id карты`);
      break;
    case 'note':
      if (!isStr(e.text)) errors.push(`${where}: text должен быть строкой`);
      break;
    default:
      errors.push(
        `${where}: неизвестный тип эффекта "${String(e.type)}" (ожидается: track, population, setFlag, clearFlag, timer, addCard, removeCard, note)`,
      );
  }
}

function checkOption(o: unknown, where: string, errors: string[]): void {
  if (!isObj(o)) {
    errors.push(`${where}: вариант должен быть объектом`);
    return;
  }
  if (!isStr(o.label) || !o.label.trim()) errors.push(`${where}: нет текста решения (label)`);
  if (o.effects !== undefined && !Array.isArray(o.effects)) errors.push(`${where}: effects должен быть массивом`);
  if (Array.isArray(o.effects)) o.effects.forEach((e, i) => checkEffect(e, `${where}, эффект ${i + 1}`, errors));
  if (o.gmNote !== undefined && !isStr(o.gmNote)) errors.push(`${where}: gmNote должен быть строкой`);
  if (o.opensScene !== undefined && !isStr(o.opensScene)) errors.push(`${where}: opensScene должен быть id сцены`);
}

const cardName = (c: unknown, i: number) =>
  isObj(c) && isStr(c.id) ? `Карта #${i + 1} «${c.id}»` : `Карта #${i + 1}`;
const sceneName = (s: unknown, i: number) =>
  isObj(s) && isStr(s.id) ? `Сцена #${i + 1} «${s.id}»` : `Сцена #${i + 1}`;

export function validateDeck(raw: unknown): DeckParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let data: Obj;
  if (Array.isArray(raw)) data = { cards: raw, scenes: [] };
  else if (isObj(raw)) data = raw;
  else return { deck: null, errors: ['Ожидается объект {cards:[...], scenes:[...]} или массив карт'], warnings };

  const cards = data.cards;
  const scenes = data.scenes ?? [];
  if (!Array.isArray(cards)) errors.push('Поле cards отсутствует или не является массивом');
  if (!Array.isArray(scenes)) errors.push('Поле scenes должно быть массивом');
  if (errors.length) return { deck: null, errors, warnings };

  const cardIds = new Set<string>();
  const sceneIds = new Set<string>();

  (scenes as unknown[]).forEach((s, i) => {
    const w = sceneName(s, i);
    if (!isObj(s)) return void errors.push(`${w}: должна быть объектом`);
    if (!isStr(s.id) || !s.id) errors.push(`${w}: нет id`);
    else if (sceneIds.has(s.id)) errors.push(`${w}: id повторяется`);
    else sceneIds.add(s.id);
    if (!isStr(s.title) || !s.title) errors.push(`${w}: нет title`);
    if (s.playerText !== undefined && !isStr(s.playerText)) errors.push(`${w}: playerText должен быть строкой`);
    if (s.gmNotes !== undefined && !isStr(s.gmNotes)) errors.push(`${w}: gmNotes должен быть строкой`);
    if (s.outcomes !== undefined && !Array.isArray(s.outcomes)) errors.push(`${w}: outcomes должен быть массивом`);
    if (Array.isArray(s.outcomes)) {
      if (s.outcomes.length !== 2 && s.outcomes.length !== 0) warnings.push(`${w}: ожидается 2 исхода, найдено ${s.outcomes.length}`);
      s.outcomes.forEach((o, j) => checkOption(o, `${w}, исход ${j + 1}`, errors));
    }
    if (s.crisisOf !== undefined) {
      if (!isObj(s.crisisOf)) errors.push(`${w}: crisisOf должен быть объектом {track, edge}`);
      else {
        if (!(CRISIS_TRACKS as readonly unknown[]).includes(s.crisisOf.track))
          errors.push(`${w}: crisisOf.track — неизвестная шкала "${String(s.crisisOf.track)}"`);
        if (s.crisisOf.edge !== 'low' && s.crisisOf.edge !== 'high')
          errors.push(`${w}: crisisOf.edge должен быть "low" или "high"`);
      }
    }
  });

  (cards as unknown[]).forEach((c, i) => {
    const w = cardName(c, i);
    if (!isObj(c)) return void errors.push(`${w}: должна быть объектом`);
    if (!isStr(c.id) || !c.id) errors.push(`${w}: нет id`);
    else if (cardIds.has(c.id)) errors.push(`${w}: id повторяется`);
    else cardIds.add(c.id);
    if (!isStr(c.title) || !c.title) errors.push(`${w}: нет title`);
    if (!(DECKS as readonly unknown[]).includes(c.deck))
      errors.push(`${w}: неизвестная колода "${String(c.deck)}" (ожидается: ${DECKS.join(', ')})`);
    if (!isStr(c.face) || !c.face.trim()) errors.push(`${w}: нет текста лица (face)`);
    // Без обоих вариантов — карта «без выбора» (знамение, напоминание); ровно один вариант — ошибка.
    const noOptions = c.left === undefined && c.right === undefined;
    if (noOptions && c.deck !== 'omen') warnings.push(`${w}: карта без вариантов — будет «принять к сведению»`);
    for (const side of ['left', 'right'] as const) {
      if (c[side] === undefined) {
        if (!noOptions) errors.push(`${w}: нет варианта ${side === 'left' ? 'left ◀' : 'right ▶'}`);
      } else checkOption(c[side], `${w}, вариант ${side}`, errors);
    }
    if (c.escalation !== undefined && c.escalation !== true && !(isStr(c.escalation) && c.escalation))
      errors.push(`${w}: escalation должен быть id сцены или true`);
    if (c.requires !== undefined) {
      if (!Array.isArray(c.requires)) errors.push(`${w}: requires должен быть массивом условий`);
      else c.requires.forEach((r, j) => checkCondition(r, `${w}, условие ${j + 1}`, errors));
    }
    if (c.timer !== undefined && c.timer !== null && !(isNum(c.timer) && c.timer > 0))
      errors.push(`${w}: timer должен быть положительным числом или null`);
    if (c.oneShot !== undefined && typeof c.oneShot !== 'boolean') errors.push(`${w}: oneShot должен быть true/false`);
    if (c.interlude !== undefined && !isNum(c.interlude)) errors.push(`${w}: interlude должен быть числом`);
    if (c.tags !== undefined && !(Array.isArray(c.tags) && c.tags.every(isStr)))
      errors.push(`${w}: tags должен быть массивом строк`);
    if (c.idleDefault !== undefined && c.idleDefault !== 'left' && c.idleDefault !== 'right')
      errors.push(`${w}: idleDefault должен быть "left" или "right"`);
    for (const f of ['timeOfDay', 'speaker', 'image', 'gmNote'] as const)
      if (c[f] !== undefined && !isStr(c[f])) errors.push(`${w}: ${f} должен быть строкой`);
  });

  if (data.characters !== undefined) {
    if (!Array.isArray(data.characters)) errors.push('characters должен быть массивом {id, name}');
    else
      data.characters.forEach((c, i) => {
        if (!isObj(c) || !isStr(c.id) || !c.id || !isStr(c.name) || !c.name) errors.push(`Персонаж #${i + 1}: нужны поля id и name`);
      });
  }

  if (Array.isArray(data.plotTimers)) {
    data.plotTimers.forEach((t, i) => {
      if (!isObj(t) || !isStr(t.id) || !isStr(t.title))
        errors.push(`Таймер сюжета #${i + 1}: нужны поля id и title`);
    });
  } else if (data.plotTimers !== undefined) errors.push('plotTimers должен быть массивом');

  if (errors.length) return { deck: null, errors, warnings };

  // Перекрёстные ссылки
  const deck = normalizeDeck(data as unknown as DeckData);
  const refScene = (id: string | undefined, where: string) => {
    if (id && !sceneIds.has(id)) errors.push(`${where}: ссылка на несуществующую сцену "${id}"`);
  };
  const refEffects = (effects: Effect[], where: string) =>
    effects.forEach((e, k) => {
      if ((e.type === 'addCard' || e.type === 'removeCard') && !cardIds.has(e.card))
        errors.push(`${where}, эффект ${k + 1}: ссылка на несуществующую карту "${e.card}"`);
    });
  const refOption = (o: Option | undefined, where: string) => {
    if (!o) return;
    refScene(o.opensScene, where);
    refEffects(o.effects, where);
  };
  deck.cards.forEach((c, i) => {
    const w = cardName(c, i);
    if (typeof c.escalation === 'string') refScene(c.escalation, `${w}, escalation`);
    refOption(c.left, `${w}, вариант left`);
    refOption(c.right, `${w}, вариант right`);
  });
  deck.scenes.forEach((s, i) => s.outcomes.forEach((o, j) => refOption(o, `${sceneName(s, i)}, исход ${j + 1}`)));

  for (const t of CRISIS_TRACKS)
    for (const edge of ['low', 'high'] as const)
      if (!deck.scenes.some((s) => s.crisisOf?.track === t && s.crisisOf.edge === edge))
        warnings.push(`Нет кризисной сцены для шкалы ${t} (${edge === 'low' ? '0' : '10'}) — будет использована заглушка`);

  if (errors.length) return { deck: null, errors, warnings };
  return { deck, errors, warnings };
}

function normalizeOption(o: Option | undefined): Option | undefined {
  if (!o) return undefined;
  return { ...o, effects: o.effects ?? [] };
}

export function normalizeDeck(d: DeckData): DeckData {
  return {
    title: d.title,
    characters: d.characters,
    plotTimers: d.plotTimers ?? [],
    scenes: (d.scenes ?? []).map((s: Scene) => ({
      ...s,
      playerText: s.playerText ?? '',
      outcomes: (s.outcomes ?? []).map((o) => normalizeOption(o)!),
    })),
    cards: d.cards.map((c: Card) => ({
      ...c,
      left: normalizeOption(c.left),
      right: normalizeOption(c.right),
      requires: c.requires as Condition[] | undefined,
    })),
  };
}
