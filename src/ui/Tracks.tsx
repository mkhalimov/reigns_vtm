import { useEffect, useState } from 'react';
import { TRACKS, type TrackId } from '../engine/types';
import { TRACK_ICONS, TRACK_LABELS } from '../engine/rules';

export type RevealDelta = number | 'up' | 'down';

interface Props {
  tracks: Record<TrackId, number>;
  population?: number;
  reveal?: { seq: number; deltas: Partial<Record<TrackId, RevealDelta>> } | null;
  compact?: boolean;
}

const danger = (t: TrackId, v: number) => t !== 'capacity' && (v <= 2 || v >= 8);

export function Tracks({ tracks, population, reveal, compact }: Props) {
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!reveal) return;
    setShown(reveal.seq);
    const id = setTimeout(() => setShown(null), 3200);
    return () => clearTimeout(id);
  }, [reveal?.seq]);

  return (
    <div className={`tracks ${compact ? 'compact' : ''}`}>
      {TRACKS.map((t) => {
        const v = tracks[t];
        const d = shown !== null && reveal?.seq === shown ? reveal.deltas[t] : undefined;
        const up = d === 'up' || (typeof d === 'number' && d > 0);
        return (
          <div key={t} className={`track ${danger(t, v) ? 'danger' : ''} ${t === 'capacity' ? 'capacity' : ''}`} title={TRACK_LABELS[t]}>
            <div className="track-head">
              <span className="track-icon">{TRACK_ICONS[t]}</span>
              <span className="track-name">{TRACK_LABELS[t]}</span>
              <span className="track-value">{v}</span>
              {d !== undefined && (
                <span key={shown} className={`track-delta ${up ? 'up' : 'down'}`}>
                  {up ? '▲' : '▼'}
                  {typeof d === 'number' ? Math.abs(d) : ''}
                </span>
              )}
            </div>
            <div className="track-bar">
              {t !== 'capacity' && <div className="zone low" />}
              {t !== 'capacity' && <div className="zone high" />}
              <div className="fill" style={{ width: `${v * 10}%` }} />
            </div>
            {t === 'capacity' && population !== undefined && (
              <div className={`population ${population > v ? 'over' : ''}`}>Население: {population}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
