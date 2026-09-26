// Журнал, колода, настройки и сохранения (ТЗ 3.3 частично, 3.6, 7).
import { useState } from 'react';
import type { GameState, TimeoutPolicy } from '../../engine/types';
import { addJournalNote, updateSettings } from '../../engine/game';
import { journalToMarkdown } from '../../engine/journal';
import { gameTimeLabel, TRACK_LABELS } from '../../engine/rules';
import { parseDeckText } from '../../engine/validate';
import { parseSave } from '../../engine/save';
import { publicView } from '../../engine/public';
import { builtInDeck, currentSave, dispatch, loadSave, newGameSameDeck, replaceDeck, useApp } from '../../store';
import { Md } from '../Md';
import { PlayerScreen } from '../PlayerScreen';
import { DeckTag, download, OptionBlock, readFile, Requires, stamp } from './common';
import type { DeckData } from '../../engine/types';
import { newGame, setDraftQueue, startInterlude } from '../../engine/game';

// ---------- журнал ----------

export function JournalPanel() {
  const game = useApp((s) => s.game);
  const [gmMode, setGmMode] = useState(true);
  const [note, setNote] = useState('');
  const [pub, setPub] = useState(false);
  const entries = [...game.journal].reverse().filter((e) => gmMode || e.public !== null);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Хроника</h2>
        <label className="small">
          <input type="checkbox" checked={gmMode} onChange={(e) => setGmMode(e.target.checked)} /> GM-детали
        </label>
        <span className="spacer" />
        <button onClick={() => download(`rouen-chronicle-players-${stamp()}.md`, journalToMarkdown(game, { gm: false }), 'text/markdown')}>
          ⬇ Markdown для игроков
        </button>
        <button onClick={() => download(`rouen-chronicle-gm-${stamp()}.md`, journalToMarkdown(game, { gm: true }), 'text/markdown')}>
          ⬇ Markdown полный (GM)
        </button>
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          dispatch((g, c) => addJournalNote(g, c, note, pub));
          setNote('');
        }}
      >
        <input className="grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Запись в хронику…" />
        <label className="small">
          <input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} /> видна игрокам
        </label>
        <button type="submit">Добавить</button>
      </form>
      <ul className="journal-list">
        {entries.map((e) => (
          <li key={e.id} className={`j-${e.kind} ${e.public === null ? 'gm-only' : ''}`}>
            <span className="j-time">
              И{e.interlude} · {gameTimeLabel(e.week, game.settings.startSeason)} · {new Date(e.realTime).toLocaleString('ru-RU')}
            </span>
            {e.public !== null ? <Md text={e.public} /> : <span className="muted">служебная запись</span>}
            {gmMode && e.gm.length > 0 && (
              <ul className="j-gm">
                {e.gm.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {!entries.length && <li className="muted">Журнал пуст.</li>}
      </ul>
    </section>
  );
}

// ---------- колода ----------

export function DeckPanel() {
  const deck = useApp((s) => s.deck);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [candidate, setCandidate] = useState<DeckData | null>(null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const check = (t: string) => {
    const r = parseDeckText(t);
    setErrors(r.errors);
    setWarnings(r.warnings);
    setCandidate(r.deck);
  };
  const previewCard = deck.cards.find((c) => c.id === preview);

  return (
    <div className="deck-layout">
      <section className="panel">
        <div className="panel-head">
          <h2>Колода: {deck.title ?? 'без названия'}</h2>
          <span className="muted small">
            {deck.cards.length} карт, {deck.scenes.length} сцен
          </span>
          <span className="spacer" />
          <button onClick={() => download(`rouen-deck-${stamp()}.json`, JSON.stringify(deck, null, 2))}>⬇ Экспорт JSON</button>
          <button
            onClick={async () => {
              const t = await readFile('.json,application/json');
              if (t !== null) {
                setText(t);
                check(t);
              }
            }}
          >
            ⬆ Импорт из файла
          </button>
          <button
            title="Колода «Руан — колода на игру», встроенная в приложение"
            onClick={() => {
              setErrors([]);
              setWarnings([]);
              setCandidate(builtInDeck);
            }}
          >
            ⚜ Встроенная колода «Руан»
          </button>
        </div>
        <details>
          <summary>Вставить JSON колоды вручную</summary>
          <textarea className="json" value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder='{"cards": [...], "scenes": [...]}' />
          <button onClick={() => check(text)}>Проверить</button>
        </details>
        {errors.length > 0 && (
          <div className="alert">
            <b>Колода не импортирована — ошибок: {errors.length}</b>
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
              Колода корректна: {candidate.cards.length} карт, {candidate.scenes.length} сцен.
            </b>
            {warnings.length > 0 && (
              <ul className="small muted">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <div className="row">
              <button
                onClick={() => {
                  replaceDeck(candidate, 'keep');
                  setCandidate(null);
                  setText('');
                }}
              >
                Заменить колоду, сохранить партию
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (!confirm('Начать новую партию с этой колодой? Текущая партия будет заменена (сделайте экспорт сохранения).')) return;
                  replaceDeck(candidate, 'new');
                  setCandidate(null);
                  setText('');
                }}
              >
                Новая партия с этой колодой
              </button>
            </div>
          </div>
        )}
        <input placeholder="Поиск по картам…" value={q} onChange={(e) => setQ(e.target.value)} />
        <table className="cards-table">
          <thead>
            <tr>
              <th>Колода</th>
              <th>Карта</th>
              <th>И</th>
              <th>Условия / ⚡</th>
            </tr>
          </thead>
          <tbody>
            {deck.cards
              .filter((c) => !q || `${c.id} ${c.title} ${c.face}`.toLowerCase().includes(q.toLowerCase()))
              .map((c) => (
                <tr key={c.id} className={preview === c.id ? 'sel' : ''} onClick={() => setPreview(c.id)}>
                  <td>
                    <DeckTag card={c} />
                  </td>
                  <td>
                    {c.title} <code className="muted small">{c.id}</code>
                  </td>
                  <td>{c.interlude ?? ''}</td>
                  <td className="small">
                    {c.requires?.length ? '⚑ ' : ''}
                    {c.escalation ? `⚡ ${c.escalation === true ? 'импровизация' : c.escalation}` : ''}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <h3>Сцены</h3>
        <ul className="small">
          {deck.scenes.map((s) => (
            <li key={s.id}>
              {s.crisisOf ? `🔥 [${TRACK_LABELS[s.crisisOf.track]} ${s.crisisOf.edge === 'low' ? '0' : '10'}] ` : ''}
              <b>{s.title}</b> <code className="muted">{s.id}</code>
            </li>
          ))}
        </ul>
      </section>
      {previewCard && (
        <section className="panel preview-panel">
          <div className="panel-head">
            <h2>Предпросмотр</h2>
            <button onClick={() => setPreview(null)}>×</button>
          </div>
          <div className="preview-frame">
            <PreviewAsPlayers deck={deck} cardId={previewCard.id} />
          </div>
          {previewCard.gmNote && <div className="gm-note">⚑ {previewCard.gmNote}</div>}
          <Requires card={previewCard} />
          <div className="current-options">
            <OptionBlock side="◀" opt={previewCard.left} deck={deck} />
            <OptionBlock side="▶" opt={previewCard.right} deck={deck} />
          </div>
          <details>
            <summary>JSON</summary>
            <pre className="json">{JSON.stringify(previewCard, null, 2)}</pre>
          </details>
        </section>
      )}
    </div>
  );
}

function PreviewAsPlayers({ deck, cardId }: { deck: DeckData; cardId: string }) {
  const ctx = { deck, rng: () => 0 };
  const g = startInterlude(setDraftQueue(newGame(deck), [cardId]), ctx);
  const pub = publicView(g, deck);
  const noop = () => {};
  return (
    <PlayerScreen
      pub={pub}
      timer={{ remaining: pub.card?.timer ?? null, total: pub.card?.timer ?? null, paused: true }}
      journal={[]}
      onChoose={noop}
      onEscalate={noop}
      onAck={noop}
    />
  );
}

// ---------- настройки и сохранения ----------

export function SettingsPanel() {
  const game = useApp((s) => s.game);
  const lastSavedAt = useApp((s) => s.lastSavedAt);
  const [err, setErr] = useState<string | null>(null);
  const st = game.settings;
  const upd = (patch: Partial<GameState['settings']>) => dispatch((g) => updateSettings(g, patch));
  const num = (v: string) => Math.max(0, Number(v) || 0);
  return (
    <div className="settings-layout">
      <section className="panel">
        <h2>Сохранение</h2>
        <p className="small muted">
          Автосохранение в браузере после каждого действия
          {lastSavedAt ? ` (последнее: ${new Date(lastSavedAt).toLocaleString('ru-RU')})` : ''}. Для бэкапа между сессиями используйте экспорт.
        </p>
        <div className="row wrap">
          <button onClick={() => download(`rouen-save-${stamp()}.json`, JSON.stringify(currentSave()))}>⬇ Экспорт сохранения</button>
          <button
            onClick={async () => {
              const t = await readFile('.json,application/json');
              if (t === null) return;
              const r = parseSave(t);
              if (!r.save) return setErr(r.error ?? 'Ошибка');
              if (!confirm('Загрузить сохранение? Текущая партия будет заменена.')) return;
              setErr(null);
              loadSave(r.save);
            }}
          >
            ⬆ Импорт сохранения
          </button>
          <button
            className="danger"
            onClick={() => confirm('Начать новую партию с текущей колодой? (Отменить можно кнопкой «Отмена»)') && newGameSameDeck()}
          >
            Новая партия
          </button>
        </div>
        {err && <div className="alert mono small">{err}</div>}
      </section>
      <section className="panel">
        <h2>Таймер и подсказки</h2>
        <label>
          Таймер по умолчанию, с
          <input type="number" className="num" value={st.timerDefault} onChange={(e) => upd({ timerDefault: num(e.target.value) || 60 })} />
        </label>
        <label>
          По истечении таймера
          <select value={st.onTimeout} onChange={(e) => upd({ onTimeout: e.target.value as TimeoutPolicy })}>
            <option value="pause">пауза и ожидание решения GM</option>
            <option value="random">случайный вариант</option>
            <option value="worst">«худший» вариант (idleDefault карты)</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={st.showDeltaNumbers} onChange={(e) => upd({ showDeltaNumbers: e.target.checked })} /> Показывать
          игрокам числа сдвига шкал (иначе только ▲/▼)
        </label>
      </section>
      <section className="panel">
        <h2>Время и кризисы</h2>
        <label>
          Одна карта = недель от
          <input type="number" className="num" value={st.weeksPerCardMin} onChange={(e) => upd({ weeksPerCardMin: num(e.target.value) })} />
          до
          <input type="number" className="num" value={st.weeksPerCardMax} onChange={(e) => upd({ weeksPerCardMax: num(e.target.value) })} />
        </label>
        <label>
          Начальный сезон
          <select value={st.startSeason} onChange={(e) => upd({ startSeason: Number(e.target.value) })}>
            <option value={0}>Зима</option>
            <option value={1}>Весна</option>
            <option value={2}>Лето</option>
            <option value={3}>Осень</option>
          </select>
        </label>
        <label>
          Откат после кризиса: нижний край →
          <input type="number" className="num" value={st.crisisRollbackLow} onChange={(e) => upd({ crisisRollbackLow: num(e.target.value) })} />
          верхний край →
          <input type="number" className="num" value={st.crisisRollbackHigh} onChange={(e) => upd({ crisisRollbackHigh: num(e.target.value) })} />
        </label>
      </section>
      <section className="panel">
        <h2>Автосборка интерлюдии</h2>
        {(
          [
            ['routine', 'Рутина'],
            ['lines', 'Карты линий (Де Руан, Ночь, Ворота, Двор)'],
            ['mirror', 'Зеркало'],
            ['omen', 'Знамения'],
          ] as const
        ).map(([k, label]) => (
          <label key={k}>
            {label}
            <input
              type="number"
              className="num"
              value={st.autobuild[k]}
              onChange={(e) => upd({ autobuild: { ...st.autobuild, [k]: num(e.target.value) } })}
            />
          </label>
        ))}
      </section>
      <section className="panel">
        <h2>Горячие клавиши</h2>
        <ul className="small">
          <li>
            <kbd>`</kbd> / <kbd>Ё</kbd> — переключить «пульт / вид игроков»
          </li>
          <li>
            <kbd>Ctrl</kbd>+<kbd>Z</kbd> — отменить последнее действие
          </li>
          <li>
            <kbd>H</kbd> — скрыть/показать экран игроков (заставка)
          </li>
          <li>В виде игроков: <kbd>←</kbd> / <kbd>→</kbd> — выбрать вариант</li>
        </ul>
      </section>
    </div>
  );
}
