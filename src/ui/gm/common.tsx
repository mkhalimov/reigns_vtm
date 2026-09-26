import type { Card, DeckData, Effect, Option } from '../../engine/types';
import { describeCondition, describeEffect, DECK_ICONS, DECK_LABELS } from '../../engine/rules';

export function EffectList({ effects, deck }: { effects: Effect[]; deck: DeckData }) {
  if (!effects.length) return <div className="muted small">без эффектов</div>;
  return (
    <ul className="effects">
      {effects.map((e, i) => (
        <li key={i} className={`eff eff-${e.type} ${e.type === 'track' ? (e.delta > 0 ? 'pos' : 'neg') : ''}`}>
          {describeEffect(e, deck)}
        </li>
      ))}
    </ul>
  );
}

export function OptionBlock({ side, opt, deck, idle }: { side: string; opt?: Option; deck: DeckData; idle?: boolean }) {
  if (!opt) return <div className="opt-block empty">{side}: нет варианта</div>;
  return (
    <div className="opt-block">
      <div className="opt-label">
        {side} {opt.label} {idle && <span className="chip warn" title="Вариант по умолчанию при бездействии">по умолч.</span>}
      </div>
      <EffectList effects={opt.effects} deck={deck} />
      {opt.gmNote && <div className="gm-note">⚑ {opt.gmNote}</div>}
      {opt.opensScene && <div className="gm-note">⚡ открывает сцену: {opt.opensScene}</div>}
    </div>
  );
}

export function DeckTag({ card }: { card: Card }) {
  return (
    <span className={`deck-tag deck-${card.deck}`}>
      {DECK_ICONS[card.deck]} {DECK_LABELS[card.deck]}
    </span>
  );
}

export function Requires({ card }: { card: Card }) {
  if (!card.requires?.length) return null;
  return <div className="small muted">требует: {card.requires.map(describeCondition).join('; ')}</div>;
}

export function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      f.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}

export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
