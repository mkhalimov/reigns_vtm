// Минимальный Markdown для текстов карт: **жирный**, *курсив*/_курсив_, переносы строк.
// Без innerHTML — текст колоды не может внедрить разметку.
import { Fragment, type ReactNode } from 'react';

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={`${keyBase}-${k++}`}>{inline(m[1], `${keyBase}b${k}`)}</strong>);
    else out.push(<em key={`${keyBase}-${k++}`}>{inline(m[2] ?? m[3], `${keyBase}i${k}`)}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Md({ text, className }: { text: string; className?: string }) {
  const paras = text.split(/\n{2,}/);
  return (
    <div className={className}>
      {paras.map((p, i) => (
        <p key={i}>
          {p.split('\n').map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {inline(line, `${i}-${j}`)}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
