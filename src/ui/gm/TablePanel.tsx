// Пульт GM: текущая карта/сцена/сборка/итоги + боковая панель правок (ТЗ 3.2, 3.4, 3.5).
import { useMemo, useState } from 'react';
import {
  CRISIS_TRACKS,
  DECKS,
  TRACKS,
  type Card,
  type CrisisTrackId,
  type DeckData,
  type Effect,
  type GameState,
  type SceneRequest,
  type TrackId,
} from '../../engine/types';
import {
  acknowledge,
  choose,
  currentView,
  dropSceneRequest,
  escalate,
  escalationAvailable,
  fallbackScene,
  interludeSummary,
  moveSceneRequest,
  nextInterlude,
  openScene,
  patchState,
  resolveScene,
  sceneForRequest,
  setDraftQueue,
  setPlotTimer,
  setTrack,
  startInterlude,
  toggleFlag,
  upcomingQueue,
  updateSceneRequest,
} from '../../engine/game';
import { autobuild } from '../../engine/build';
import { cardTimerSeconds, checkAll, DECK_LABELS, isAvailable, isOneShot, TRACK_ICONS, TRACK_LABELS } from '../../engine/rules';
import { dispatch, useApp } from '../../store';
import { disableTimer, pauseTimer, resetTimer, useTimer } from '../../timer';
import { Md } from '../Md';
import { SummaryTracks } from '../PlayerScreen';
import { DeckTag, EffectList, MasterNote, OptionBlock, Requires } from './common';
import { RoomPanel } from './RoomPanel';

export function TablePanel() {
  const deck = useApp((s) => s.deck);
  const game = useApp((s) => s.game);
  const view = currentView(game, deck);

  return (
    <div className="table-layout">
      <main className="table-main">
        {view.kind === 'draft' && <DraftBuilder game={game} deck={deck} />}
        {view.kind === 'card' && <CurrentCard card={view.card} game={game} deck={deck} />}
        {view.kind === 'scene' && <SceneControl req={view.request} game={game} deck={deck} />}
        {view.kind === 'summary' && <SummaryGm game={game} deck={deck} />}
        {view.kind !== 'draft' && game.interlude.status !== 'summary' && <QueueEditor game={game} deck={deck} />}
        <Pool game={game} deck={deck} />
      </main>
      <aside className="table-side">
        <RoomPanel />
        <TrackEditor game={game} />
        {game.sceneQueue.length > 0 && <SceneQueue game={game} deck={deck} />}
        <Flags game={game} />
        <PlotTimers game={game} deck={deck} />
        <Pending game={game} deck={deck} />
        <ManualScene deck={deck} />
      </aside>
    </div>
  );
}

// ---------- текущая карта ----------

function CurrentCard({ card, game, deck }: { card: Card; game: GameState; deck: DeckData }) {
  const timer = useTimer();
  const seconds = cardTimerSeconds(card, game.settings);
  const hasOptions = Boolean(card.left || card.right);
  const esc = typeof card.escalation === 'string' ? deck.scenes.find((s) => s.id === card.escalation) : undefined;
  return (
    <section className="panel current">
      <div className="panel-head">
        <h2>
          Карта {game.interlude.pos + 1} из {game.interlude.queue.length}
        </h2>
        <DeckTag card={card} />
        <code className="muted">{card.id}</code>
      </div>
      {game.awaitingGm && <div className="alert">Игроки ждут решения Рассказчика (время вышло или голоса разделились). Выберите вариант за игроков или сбросьте таймер.</div>}
      <div className="current-grid">
        <div className="current-face">
          <h3>{card.title}</h3>
          {card.timeOfDay && <div className="muted small">{card.timeOfDay}</div>}
          <Md text={card.face} />
          {card.speaker && <div className="muted">— {card.speaker}</div>}
          <Requires card={card} />
          <div className="small">
            ⚡ Эскалация:{' '}
            {esc ? (
              <b>{esc.title}</b>
            ) : card.escalation === true ? (
              <b>импровизация (исход вводит GM)</b>
            ) : (
              <label>
                <input
                  type="checkbox"
                  checked={game.escalationAllowed}
                  onChange={(e) => dispatch((g) => patchState(g, { escalationAllowed: e.target.checked }))}
                />{' '}
                разрешить без заготовленной сцены
              </label>
            )}
          </div>
          {card.tags?.length ? <div className="small muted">теги: {card.tags.join(', ')}</div> : null}
        </div>
        <div className="current-options">
          <OptionBlock side="◀" opt={card.left} deck={deck} idle={card.idleDefault === 'left'} />
          <OptionBlock side="▶" opt={card.right} deck={deck} idle={card.idleDefault === 'right'} />
        </div>
      </div>
      <MasterNote text={card.gmNote} />
      <div className="row wrap">
        {hasOptions ? (
          <>
            <button disabled={!card.left} onClick={() => dispatch((g, c) => choose(g, c, 'left', 'gm'))}>
              ◀ Выбрать за игроков
            </button>
            <button disabled={!card.right} onClick={() => dispatch((g, c) => choose(g, c, 'right', 'gm'))}>
              Выбрать за игроков ▶
            </button>
            <button disabled={!escalationAvailable(game, card)} onClick={() => dispatch(escalate)}>
              ⚔ Разбираемся лично
            </button>
          </>
        ) : (
          <button onClick={() => dispatch(acknowledge)}>{card.deck === 'omen' ? 'Принять знамение' : 'Принять к сведению'}</button>
        )}
        <span className="spacer" />
        {seconds !== null ? (
          <div className="row timer-ctl">
            <span className="mono">
              ⏱ {timer.disabled ? 'выкл' : `${timer.remaining ?? '—'} / ${seconds} с`}
              {timer.paused && ' (пауза)'}
            </span>
            <button onClick={() => pauseTimer(!timer.paused)}>{timer.paused ? '▶ Пуск' : '⏸ Пауза'}</button>
            <button
              onClick={() => {
                resetTimer();
                if (game.awaitingGm) dispatch((g) => patchState(g, { awaitingGm: false }));
              }}
            >
              ↺ Сброс
            </button>
            <button onClick={() => disableTimer(!timer.disabled)}>{timer.disabled ? 'Включить' : 'Отключить'}</button>
          </div>
        ) : (
          <span className="muted small">без таймера</span>
        )}
      </div>
    </section>
  );
}

// ---------- сцена ----------

function SceneControl({ req, game, deck }: { req: SceneRequest; game: GameState; deck: DeckData }) {
  const scene = sceneForRequest(req, deck) ?? fallbackScene(req, deck);
  const [custom, setCustom] = useState(false);
  return (
    <section className={`panel scene-ctl ${req.kind === 'crisis' ? 'crisis' : ''}`}>
      <div className="panel-head">
        <h2>
          {req.kind === 'crisis' ? 'Кризис' : req.kind === 'escalation' ? 'Эскалация' : 'Сцена'}: {scene.title}
        </h2>
        {!sceneForRequest(req, deck) && <span className="chip warn">заглушка</span>}
      </div>
      <div className="muted small">Игроки видят:</div>
      <Md text={scene.playerText || '—'} className="player-text" />
      <MasterNote text={scene.gmNotes} />
      {req.kind === 'escalation' && (
        <div className="row">
          Цена времени: −1 к шкале{' '}
          <select
            value={req.penaltyTrack}
            onChange={(e) => dispatch((g) => updateSceneRequest(g, req.id, { penaltyTrack: e.target.value as CrisisTrackId }))}
          >
            {CRISIS_TRACKS.map((t) => (
              <option key={t} value={t}>
                {TRACK_LABELS[t]} ({game.tracks[t]})
              </option>
            ))}
          </select>
          <span className="muted small">(предложена случайно; применится вместе с исходом)</span>
        </div>
      )}
      {req.kind === 'crisis' && (
        <div className="row">
          После исхода {TRACK_LABELS[req.track]} откатится к{' '}
          <input
            type="number"
            min={0}
            max={10}
            className="num"
            value={req.rollback}
            onChange={(e) => dispatch((g) => updateSceneRequest(g, req.id, { rollback: Number(e.target.value) }))}
          />
        </div>
      )}
      <div className="outcomes">
        {scene.outcomes.map((o, i) => (
          <div key={i} className="outcome">
            <OptionBlock side={`Исход ${i + 1}:`} opt={o} deck={deck} />
            <button onClick={() => dispatch((g, c) => resolveScene(g, c, { outcome: i }))}>Применить исход {i + 1}</button>
          </div>
        ))}
      </div>
      <div className="row">
        <button onClick={() => setCustom(!custom)}>{custom ? 'Скрыть' : '✎ Свой исход'}</button>
        <button className="ghost" onClick={() => confirm('Снять сцену без исхода?') && dispatch((g, c) => dropSceneRequest(g, c, req.id))}>
          Снять без исхода
        </button>
      </div>
      {custom && <CustomOutcome deck={deck} onApply={(effects, label) => dispatch((g, c) => resolveScene(g, c, { custom: effects, customLabel: label }))} />}
    </section>
  );
}

function CustomOutcome({ deck, onApply }: { deck: DeckData; onApply: (e: Effect[], label: string) => void }) {
  const [label, setLabel] = useState('');
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const [flagsOn, setFlagsOn] = useState('');
  const [flagsOff, setFlagsOff] = useState('');
  const [note, setNote] = useState('');
  const [addCard, setAddCard] = useState('');
  const split = (s: string) =>
    s
      .split(/[,\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  const build = (): Effect[] => [
    ...TRACKS.filter((t) => deltas[t]).map((t): Effect => ({ type: 'track', track: t, delta: deltas[t] })),
    ...(deltas.population ? [{ type: 'population', delta: deltas.population } as Effect] : []),
    ...split(flagsOn).map((flag): Effect => ({ type: 'setFlag', flag })),
    ...split(flagsOff).map((flag): Effect => ({ type: 'clearFlag', flag })),
    ...(addCard ? [{ type: 'addCard', card: addCard } as Effect] : []),
    ...(note.trim() ? [{ type: 'note', text: note.trim() } as Effect] : []),
  ];
  return (
    <div className="custom-outcome">
      <label>
        Что решили (видят игроки)
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Свой исход" />
      </label>
      <div className="deltas">
        {[...TRACKS, 'population' as const].map((t) => (
          <label key={t}>
            {TRACK_LABELS[t]}
            <input
              type="number"
              className="num"
              value={deltas[t] ?? 0}
              onChange={(e) => setDeltas({ ...deltas, [t]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      <label>
        Поставить флаги (через запятую)
        <input value={flagsOn} onChange={(e) => setFlagsOn(e.target.value)} />
      </label>
      <label>
        Снять флаги
        <input value={flagsOff} onChange={(e) => setFlagsOff(e.target.value)} />
      </label>
      <label>
        Добавить карту следующей
        <select value={addCard} onChange={(e) => setAddCard(e.target.value)}>
          <option value="">—</option>
          {deck.cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} ({c.id})
            </option>
          ))}
        </select>
      </label>
      <label>
        Заметка в журнал GM
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <EffectList effects={build()} deck={deck} />
      <button className="primary" onClick={() => onApply(build(), label)}>
        Применить свой исход
      </button>
    </div>
  );
}

// ---------- сборка интерлюдии ----------

function DraftBuilder({ game, deck }: { game: GameState; deck: DeckData }) {
  const [notes, setNotes] = useState<string[]>([]);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Интерлюдия {game.interlude.number}: сборка</h2>
      </div>
      <div className="row wrap">
        <button
          onClick={() => {
            const r = autobuild(game, deck);
            setNotes(r.notes);
            dispatch((g) => setDraftQueue(g, r.queue));
          }}
        >
          🎲 Автосборка
        </button>
        <button className="ghost" onClick={() => dispatch((g) => setDraftQueue(g, []))}>
          Очистить
        </button>
        <span className="spacer" />
        <button className="primary" disabled={!game.interlude.queue.length && !game.pending.length} onClick={() => dispatch(startInterlude)}>
          ▶ Начать интерлюдию
        </button>
      </div>
      {notes.map((n, i) => (
        <div key={i} className="muted small">
          {n}
        </div>
      ))}
      <MasterNote text={deck.gmReference} title="📖 Справка мастера" open={false} />
      <QueueList game={game} deck={deck} />
    </section>
  );
}

function QueueEditor({ game, deck }: { game: GameState; deck: DeckData }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Очередь интерлюдии</h2>
        <span className="muted small">перетаскивайте карты, чтобы поменять порядок</span>
      </div>
      <QueueList game={game} deck={deck} />
    </section>
  );
}

function QueueList({ game, deck }: { game: GameState; deck: DeckData }) {
  const q = upcomingQueue(game);
  const running = game.interlude.status !== 'draft';
  const played = running ? game.interlude.queue.slice(0, game.interlude.pos) : [];
  const [drag, setDrag] = useState<number | null>(null);
  const setQ = (next: string[]) => dispatch((g) => setDraftQueue(g, next));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= q.length || from === to) return;
    const next = [...q];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setQ(next);
  };
  const title = (id: string) => deck.cards.find((c) => c.id === id);
  return (
    <ol className="queue">
      {played.map((id, i) => (
        <li key={`p${i}`} className="played">
          <span className="q-n">{i + 1}</span> {title(id)?.title ?? id} <span className="muted small">сыграна</span>
        </li>
      ))}
      {q.map((id, i) => {
        const c = title(id);
        const isCurrent = running && i === 0 && game.sceneQueue.length === 0;
        return (
          <li
            key={`${id}-${i}`}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag !== null) move(drag, i);
              setDrag(null);
            }}
            className={`${isCurrent ? 'current' : ''} ${drag === i ? 'dragging' : ''}`}
          >
            <span className="q-n">{played.length + i + 1}</span>
            <span className="grip">⋮⋮</span>
            {c ? <DeckTag card={c} /> : <span className="chip warn">нет в колоде</span>}
            <span className="q-title">{c?.title ?? id}</span>
            {isCurrent && <span className="chip">сейчас</span>}
            {c && !isAvailable(c, game) && !isCurrent && <span className="chip warn" title="Условия не выполнены или карта сыграна">⚠</span>}
            <span className="spacer" />
            <button className="icon" onClick={() => move(i, i - 1)} title="Выше">
              ↑
            </button>
            <button className="icon" onClick={() => move(i, i + 1)} title="Ниже">
              ↓
            </button>
            <button className="icon" onClick={() => setQ(q.filter((_, j) => j !== i))} title="Убрать из очереди">
              ✕
            </button>
          </li>
        );
      })}
      {!q.length && <li className="muted">Очередь пуста</li>}
    </ol>
  );
}

// ---------- пул ----------

function Pool({ game, deck }: { game: GameState; deck: DeckData }) {
  const [deckF, setDeckF] = useState<string>('');
  const [status, setStatus] = useState<'available' | 'unlocked' | 'played' | 'locked' | 'all'>('available');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const queued = new Set(upcomingQueue(game));
  const list = useMemo(
    () =>
      deck.cards.filter((c) => {
        if (deckF && c.deck !== deckF) return false;
        if (q && !`${c.id} ${c.title} ${c.face} ${(c.tags ?? []).join(' ')}`.toLowerCase().includes(q.toLowerCase())) return false;
        const avail = isAvailable(c, game);
        switch (status) {
          case 'available':
            return avail;
          case 'unlocked':
            return avail && Boolean(c.requires?.length);
          case 'played':
            return game.played.includes(c.id);
          case 'locked':
            return !avail && !game.played.includes(c.id);
          default:
            return true;
        }
      }),
    [deck, game, deckF, status, q],
  );
  const q0 = upcomingQueue(game);
  const add = (id: string, next: boolean) => {
    const showing = game.interlude.status === 'running' && game.sceneQueue.length === 0;
    const at = next ? (showing ? 1 : 0) : q0.length;
    const nq = [...q0];
    nq.splice(Math.min(at, nq.length), 0, id);
    dispatch((g) => setDraftQueue(g, nq));
  };
  const canEdit = game.interlude.status === 'draft' || game.interlude.status === 'running';
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Пул карт</h2>
        <span className="muted small">{list.length}</span>
      </div>
      <div className="row wrap filters">
        <select value={deckF} onChange={(e) => setDeckF(e.target.value)}>
          <option value="">Все колоды</option>
          {DECKS.map((d) => (
            <option key={d} value={d}>
              {DECK_LABELS[d]}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="available">Доступные (не сыграны)</option>
          <option value="unlocked">Разблокированы флагами</option>
          <option value="played">Сыгранные</option>
          <option value="locked">Закрытые условиями</option>
          <option value="all">Все</option>
        </select>
        <input placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="pool">
        {list.map((c) => (
          <li key={c.id}>
            <div className="row">
              <DeckTag card={c} />
              <button className="link" onClick={() => setOpen(open === c.id ? null : c.id)}>
                {c.title}
              </button>
              {c.interlude !== undefined && <span className="chip">И{c.interlude}</span>}
              {queued.has(c.id) && <span className="chip">в очереди</span>}
              {game.played.includes(c.id) && <span className="chip">сыграна{isOneShot(c) ? '' : ' (многоразовая)'}</span>}
              {game.removed.includes(c.id) && <span className="chip warn">удалена</span>}
              {c.requires?.length ? (
                <span className={`chip ${checkAll(c.requires, game) ? 'ok' : 'warn'}`}>{checkAll(c.requires, game) ? 'условия ✓' : 'условия ✗'}</span>
              ) : null}
              <span className="spacer" />
              {canEdit && (
                <>
                  <button className="icon" title="Вставить следующей" onClick={() => add(c.id, true)}>
                    ↳
                  </button>
                  <button className="icon" title="В конец очереди" onClick={() => add(c.id, false)}>
                    ＋
                  </button>
                </>
              )}
            </div>
            {open === c.id && (
              <div className="pool-detail">
                <code className="muted">{c.id}</code>
                <Md text={c.face} />
                <MasterNote text={c.gmNote} open={false} />
                <Requires card={c} />
                <div className="current-options">
                  <OptionBlock side="◀" opt={c.left} deck={deck} />
                  <OptionBlock side="▶" opt={c.right} deck={deck} />
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- итоги ----------

function SummaryGm({ game, deck }: { game: GameState; deck: DeckData }) {
  const s = interludeSummary(game, deck);
  const title = (id: string) => deck.cards.find((c) => c.id === id)?.title ?? id;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Итоги интерлюдии {s.number}</h2>
      </div>
      <SummaryTracks
        before={{ ...s.tracksBefore, population: s.populationBefore }}
        after={{ ...s.tracksAfter, population: s.populationAfter }}
      />
      <h3>Решения</h3>
      <ol>
        {s.plays.map((p, i) => (
          <li key={i}>
            <b>{p.title}</b> — {p.decision} <code className="muted small">{p.cardId}</code>
          </li>
        ))}
      </ol>
      <h3>Флаги</h3>
      <div>
        {s.flagsSet.map((f) => (
          <span key={f} className="chip ok">
            +{f}
          </span>
        ))}
        {s.flagsCleared.map((f) => (
          <span key={f} className="chip warn">
            −{f}
          </span>
        ))}
        {!s.flagsSet.length && !s.flagsCleared.length && <span className="muted">без изменений</span>}
      </div>
      <h3>Разблокированы новые карты</h3>
      <div>{s.unlocked.length ? s.unlocked.map((id) => <span key={id} className="chip">{title(id)}</span>) : <span className="muted">нет</span>}</div>
      <div className="row">
        <span className="spacer" />
        <button className="primary" onClick={() => dispatch((g, c) => nextInterlude(g, c))}>
          Собрать интерлюдию {s.number + 1} →
        </button>
      </div>
    </section>
  );
}

// ---------- боковая панель ----------

function TrackEditor({ game }: { game: GameState }) {
  const row = (t: TrackId | 'population', v: number, icon: string) => (
    <div key={t} className={`track-edit ${t !== 'capacity' && t !== 'population' && (v <= 2 || v >= 8) ? 'danger' : ''}`}>
      <span>
        {icon} {TRACK_LABELS[t]}
      </span>
      <button className="icon" onClick={() => dispatch((g, c) => setTrack(g, c, t, v - 1))}>
        −
      </button>
      <input
        type="number"
        className="num"
        value={v}
        onChange={(e) => e.target.value !== '' && dispatch((g, c) => setTrack(g, c, t, Number(e.target.value)))}
      />
      <button className="icon" onClick={() => dispatch((g, c) => setTrack(g, c, t, v + 1))}>
        +
      </button>
    </div>
  );
  return (
    <section className="panel side">
      <h3>Шкалы</h3>
      {TRACKS.map((t) => row(t, game.tracks[t], TRACK_ICONS[t]))}
      {row('population', game.population, '👥')}
      {game.population > game.tracks.capacity && <div className="alert small">Население больше Ёмкости — в конце интерлюдии Маскарад −1</div>}
    </section>
  );
}

function Flags({ game }: { game: GameState }) {
  const [f, setF] = useState('');
  return (
    <section className="panel side">
      <h3>Флаги ⚑</h3>
      <div className="flags">
        {game.flags.map((x) => (
          <span key={x} className="chip flag">
            {x}
            <button className="icon tiny" title="Снять" onClick={() => dispatch((g, c) => toggleFlag(g, c, x, false))}>
              ×
            </button>
          </span>
        ))}
        {!game.flags.length && <span className="muted small">нет</span>}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          dispatch((g, c) => toggleFlag(g, c, f, true));
          setF('');
        }}
      >
        <input value={f} onChange={(e) => setF(e.target.value)} placeholder="новый_флаг" />
        <button type="submit">＋</button>
      </form>
    </section>
  );
}

function PlotTimers({ game, deck }: { game: GameState; deck: DeckData }) {
  const defs = deck.plotTimers ?? [];
  const ids = [...new Set([...defs.map((d) => d.id), ...Object.keys(game.timers)])];
  if (!ids.length) return null;
  return (
    <section className="panel side">
      <h3>Таймеры сюжета ⏳</h3>
      {ids.map((id) => {
        const d = defs.find((x) => x.id === id);
        const v = game.timers[id] ?? 0;
        return (
          <div key={id} className="track-edit">
            <span>
              {d?.title ?? id}
              {d?.max ? <span className="muted small"> — стадия {v} из {d.max}</span> : null}
            </span>
            <button className="icon" onClick={() => dispatch((g, c) => setPlotTimer(g, c, id, v - 1))}>
              −
            </button>
            <span className="num mono">{v}</span>
            <button className="icon" onClick={() => dispatch((g, c) => setPlotTimer(g, c, id, v + 1))}>
              +
            </button>
          </div>
        );
      })}
    </section>
  );
}

function SceneQueue({ game, deck }: { game: GameState; deck: DeckData }) {
  return (
    <section className="panel side">
      <h3>Очередь сцен</h3>
      <ol className="queue small">
        {game.sceneQueue.map((r, i) => {
          const s = sceneForRequest(r, deck) ?? fallbackScene(r, deck);
          return (
            <li key={r.id} className={i === 0 ? 'current' : ''}>
              <span className="q-title">
                {r.kind === 'crisis' ? '🔥' : r.kind === 'escalation' ? '⚔' : '🎭'} {s.title}
              </span>
              <span className="spacer" />
              <button className="icon" onClick={() => dispatch((g) => moveSceneRequest(g, r.id, -1))}>
                ↑
              </button>
              <button className="icon" onClick={() => dispatch((g) => moveSceneRequest(g, r.id, 1))}>
                ↓
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Pending({ game, deck }: { game: GameState; deck: DeckData }) {
  if (!game.pending.length && !game.removed.length) return null;
  const title = (id: string) => deck.cards.find((c) => c.id === id)?.title ?? id;
  return (
    <section className="panel side">
      <h3>Отложенные карты</h3>
      <ul className="small">
        {game.pending.map((p, i) => (
          <li key={i}>
            {title(p.card)} —{' '}
            {p.dueInterlude !== undefined ? `интерлюдия ${p.dueInterlude}` : `через ${Math.max(0, (p.dueCardCount ?? 0) - game.cardCount)} карт`}
          </li>
        ))}
      </ul>
      {game.removed.length > 0 && <div className="small muted">Удалены из игры: {game.removed.map(title).join(', ')}</div>}
    </section>
  );
}

function ManualScene({ deck }: { deck: DeckData }) {
  const [id, setId] = useState('');
  return (
    <section className="panel side">
      <h3>Открыть сцену</h3>
      <div className="row">
        <select value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">—</option>
          {deck.scenes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.crisisOf ? '🔥 ' : ''}
              {s.title}
            </option>
          ))}
        </select>
        <button disabled={!id} onClick={() => dispatch((g, c) => openScene(g, c, id))}>
          Открыть
        </button>
      </div>
    </section>
  );
}
