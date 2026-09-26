import { useEffect, useMemo, useRef, useState } from 'react';
import { acknowledge, choose, escalate, handleTimeout, patchState } from './engine/game';
import { publicView, type PublicState } from './engine/public';
import { publicJournal, type PublicJournalEntry } from './engine/journal';
import { gameTimeLabel } from './engine/rules';
import type { Side } from './engine/types';
import { dispatch, getState, init, setView, undo, useApp } from './store';
import { getTimer, syncTimer, tick, useTimer } from './timer';
import { CHANNEL, openChannel, type FromPlayers, type TimerView, type ToPlayers } from './channel';
import { PlayerScreen } from './ui/PlayerScreen';
import { TablePanel } from './ui/gm/TablePanel';
import { DeckPanel, JournalPanel, SettingsPanel } from './ui/gm/OtherPanels';

export default function App() {
  if (location.hash.startsWith('#/players')) return <RemotePlayers />;
  return <Main />;
}

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

/** Действия игроков приходят с ключом карты — чтобы двойной клик или устаревшее окно не выбрали за следующую карту. */
function playerAction(msg: FromPlayers) {
  const { game, deck } = getState();
  const pub = publicView(game, deck);
  if (msg.type === 'hello') return;
  if (pub.mode !== 'card' || pub.cardKey !== msg.cardKey || game.awaitingGm) return;
  if (msg.type === 'choose') dispatch((g, c) => choose(g, c, msg.side, 'players'));
  else if (msg.type === 'escalate') dispatch(escalate);
  else if (msg.type === 'ack') dispatch(acknowledge);
}

function Main() {
  const loaded = useApp((s) => s.loaded);
  const game = useApp((s) => s.game);
  const deck = useApp((s) => s.deck);
  const view = useApp((s) => s.view);
  const historyLen = useApp((s) => s.history.length);
  const timer = useTimer();
  const [tab, setTab] = useState<'table' | 'journal' | 'deck' | 'settings'>('table');

  useEffect(() => {
    void init();
  }, []);

  const pub = useMemo(() => publicView(game, deck), [game, deck]);
  const journal = useMemo(() => publicJournal(game), [game]);

  // таймер карты
  useEffect(() => {
    syncTimer(pub.cardKey ?? null, pub.card?.timer ?? null);
  }, [pub.cardKey, pub.card?.timer]);

  useEffect(() => {
    if (!loaded) return;
    const id = setInterval(() => {
      const { game: g, deck: d } = getState();
      const p = publicView(g, d);
      if (p.mode !== 'card' || p.hidden || g.awaitingGm || p.cardKey !== getTimer().key) return;
      if (tick()) dispatch(handleTimeout);
    }, 1000);
    return () => clearInterval(id);
  }, [loaded]);

  // второе окно игроков
  const chan = useRef<BroadcastChannel | null>(null);
  const timerView: TimerView = { remaining: timer.disabled ? null : timer.remaining, total: timer.disabled ? null : timer.total, paused: timer.paused };
  const latest = useRef<ToPlayers | null>(null);
  latest.current = { type: 'state', pub, timer: timerView, journal };
  useEffect(() => {
    const ch = openChannel();
    chan.current = ch;
    if (!ch) return;
    ch.onmessage = (e: MessageEvent<FromPlayers>) => {
      if (e.data.type === 'hello' && latest.current) ch.postMessage(latest.current);
      else playerAction(e.data);
    };
    return () => ch.close();
  }, []);
  useEffect(() => {
    if (latest.current) chan.current?.postMessage(latest.current);
  }, [pub, journal, timer.remaining, timer.total, timer.paused, timer.disabled]);

  // горячие клавиши
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.code === 'Backquote') {
        e.preventDefault();
        setView(getState().view === 'gm' ? 'players' : 'gm');
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        undo();
      } else if (e.code === 'KeyH' && !e.ctrlKey && !e.metaKey) {
        dispatch((g) => patchState(g, { playerScreenHidden: !g.playerScreenHidden }));
      } else if (getState().view === 'players' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        const p = publicView(getState().game, getState().deck);
        if (p.cardKey) playerAction({ type: 'choose', side: e.code === 'ArrowLeft' ? 'left' : 'right', cardKey: p.cardKey });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!loaded) return <div className="loading">Загрузка…</div>;

  const act = (msg: FromPlayers) => playerAction(msg);
  const key = pub.cardKey ?? '';

  if (view === 'players')
    return (
      <PlayerScreen
        pub={pub}
        timer={timerView}
        journal={journal}
        onChoose={(side: Side) => act({ type: 'choose', side, cardKey: key })}
        onEscalate={() => act({ type: 'escalate', cardKey: key })}
        onAck={() => act({ type: 'ack', cardKey: key })}
        corner={
          <button className="corner-btn" onClick={() => setView('gm')} title="Пульт GM (`)">
            ⚜
          </button>
        }
      />
    );

  return (
    <div className="gm">
      <header className="gm-bar">
        <div className="brand">⚜ Руан</div>
        <div className="gm-status">
          Интерлюдия {game.interlude.number} · {gameTimeLabel(game.week, game.settings.startSeason)}
        </div>
        <nav className="tabs">
          {(
            [
              ['table', 'Стол'],
              ['journal', 'Хроника'],
              ['deck', 'Колода'],
              ['settings', 'Настройки'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <button disabled={!historyLen} onClick={undo} title="Ctrl+Z">
          ↶ Отмена{historyLen ? ` (${historyLen})` : ''}
        </button>
        <button
          className={game.playerScreenHidden ? 'warn-btn' : ''}
          onClick={() => dispatch((g) => patchState(g, { playerScreenHidden: !g.playerScreenHidden }))}
          title="H"
        >
          {game.playerScreenHidden ? '🙈 Экран скрыт' : '👁 Скрыть экран игроков'}
        </button>
        <button onClick={() => window.open(`${location.pathname}#/players`, 'rouen-players', 'popup')} title="Открыть окно для ТВ/проектора">
          ⧉ Окно игроков
        </button>
        <button className="primary" onClick={() => setView('players')} title="`">
          Вид игроков
        </button>
      </header>
      <div className="gm-body">
        {tab === 'table' && <TablePanel />}
        {tab === 'journal' && <JournalPanel />}
        {tab === 'deck' && <DeckPanel />}
        {tab === 'settings' && <SettingsPanel />}
      </div>
    </div>
  );
}

/** Отдельное окно игроков: знает только то, что пришло по каналу. */
function RemotePlayers() {
  const [msg, setMsg] = useState<{ pub: PublicState; timer: TimerView; journal: PublicJournalEntry[] } | null>(null);
  const chan = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    const ch = openChannel();
    chan.current = ch;
    if (!ch) return;
    ch.onmessage = (e: MessageEvent<ToPlayers>) => {
      if (e.data.type === 'state') setMsg(e.data);
    };
    ch.postMessage({ type: 'hello' } satisfies FromPlayers);
    return () => ch.close();
  }, []);
  const send = (m: FromPlayers) => chan.current?.postMessage(m);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = msg?.pub.cardKey;
      if (!key) return;
      if (e.code === 'ArrowLeft') send({ type: 'choose', side: 'left', cardKey: key });
      if (e.code === 'ArrowRight') send({ type: 'choose', side: 'right', cardKey: key });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [msg?.pub.cardKey]);

  if (!chan.current && !msg)
    return <div className="loading">Браузер не поддерживает BroadcastChannel — используйте вид игроков в основном окне ({CHANNEL}).</div>;
  if (!msg) return <div className="loading">Ждём пульт Рассказчика… Откройте основное окно в этом же браузере.</div>;
  const key = msg.pub.cardKey ?? '';
  return (
    <PlayerScreen
      pub={msg.pub}
      timer={msg.timer}
      journal={msg.journal}
      onChoose={(side) => send({ type: 'choose', side, cardKey: key })}
      onEscalate={() => send({ type: 'escalate', cardKey: key })}
      onAck={() => send({ type: 'ack', cardKey: key })}
    />
  );
}
