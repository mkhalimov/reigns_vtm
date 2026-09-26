// Экран игроков (ТЗ 3.1). Получает только публичную проекцию — GM-данных здесь нет физически.
import { useRef, useState, type ReactNode } from 'react';
import type { PublicState } from '../engine/public';
import type { PublicJournalEntry } from '../engine/journal';
import type { Side } from '../engine/types';
import { DECK_ICONS, DECK_LABELS, TRACK_LABELS } from '../engine/rules';
import type { TimerView } from '../channel';
import type { RoomView } from '../net/protocol';
import type { Choice } from '../engine/votes';
import { Md } from './Md';
import { Tracks } from './Tracks';

interface Props {
  pub: PublicState;
  timer: TimerView;
  journal: PublicJournalEntry[];
  onChoose: (side: Side) => void;
  onEscalate: () => void;
  onAck: () => void;
  corner?: ReactNode;
  /** Режим комнаты: игрок на своём устройстве голосует. */
  room?: RoomView | null;
  banner?: ReactNode;
}

export function PlayerScreen({ pub, timer, journal, onChoose, onEscalate, onAck, corner, room, banner }: Props) {
  const [showJournal, setShowJournal] = useState(false);

  if (pub.hidden)
    return (
      <div className="player-screen splash">
        {corner}
        <div className="splash-inner">
          <div className="splash-sigil">⚜</div>
          <div className="splash-text">Ночь над Руаном…</div>
        </div>
      </div>
    );

  return (
    <div className="player-screen">
      {corner}
      {banner}
      <Tracks tracks={pub.tracks} population={pub.population} reveal={pub.reveal} />
      <div className="player-meta">
        <span>Интерлюдия {pub.interlude}</span>
        {pub.mode === 'card' && (
          <span>
            Карта {pub.cardIndex} из {pub.cardTotal}
          </span>
        )}
        <span>{pub.time}</span>
        <button className="link" onClick={() => setShowJournal(true)}>
          Хроника
        </button>
      </div>

      <div className="player-stage">
        {pub.mode === 'draft' && <div className="waiting">Рассказчик готовит следующую интерлюдию…</div>}
        {pub.mode === 'card' && pub.card && (
          <CardView pub={pub} timer={timer} onChoose={onChoose} onEscalate={onEscalate} onAck={onAck} room={room} key={pub.cardKey} />
        )}
        {pub.mode === 'scene' && pub.scene && (
          <div className={`scene-view ${pub.scene.crisis ? 'crisis' : ''}`}>
            <div className="scene-kicker">{pub.scene.crisis ? 'Кризис' : 'Сцена'}</div>
            <h1>{pub.scene.title}</h1>
            <Md text={pub.scene.text} className="scene-text" />
            <div className="scene-note">Разыгрывается лично. Карты ждут.</div>
          </div>
        )}
        {pub.mode === 'summary' && pub.summary && (
          <div className="summary-view">
            <h1>Итоги интерлюдии {pub.interlude}</h1>
            <SummaryTracks before={pub.summary.before} after={pub.summary.after} />
            <ol className="decisions">
              {pub.summary.decisions.map((d, i) => (
                <li key={i}>
                  <span className="d-title">{d.title}</span> — {d.decision}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {showJournal && (
        <div className="overlay" onClick={() => setShowJournal(false)}>
          <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
            <div className="overlay-head">
              <h2>Хроника</h2>
              <button onClick={() => setShowJournal(false)}>Закрыть</button>
            </div>
            <ul className="journal-list">
              {[...journal].reverse().map((e) => (
                <li key={e.id}>
                  <span className="j-time">
                    И{e.interlude} · {e.time}
                  </span>
                  <Md text={e.text} />
                </li>
              ))}
              {!journal.length && <li>Пока пусто.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export function SummaryTracks({ before, after }: { before: Record<string, number>; after: Record<string, number> }) {
  return (
    <table className="summary-tracks">
      <tbody>
        {Object.keys(after).map((t) => {
          const d = after[t] - before[t];
          return (
            <tr key={t}>
              <td>{TRACK_LABELS[t as keyof typeof TRACK_LABELS]}</td>
              <td>{before[t]}</td>
              <td>→</td>
              <td>{after[t]}</td>
              <td className={d > 0 ? 'up' : d < 0 ? 'down' : ''}>{d ? (d > 0 ? `+${d}` : d) : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CardView({
  pub,
  timer,
  onChoose,
  onEscalate,
  onAck,
  room,
}: Pick<Props, 'pub' | 'timer' | 'onChoose' | 'onEscalate' | 'onAck' | 'room'>) {
  const card = pub.card!;
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; id: number } | null>(null);
  const hasOptions = Boolean(card.left || card.right);
  const locked = pub.awaitingGm;
  const voters = (c: Choice) => room?.votes.filter((v) => v.choice === c).map((v) => v.name) ?? [];
  const mine = (c: Choice) => (room?.myVote === c ? 'voted' : '');
  const Voters = ({ c }: { c: Choice }) =>
    voters(c).length ? (
      <span className="voters">
        {voters(c).map((n, i) => (
          <span key={i} className="voter">
            {n}
          </span>
        ))}
      </span>
    ) : null;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!hasOptions || locked || e.pointerType === 'mouse') return;
    start.current = { x: e.clientX, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (start.current?.id === e.pointerId) setDx(e.clientX - start.current.x);
  };
  const onPointerUp = () => {
    if (!start.current) return;
    start.current = null;
    if (dx < -90 && card.left) onChoose('left');
    else if (dx > 90 && card.right) onChoose('right');
    setDx(0);
  };

  const hint = dx < -40 ? 'left' : dx > 40 ? 'right' : null;
  const pct = timer.total && timer.remaining !== null ? timer.remaining / timer.total : null;

  return (
    <div className="card-wrap">
      <div
        className={`card deck-${card.deck} ${hint ? `hint-${hint}` : ''}`}
        style={{ transform: dx ? `translateX(${dx}px) rotate(${dx / 25}deg)` : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="card-top">
          <span className="card-deck">
            {DECK_ICONS[card.deck]} {DECK_LABELS[card.deck]}
          </span>
          {card.timeOfDay && <span className="card-tod">{card.timeOfDay}</span>}
        </div>
        {card.image && <img className="card-image" src={card.image} alt="" />}
        <h1 className="card-title">{card.title}</h1>
        <Md text={card.face} className="card-face" />
        {card.speaker && <div className="card-speaker">— {card.speaker}</div>}
        {hint && <div className={`swipe-hint ${hint}`}>{hint === 'left' ? card.left : card.right}</div>}
      </div>

      {pct !== null && card.timer !== null && (
        <div className={`timer ${timer.paused ? 'paused' : ''} ${(timer.remaining ?? 0) <= 10 ? 'low' : ''}`}>
          <div className="timer-fill" style={{ width: `${pct * 100}%` }} />
          <span className="timer-text">{timer.paused ? 'пауза' : `${timer.remaining} с`}</span>
        </div>
      )}

      {locked && (
        <div className="awaiting">{room?.tie ? 'Голоса разделились — решает Рассказчик.' : 'Время вышло — решает Рассказчик.'}</div>
      )}

      {hasOptions ? (
        <div className="options">
          <button className={`option left ${mine('left')}`} disabled={locked || !card.left} onClick={() => onChoose('left')}>
            <span className="arrow">◀</span> {card.left}
            <Voters c="left" />
          </button>
          <button className={`option right ${mine('right')}`} disabled={locked || !card.right} onClick={() => onChoose('right')}>
            {card.right} <span className="arrow">▶</span>
            <Voters c="right" />
          </button>
        </div>
      ) : (
        <div className="options">
          <button className={`option single ${mine('ack')}`} onClick={onAck}>
            {card.deck === 'omen' ? 'Принять знамение' : 'Принять к сведению'}
            <Voters c="ack" />
          </button>
        </div>
      )}
      {card.canEscalate && hasOptions && (
        <button className={`escalate ${mine('escalate')}`} disabled={locked} onClick={onEscalate}>
          ⚔ Разбираемся лично
          <Voters c="escalate" />
        </button>
      )}
      {room && !locked && <div className="vote-status">{voteStatus(room)}</div>}
    </div>
  );
}

function voteStatus(room: RoomView): string {
  const n = room.votes.length;
  if (room.mode === 'leader' && room.leaderName)
    return room.isLeader ? 'Вы — ведущий: решение за вами. Голоса остальных — совет.' : `Решает ведущий: ${room.leaderName}. Ваш голос — совет.`;
  if (room.mode === 'first') return 'Решает первый нажавший.';
  return `Проголосовали ${n} из ${room.players}. Решение — когда проголосуют все. Нажмите свой вариант ещё раз, чтобы снять голос.`;
}
