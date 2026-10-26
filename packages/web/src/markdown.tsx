import type { ReactNode } from 'react';

/** Tiny markdown renderer for skill files and the style dossier (headings, lists, code, bold). */

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

const RULE = /\s*<!-- rule:([^ ]+) -->/;

export function Markdown({ text, onRule, selectedRule }: { text: string; onRule?: (id: string) => void; selectedRule?: string }) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  const out: ReactNode[] = [];
  const lines = body.split('\n');
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`ul${out.length}`}>{list}</ul>);
    list = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i].replace(/^ {2}/, ''));
      const block = <pre key={`pre${i}`} className="snippet">{code.join('\n')}</pre>;
      if (list.length) list.push(<li key={`li${i}`} style={{ listStyle: 'none' }}>{block}</li>);
      else out.push(block);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    if (heading) {
      flush();
      const H = `h${heading[1].length + 1}` as 'h2';
      out.push(<H key={i}>{inline(heading[2])}</H>);
    } else if (/^\s*- /.test(line)) {
      const rule = line.match(RULE)?.[1];
      const content = inline(line.replace(/^\s*- /, '').replace(RULE, ''));
      list.push(
        <li key={i}>
          {rule && onRule ? <span className={`rule-line ${selectedRule === rule ? 'sel' : ''}`} onClick={() => onRule(rule)}>{content}</span> : content}
        </li>,
      );
    } else if (line.trim()) {
      flush();
      out.push(<p key={i}>{inline(line)}</p>);
    } else flush();
  }
  flush();
  return <div className="md">{out}</div>;
}
