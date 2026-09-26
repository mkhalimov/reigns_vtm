// Экран игрока на своём устройстве: вход в комнату по коду и голосование.
import { useEffect, useState } from 'react';
import { join, leave, useGuest, vote } from '../net/guest';
import { normalizeCode } from '../net/protocol';
import { PlayerScreen } from './PlayerScreen';

export function JoinApp() {
  const g = useGuest();
  const fromHash = normalizeCode(location.hash.replace(/^#\/join\/?/, ''));
  const [code, setCode] = useState(fromHash || g.code);
  const [name, setName] = useState(g.name);

  // по ссылке/QR с тем же кодом и уже известным именем — входим сразу
  useEffect(() => {
    if (g.status === 'idle' && g.name && fromHash && fromHash === g.code) join(g.code, g.name);
  }, []);

  if (g.status === 'idle' || (!g.pub && g.status !== 'connected' && !g.error))
    return (
      <div className="player-screen splash">
        <form
          className="join-form"
          onSubmit={(e) => {
            e.preventDefault();
            const c = normalizeCode(code);
            if (c && name.trim()) join(c, name.trim());
          }}
        >
          <h1>⚜ Руан</h1>
          <label>
            Код комнаты
            <input className="code" value={code} onChange={(e) => setCode(normalizeCode(e.target.value))} maxLength={8} autoCapitalize="characters" required />
          </label>
          <label>
            Ваше имя (или имя персонажа)
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoFocus={!!code} />
          </label>
          <button className="primary" type="submit" disabled={g.status === 'connecting'}>
            {g.status === 'connecting' ? 'Подключаемся…' : 'Войти'}
          </button>
        </form>
      </div>
    );

  const bar = (
    <>
      {g.status !== 'connected' && <div className="net-banner">{g.error ?? 'Подключаемся…'}</div>}
      <div className="guest-bar">
        <span>
          {g.name} · комната {g.code}
        </span>
        <button className="link" onClick={() => leave()}>
          Выйти
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

  return (
    <PlayerScreen
      pub={g.pub}
      timer={g.timer}
      journal={g.journal}
      room={g.room}
      banner={bar}
      onChoose={(side) => vote(side)}
      onEscalate={() => vote('escalate')}
      onAck={() => vote('ack')}
    />
  );
}
