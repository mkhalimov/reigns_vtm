import { describe, expect, it } from 'vitest';
import { canVote, decide } from './votes';

const v = (playerId: string, choice: 'left' | 'right' | 'escalate') => ({ playerId, choice });
const all = ['a', 'b', 'c'];

describe('решение игроков', () => {
  it('голосование ждёт всех подключённых, затем большинство', () => {
    expect(decide('vote', [v('a', 'left')], all, null)).toEqual({ kind: 'wait' });
    expect(decide('vote', [v('a', 'left'), v('b', 'right')], all, null)).toEqual({ kind: 'wait' });
    expect(decide('vote', [v('a', 'left'), v('b', 'right'), v('c', 'left')], all, null)).toEqual({ kind: 'choice', choice: 'left' });
  });

  it('ничья — решает GM', () => {
    expect(decide('vote', [v('a', 'left'), v('b', 'right'), v('c', 'escalate')], all, null).kind).toBe('tie');
  });

  it('по таймеру считаются поданные голоса', () => {
    expect(decide('vote', [v('a', 'right')], all, null, true)).toEqual({ kind: 'choice', choice: 'right' });
    expect(decide('vote', [], all, null, true)).toEqual({ kind: 'wait' });
  });

  it('голоса отключившихся не считаются', () => {
    expect(decide('vote', [v('a', 'left'), v('b', 'right')], ['b'], null)).toEqual({ kind: 'choice', choice: 'right' });
  });

  it('ведущий игрок', () => {
    expect(decide('leader', [v('a', 'left')], all, 'b')).toEqual({ kind: 'wait' });
    expect(decide('leader', [v('a', 'left'), v('b', 'right')], all, 'b')).toEqual({ kind: 'choice', choice: 'right' });
    // ведущий не подключён → обычное голосование
    expect(decide('leader', [v('a', 'left'), v('b', 'left')], ['a', 'b'], 'z')).toEqual({ kind: 'choice', choice: 'left' });
  });

  it('кто первый', () => {
    expect(decide('first', [v('c', 'escalate'), v('a', 'left')], all, null)).toEqual({ kind: 'choice', choice: 'escalate' });
  });

  it('личная карта: решает только адресат', () => {
    const r = { deciders: ['b'] };
    expect(decide('vote', [v('a', 'left'), v('c', 'left')], all, null, false, r)).toEqual({ kind: 'wait' });
    expect(decide('vote', [v('a', 'left'), v('b', 'right')], all, null, false, r)).toEqual({ kind: 'choice', choice: 'right' });
    expect(canVote('a', r, [])).toBe(false);
    expect(canVote('b', r, [])).toBe(true);
  });

  it('спорная карта: двое, при расхождении — третий', () => {
    const r = { deciders: ['a', 'b'], tiebreaker: 'c' };
    expect(decide('vote', [v('a', 'left'), v('b', 'left')], all, null, false, r)).toEqual({ kind: 'choice', choice: 'left' });
    expect(decide('vote', [v('a', 'left'), v('b', 'right')], all, null, false, r)).toEqual({ kind: 'wait' });
    expect(canVote('c', r, [])).toBe(false);
    expect(canVote('c', r, [v('a', 'left'), v('b', 'right')])).toBe(true);
    expect(decide('vote', [v('a', 'left'), v('b', 'right'), v('c', 'right')], all, null, false, r)).toEqual({ kind: 'choice', choice: 'right' });
    expect(decide('vote', [v('a', 'left'), v('b', 'right')], all, null, true, r).kind).toBe('tie');
    // второй спорщик не на связи — решает первый
    expect(decide('vote', [v('a', 'left')], ['a', 'c'], null, false, r)).toEqual({ kind: 'choice', choice: 'left' });
  });
});
