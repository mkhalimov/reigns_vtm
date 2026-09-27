// Небольшой Markdown для текстов карт и мастерских заметок: **жирный**, *курсив*/_курсив_, `код`,
// списки «- …» и «1. …», абзацы и переносы строк.
// Без innerHTML — текст колоды не может внедрить разметку.
import { Fragment, type ReactNode } from 'react';

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*(.+?)\*\*|\*(.+?)\*|(?<![\p{L}\d])_(.+?)_(?![\p{L}\d])/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${k++}`;
    if (m[1] !== undefined) out.push(<code key={key}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={key}>{inline(m[2], `${key}b`)}</strong>);
    else out.push(<em key={key}>{inline(m[3] ?? m[4], `${key}i`)}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const last = out[out.length - 1];
    const ul = /^\s*[-•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      out.push({ kind: 'p', lines: [] });
    } else if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      const item = (ul ?? ol)![1];
      if (last?.kind === kind) last.items.push(item);
      else out.push({ kind, items: [item] });
    } else if (last?.kind === 'p') last.lines.push(line);
    else out.push({ kind: 'p', lines: [line] });
  }
  return out.filter((b) => b.kind !== 'p' || b.lines.length);
}

export function Md({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {blocks(text).map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(line, `${i}-${j}`)}
              </Fragment>
            ))}
          </p>
        ) : b.kind === 'ul' ? (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, `${i}-${j}`)}</li>
            ))}
          </ul>
        ) : (
          <ol key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, `${i}-${j}`)}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}
