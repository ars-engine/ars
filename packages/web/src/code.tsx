import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { MergeView } from '@codemirror/merge';
import { EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { Decoration, EditorView, lineNumbers } from '@codemirror/view';
import { useEffect, useRef } from 'react';

/** Read-only CodeMirror views: a highlighted code view and a side-by-side diff. */

function baseExtensions(path: string): Extension[] {
  return [
    lineNumbers(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    /\.mdx?$/.test(path) ? markdown() : javascript({ jsx: true, typescript: /\.tsx?$/.test(path) }),
    oneDark,
    EditorView.theme({ '&': { backgroundColor: '#1e2128' }, '.cm-gutters': { backgroundColor: '#1e2128' } }),
  ];
}

function lineMarks(state: EditorState, lines: number[], cls: string) {
  const builder = new RangeSetBuilder<Decoration>();
  for (const n of [...new Set(lines)].sort((a, b) => a - b)) {
    if (n >= 1 && n <= state.doc.lines) builder.add(state.doc.line(n).from, state.doc.line(n).from, Decoration.line({ class: cls }));
  }
  return builder.finish();
}

export function CodeView({ text, path, highlight = [], bad = [], focus, height = 420 }: {
  text: string; path: string; highlight?: number[]; bad?: number[]; focus?: number; height?: number | string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const doc = EditorState.create({ doc: text });
    const marks = [EditorView.decorations.of(lineMarks(doc, highlight, 'cm-ars-hit')), EditorView.decorations.of(lineMarks(doc, bad, 'cm-ars-bad'))];
    const view = new EditorView({ parent: ref.current!, state: EditorState.create({ doc: text, extensions: [...baseExtensions(path), ...marks] }) });
    const line = focus ?? highlight[0] ?? bad[0];
    if (line && line <= view.state.doc.lines) view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'center' }) });
    return () => view.destroy();
  }, [text, path, highlight.join(','), bad.join(','), focus]);
  return (
    <div className="code">
      <div className="code-head"><span className="ellipsis">{path}</span></div>
      <div ref={ref} style={{ height, overflow: 'auto' }} />
    </div>
  );
}

export function DiffView({ a, b, path, labels = ['before', 'after'], height = 520 }: { a: string; b: string; path: string; labels?: [string, string]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const view = new MergeView({ a: { doc: a, extensions: baseExtensions(path) }, b: { doc: b, extensions: baseExtensions(path) }, parent: ref.current! });
    return () => view.destroy();
  }, [a, b, path]);
  return (
    <div className="code">
      <div className="code-head"><span>{labels[0]}</span><span className="right">{labels[1]}</span></div>
      <div ref={ref} style={{ height, overflow: 'auto' }} />
    </div>
  );
}
