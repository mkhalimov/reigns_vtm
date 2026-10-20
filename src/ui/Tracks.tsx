import { useEffect, useState } from 'react';
import type { TrackId } from '../engine/types';
import { Md } from './Md';

export type RevealDelta = number | 'up' | 'down';

export interface TrackView {
  id: TrackId;
  name: string;
  icon?: string;
  crisis: boolean;
}

interface Props {
  defs: TrackView[];
  tracks: Record<TrackId, number>;
  population?: number;
  /** Механика населения: подпись и шкала ёмкости. */
  populationInfo?: { label: string; capacityTrack: TrackId };
  reveal?: { seq: number; deltas: Partial<Record<TrackId, RevealDelta>> } | null;
  compact?: boolean;
  /** Описания шкал: если заданы, по нажатию на шкалу открывается пояснение. */
  info?: Record<TrackId, string>;
}

const danger = (d: TrackView, v: number) => d.crisis && (v <= 2 || v >= 8);

export function Tracks({ defs, tracks, population, populationInfo, reveal, compact, info }: Props) {
  const [shown, setShown] = useState<number | null>(null);
  const [open, setOpen] = useState<TrackView | null>(null);
  useEffect(() => {
    if (!reveal) return;
    setShown(reveal.seq);
    const id = setTimeout(() => setShown(null), 3200);
    return () => clearTimeout(id);
  }, [reveal?.seq]);

  return (
    <div className={`tracks ${compact ? 'compact' : ''}`} style={{ ['--tracks' as string]: Math.max(1, defs.length) }}>
      {defs.map((t) => {
        const v = tracks[t.id] ?? 0;
        const d = shown !== null && reveal?.seq === shown ? reveal.deltas[t.id] : undefined;
        const up = d === 'up' || (typeof d === 'number' && d > 0);
        const isCap = populationInfo?.capacityTrack === t.id;
        return (
          <div
            key={t.id}
            className={`track ${danger(t, v) ? 'danger' : ''} ${t.crisis ? '' : 'calm'}`}
            title={info ? `${t.name} — нажмите, чтобы узнать, что это` : t.name}
            role={info ? 'button' : undefined}
            tabIndex={info ? 0 : undefined}
            onClick={info ? () => setOpen(t) : undefined}
            onKeyDown={info ? (e) => (e.key === 'Enter' || e.key === ' ') && setOpen(t) : undefined}
          >
            <div className="track-head">
              {t.icon && <span className="track-icon">{t.icon}</span>}
              <span className="track-name">{t.name}</span>
              <span className="track-value">{v}</span>
              {d !== undefined && (
                <span key={shown} className={`track-delta ${up ? 'up' : 'down'}`}>
                  {up ? '▲' : '▼'}
                  {typeof d === 'number' ? Math.abs(d) : ''}
                </span>
              )}
            </div>
            <div className="track-bar">
              {t.crisis && <div className="zone low" />}
              {t.crisis && <div className="zone high" />}
              <div className="fill" style={{ width: `${v * 10}%` }} />
            </div>
            {isCap && population !== undefined && (
              <div className={`population ${population > v ? 'over' : ''}`}>
                {populationInfo!.label}: {population}
              </div>
            )}
          </div>
        );
      })}
      {open && info && (
        <div className="overlay" onClick={() => setOpen(null)}>
          <div className="overlay-panel track-info" onClick={(e) => e.stopPropagation()}>
            <h2>
              {open.icon && <span>{open.icon}</span>} {open.name}
              <span className="track-info-value">{tracks[open.id] ?? 0} / 10</span>
            </h2>
            <Md text={info[open.id] ?? ''} />
            {populationInfo?.capacityTrack === open.id && population !== undefined && (
              <p>
                Сейчас: {open.name.toLowerCase()} <b>{tracks[open.id]}</b>, {populationInfo.label.toLowerCase()} <b>{population}</b>
                {population > (tracks[open.id] ?? 0) ? ' — перебор.' : '.'}
              </p>
            )}
            <button onClick={() => setOpen(null)}>Понятно</button>
          </div>
        </div>
      )}
    </div>
  );
}
