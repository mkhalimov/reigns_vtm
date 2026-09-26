// Экспорт хроники в Markdown (ТЗ 3.6, 9.7).
import type { GameState, JournalEntry } from './types';
import { gameTimeLabel } from './rules';

export interface PublicJournalEntry {
  id: number;
  interlude: number;
  time: string;
  realTime: string;
  text: string;
}

/** «Чистый» журнал для игроков: только публичные записи. */
export function publicJournal(s: GameState): PublicJournalEntry[] {
  return s.journal
    .filter((e) => e.public !== null)
    .map((e) => ({
      id: e.id,
      interlude: e.interlude,
      time: gameTimeLabel(e.week, s.settings.startSeason),
      realTime: e.realTime,
      text: e.public!,
    }));
}

const fmtReal = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function groupByInterlude(entries: JournalEntry[]): Map<number, JournalEntry[]> {
  const m = new Map<number, JournalEntry[]>();
  for (const e of entries) {
    if (!m.has(e.interlude)) m.set(e.interlude, []);
    m.get(e.interlude)!.push(e);
  }
  return m;
}

/**
 * gm=false — только «что решили»;
 * gm=true — в каждой интерлюдии два раздела: «Что решили» и «Детали для GM».
 */
export function journalToMarkdown(s: GameState, opts: { gm: boolean; title?: string }): string {
  const out: string[] = [`# ${opts.title ?? 'Руан — хроника домена'}`, ''];
  const groups = groupByInterlude(s.journal);
  for (const [n, entries] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const pub = entries.filter((e) => e.public !== null);
    if (!opts.gm && !pub.length) continue;
    out.push(`## Интерлюдия ${n}`, '');
    out.push('### Что решили', '');
    if (!pub.length) out.push('_Нет записей._');
    for (const e of pub) out.push(`- *${gameTimeLabel(e.week, s.settings.startSeason)}* — ${e.public}`);
    out.push('');
    if (opts.gm) {
      out.push('### Детали для GM', '');
      for (const e of entries) {
        const head = e.public ?? '_(служебная запись)_';
        out.push(`- \`${fmtReal(e.realTime)}\` · ${gameTimeLabel(e.week, s.settings.startSeason)} · **${e.kind}** — ${head}`);
        for (const g of e.gm) out.push(`  - ${g}`);
      }
      out.push('');
    }
  }
  if (opts.gm) {
    out.push('## Состояние на момент экспорта', '');
    out.push(`- Шкалы: ${Object.entries(s.tracks).map(([k, v]) => `${k} ${v}`).join(', ')}; население ${s.population}`);
    out.push(`- Флаги: ${s.flags.length ? s.flags.join(', ') : '—'}`);
    const timers = Object.entries(s.timers);
    if (timers.length) out.push(`- Таймеры сюжета: ${timers.map(([k, v]) => `${k} ${v}`).join(', ')}`);
    out.push('');
  }
  return out.join('\n');
}
