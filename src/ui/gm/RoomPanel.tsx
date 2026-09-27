// Комната для игроков на своих устройствах: код, ссылка, QR, игроки, голоса.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { closeRoom, freeSeat, newCode, openRoom, setLeader, useHost } from '../../net/host';
import { joinUrl } from '../../net/protocol';
import { DECISION_MODE_LABELS, type Choice, type DecisionMode } from '../../engine/votes';
import { updateSettings } from '../../engine/game';
import { dispatch, useApp } from '../../store';

const CHOICE_LABELS: Record<Choice, string> = { left: '◀', right: '▶', escalate: '⚔ лично', ack: '✓' };

export function RoomPanel() {
  const h = useHost();
  const mode = useApp((s) => s.game.settings.decisionMode);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = h.code ? joinUrl(h.code, h.broker) : '';

  useEffect(() => {
    if (!url) return setQr(null);
    QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#000', light: '#fff' } }).then(setQr, () => setQr(null));
  }, [url]);

  if (h.status === 'off')
    return (
      <section className="panel side">
        <h3>📡 Комната для телефонов</h3>
        <p className="small muted">Игроки заходят со своих устройств по коду или QR и голосуют сами.</p>
        <button className="primary" onClick={() => void openRoom()}>
          Открыть комнату
        </button>
      </section>
    );

  const connected = h.seats.filter((p) => p.online);
  return (
    <section className="panel side">
      <h3>
        📡 Комната {h.status === 'open' ? <span className="chip ok">открыта</span> : h.status === 'opening' ? <span className="chip">открывается…</span> : <span className="chip warn">ошибка</span>}
      </h3>
      {h.error && <div className="alert small">{h.error}</div>}
      <div className="room-code">{h.code}</div>
      {qr && <img className="room-qr" src={qr} alt="QR для входа" />}
      <div className="row">
        <input className="grow small" readOnly value={url} onFocus={(e) => e.target.select()} />
        <button
          onClick={() =>
            navigator.clipboard?.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? '✓' : 'Копировать'}
        </button>
      </div>
      <label className="small">
        Кто решает:{' '}
        <select value={mode} onChange={(e) => dispatch((g) => updateSettings(g, { decisionMode: e.target.value as DecisionMode }))}>
          {(Object.keys(DECISION_MODE_LABELS) as DecisionMode[]).map((m) => (
            <option key={m} value={m}>
              {DECISION_MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <div className="small muted">
        Игроков на связи: {connected.length}
        {mode === 'vote' && connected.length > 0 && ` · голосов ${h.votes.filter((v) => connected.some((p) => p.id === v.playerId)).length} из ${connected.length}`}
      </div>
      <ul className="room-players">
        {h.seats.map((p) => {
          const v = h.votes.find((x) => x.playerId === p.id);
          return (
            <li key={p.id}>
              <span className={`dot ${p.online ? 'on' : ''}`} title={p.online ? 'на связи' : p.holder ? 'не на связи' : 'свободен'} />
              {mode === 'leader' && (
                <input type="radio" name="leader" title="Ведущий игрок" checked={h.leaderId === p.id} onChange={() => setLeader(p.id)} />
              )}
              <span className={p.holder ? '' : 'muted'}>{p.name}</span>
              {!p.holder && <span className="small muted">свободен</span>}
              {v && <span className="chip ok">{CHOICE_LABELS[v.choice]}</span>}
              <span className="spacer" />
              {p.holder && (
                <button className="icon tiny" title="Освободить персонажа (игрок сменил телефон)" onClick={() => freeSeat(p.id)}>
                  ×
                </button>
              )}
            </li>
          );
        })}

      </ul>
      {mode === 'leader' && !h.leaderId && <div className="small muted">Отметьте ведущего игрока кружком. Пока его нет — решает голосование.</div>}
      <div className="row">
        <button className="ghost" onClick={() => newCode()}>
          Новый код
        </button>
        <span className="spacer" />
        <button className="danger" onClick={() => closeRoom()}>
          Закрыть
        </button>
      </div>
    </section>
  );
}
