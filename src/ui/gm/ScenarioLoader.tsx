// Загрузка сценария: файл (кнопкой или перетаскиванием), вставка JSON, ссылка, пример.
import { useState } from 'react';
import type { DeckData } from '../../engine/types';
import { parseDeckText } from '../../engine/validate';
import { hasScenario } from '../../engine/scenario';
import { replaceDeck, useApp } from '../../store';
import { download, readFile } from './common';

const loadExample = () => import('../../../scenarios/example.json').then((m) => JSON.stringify(m.default));

export function ScenarioLoader({ big }: { big?: boolean }) {
  const current = useApp((s) => s.deck);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [candidate, setCandidate] = useState<DeckData | null>(null);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const loaded = hasScenario(current);

  const check = (t: string) => {
    const r = parseDeckText(t);
    setErrors(r.errors);
    setWarnings(r.warnings);
    setCandidate(r.deck);
  };
  const reset = () => {
    setCandidate(null);
    setText('');
    setErrors([]);
    setWarnings([]);
  };
  const fromUrl = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(url.trim());
      if (!res.ok) throw new Error(`сервер ответил ${res.status}`);
      check(await res.text());
    } catch (e) {
      setCandidate(null);
      setWarnings([]);
      setErrors([`Не удалось загрузить по ссылке: ${e instanceof Error ? e.message : String(e)}. Нужна прямая ссылка на JSON (например, «Raw» на GitHub или gist).`]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`scenario-loader ${big ? 'big' : ''} ${drag ? 'drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) void f.text().then(check);
      }}
    >
      <div className="row wrap">
        <button
          className="primary"
          onClick={async () => {
            const t = await readFile('.json,application/json');
            if (t !== null) check(t);
          }}
        >
          ⬆ Загрузить сценарий (JSON)
        </button>
        <button onClick={() => void loadExample().then(check)}>Открыть пример</button>
        <button className="ghost" onClick={() => void loadExample().then((t) => download('scenario-example.json', JSON.stringify(JSON.parse(t), null, 2)))}>
          ⬇ Скачать пример как шаблон
        </button>
      </div>
      {big && <div className="muted small">…или перетащите файл сценария в это окно.</div>}
      <div className="row wrap">
        <input className="grow" placeholder="Ссылка на JSON сценария (raw.githubusercontent.com, gist…)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button disabled={!url.trim() || busy} onClick={() => void fromUrl()}>
          {busy ? 'Загрузка…' : 'Загрузить по ссылке'}
        </button>
      </div>
      <details>
        <summary>Вставить JSON вручную</summary>
        <textarea className="json" value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder='{"title": "…", "tracks": [...], "cards": [...], "scenes": [...]}' />
        <button onClick={() => check(text)}>Проверить</button>
      </details>

      {errors.length > 0 && (
        <div className="alert">
          <b>Сценарий не загружен — ошибок: {errors.length}</b>
          <ul className="mono small">
            {errors.slice(0, 50).map((e, i) => (
              <li key={i} style={{ whiteSpace: 'pre-wrap' }}>
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}
      {candidate && (
        <div className="ok-box">
          <b>
            «{candidate.title || 'Без названия'}»: {candidate.cards.length} карт, {candidate.scenes.length} сцен, шкал: {candidate.tracks.length}.
          </b>
          {warnings.length > 0 && (
            <details>
              <summary className="small">Предупреждения: {warnings.length}</summary>
              <ul className="small muted">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="row wrap">
            <button
              className="primary"
              onClick={() => {
                if (loaded && !confirm('Начать новую партию с этим сценарием? Текущая партия будет заменена (её можно сначала выгрузить: Настройки → Экспорт сохранения).')) return;
                replaceDeck(candidate, 'new');
                reset();
              }}
            >
              ▶ Новая партия с этим сценарием
            </button>
            {loaded && (
              <button
                onClick={() => {
                  replaceDeck(candidate, 'keep');
                  reset();
                }}
                title="Например, исправленная версия того же сценария"
              >
                Заменить сценарий, сохранить партию
              </button>
            )}
            <button className="ghost" onClick={reset}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
