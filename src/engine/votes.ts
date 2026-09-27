// Решение игроков со своих устройств (ТЗ 6): голосование, ведущий игрок или «кто первый».
export type Choice = 'left' | 'right' | 'escalate' | 'ack';
export type DecisionMode = 'vote' | 'leader' | 'first';

export const DECISION_MODE_LABELS: Record<DecisionMode, string> = {
  vote: 'голосование (большинство)',
  leader: 'решает ведущий игрок',
  first: 'кто первый нажал',
};

export interface Vote {
  playerId: string;
  choice: Choice;
}

export type Decision = { kind: 'choice'; choice: Choice } | { kind: 'tie'; between: Choice[] } | { kind: 'wait' };

/** Кто вправе решать карту: личная — один адресат; спорная — двое, при расхождении — третий. */
export interface Deciders {
  deciders: string[];
  tiebreaker?: string;
}

/** Может ли место голосовать сейчас (с учётом уже поданных голосов). */
export function canVote(seat: string | null, restrict: Deciders | null | undefined, votes: Vote[]): boolean {
  if (!seat) return false;
  if (!restrict) return true;
  if (restrict.deciders.includes(seat)) return true;
  return seat === restrict.tiebreaker && pairSplit(restrict, votes);
}

function pairSplit(r: Deciders, votes: Vote[]): boolean {
  if (r.deciders.length < 2) return false;
  const vs = r.deciders.map((d) => votes.find((v) => v.playerId === d)?.choice);
  return vs.every(Boolean) && vs[0] !== vs[1];
}

/**
 * eligible — id подключённых игроков; final — время вышло, решаем по тем голосам, что есть.
 * В режиме голосования ждём всех подключённых; большинство побеждает, ничья — решает GM.
 */
export function decide(
  mode: DecisionMode,
  votes: Vote[],
  eligible: string[],
  leaderId: string | null,
  final = false,
  restrict?: Deciders | null,
): Decision {
  if (restrict) return decideRestricted(votes, eligible, restrict, final);
  const counted = votes.filter((v) => eligible.includes(v.playerId));
  if (!counted.length) return { kind: 'wait' };
  if (mode === 'first') return { kind: 'choice', choice: counted[0].choice };
  if (mode === 'leader' && leaderId && eligible.includes(leaderId)) {
    const lv = counted.find((v) => v.playerId === leaderId);
    return lv ? { kind: 'choice', choice: lv.choice } : { kind: 'wait' };
  }
  // голосование (и запасной вариант, если ведущий не подключён)
  if (!final && counted.length < eligible.length) return { kind: 'wait' };
  const tally = new Map<Choice, number>();
  for (const v of counted) tally.set(v.choice, (tally.get(v.choice) ?? 0) + 1);
  const max = Math.max(...tally.values());
  const top = [...tally.entries()].filter(([, n]) => n === max).map(([c]) => c);
  return top.length === 1 ? { kind: 'choice', choice: top[0] } : { kind: 'tie', between: top };
}

function decideRestricted(votes: Vote[], eligible: string[], r: Deciders, final: boolean): Decision {
  const vote = (id: string | undefined) => (id ? votes.find((v) => v.playerId === id)?.choice : undefined);
  const online = r.deciders.filter((d) => eligible.includes(d));
  // личная карта: решает только адресат
  if (r.deciders.length === 1) {
    const c = vote(r.deciders[0]);
    return c ? { kind: 'choice', choice: c } : { kind: 'wait' };
  }
  // спорная: оба согласны → решено; разошлись → слово за третьим
  const [a, b] = r.deciders.map(vote);
  if (online.length === 1) {
    const c = vote(online[0]);
    if (c) return { kind: 'choice', choice: c };
  }
  if (a && b && a === b) return { kind: 'choice', choice: a };
  if (a && b) {
    const t = vote(r.tiebreaker);
    if (t) return { kind: 'choice', choice: t };
    return final ? { kind: 'tie', between: [a, b] } : { kind: 'wait' };
  }
  if (final) {
    const one = a ?? b;
    if (one) return { kind: 'choice', choice: one };
  }
  return { kind: 'wait' };
}
