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
): Decision {
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
