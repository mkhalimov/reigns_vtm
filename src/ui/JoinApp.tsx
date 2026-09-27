// Экран игрока на своём устройстве: вход по коду, выбор персонажа, голосование.
import { useEffect, useState } from 'react';
import { join, leave, mySeat, pickSeat, useGuest, vote } from '../net/guest';
import { normalizeCode, roomViewFor } from '../net/protocol';
import { PlayerScreen } from './PlayerScreen';

function parseHash(): { code: string; broker: number } {
  const [code = '', broker = '0'] = location.hash.replace(/^#\/join\/?/, '').split('/');
  return { code: normalizeCode(code), broker: Number(broker) || 0 };
}

export function JoinApp() {
  const g = useGuest();
  const fromHash = parseHash();
  const [code, setCode] = useState(fromHash.code || g.code);
  const [changing, setChanging] = useState(false);

  // по ссылке/QR входим сразу
  useEffect(() => {
    if (fromHash.code) void join(fromHash.code, fromHash.broker);
  }, []);

  if (g.status === 'idle')
    return (
      <div className="player-screen splash">
        <form
          className="join-form"
          onSubmit={(e) => {
            e.preventDefault();
            const c = normalizeCode(code);
            if (c) void join(c);
          }}
        >
          <h1>⚜ Руан</h1>
          <label>
            Код комнаты
            <input className="code" value={code} onChange={(e) => setCode(normalizeCode(e.target.value))} maxLength={8} autoCapitalize="characters" required />
          </label>
          {g.error && <div className="alert small">{g.error}</div>}
          <button className="primary" type="submit">
            Войти
          </button>
        </form>
      </div>
    );

  if (g.status !== 'connected' || g.closed)
    return (
      <div className="player-screen splash">
        <div className="join-form">
          <h1>⚜ Руан</h1>
          <div className="waiting center">{g.closed ? 'Рассказчик закрыл комнату.' : g.stage || 'Подключаемся…'}</div>
          {g.error && !g.closed && <div className="alert small">{g.error}</div>}
          <div className="muted small center">Комната {g.code}</div>
          <button onClick={() => leave()}>Ввести другой код</button>
        </div>
      </div>
    );

  const seat = mySeat();
  const seats = g.room?.seats ?? [];

  if (!seat || changing)
    return (
      <div className="player-screen splash">
        <div className="join-form">
          <h1>Кто вы?</h1>
          {!seats.length && <div className="waiting center">Рассказчик ещё не открыл партию…</div>}
          {seats.map((s) => {
            const mine = s.holder === g.clientId;
            const taken = !!s.holder && !mine && s.online;
            return (
              <button
                key={s.id}
                className={`seat ${mine ? 'primary' : ''}`}
                disabled={taken}
                onClick={() => {
                  pickSeat(s.id);
                  setChanging(false);
                }}
              >
                {s.name}
                {taken && <span className="small muted"> — занят</span>}
              </button>
            );
          })}
          <button className="ghost" onClick={() => (changing ? setChanging(false) : leave())}>
            {changing ? 'Отмена' : 'Выйти'}
          </button>
        </div>
      </div>
    );

  const me = seats.find((s) => s.id === seat)!;
  const bar = (
    <>
      {(g.hostSilent || g.stage) && <div className="net-banner">{g.stage || 'Рассказчик не отвечает… ждём.'}</div>}
      <div className="guest-bar">
        <span>
          {me.name} · комната {g.code}
        </span>
        <button className="link" onClick={() => setChanging(true)}>
          Сменить персонажа
        </button>
      </div>
    </>
  );

  if (!g.pub)
    return (
      <div className="player-screen">
        {bar}
        <div className="player-stage">
          <div className="waiting">Ждём Рассказчика…</div>
        </div>
      </div>
    );

  // секретная карта: адресат видит её целиком из личного канала
  const sc = g.secretCard;
  const pub = g.pub.card?.secret && sc && sc.cardKey === g.pub.cardKey ? { ...g.pub, card: sc.card } : g.pub;
  return (
    <PlayerScreen
      pub={pub}
      timer={g.timer}
      journal={g.journal}
      room={g.room ? roomViewFor(g.room, g.clientId, pub.card) : null}
      banner={bar}
      onChoose={(side) => vote(side)}
      onEscalate={() => vote('escalate')}
      onAck={() => vote('ack')}
    />
  );
}
