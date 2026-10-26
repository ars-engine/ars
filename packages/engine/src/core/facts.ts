import { DatabaseSync } from 'node:sqlite';
import type { Analysis } from './types.ts';

/**
 * Fact store: one SQLite file per analysis run, holding the raw facts
 * (files, observations, imports) the analyzers produced.
 */
export function saveFacts(path: string, analysis: Analysis): void {
  const db = new DatabaseSync(path);
  db.exec(`
    DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS observations; DROP TABLE IF EXISTS imports; DROP TABLE IF EXISTS meta;
    CREATE TABLE files (path TEXT PRIMARY KEY, lang TEXT, role TEXT, lines INTEGER, last_touched INTEGER, commits INTEGER);
    CREATE TABLE observations (feature TEXT, value TEXT, file TEXT, line INTEGER, role TEXT);
    CREATE TABLE imports (src TEXT, spec TEXT, target TEXT, kind TEXT, line INTEGER);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE INDEX obs_feature ON observations (feature);
  `);
  db.exec('BEGIN');
  const f = db.prepare('INSERT INTO files VALUES (?, ?, ?, ?, ?, ?)');
  for (const x of analysis.files) f.run(x.path, x.lang, x.role, x.lines, x.lastTouched ?? null, x.commits ?? null);
  const o = db.prepare('INSERT INTO observations VALUES (?, ?, ?, ?, ?)');
  for (const x of analysis.observations) o.run(x.feature, JSON.stringify(x.value), x.file, x.line, x.role);
  const i = db.prepare('INSERT INTO imports VALUES (?, ?, ?, ?, ?)');
  for (const x of analysis.imports) i.run(x.from, x.spec, x.to ?? null, x.kind, x.line);
  const m = db.prepare('INSERT INTO meta VALUES (?, ?)');
  m.run('root', analysis.root);
  m.run('dependencies', JSON.stringify(analysis.dependencies));
  m.run('stack', JSON.stringify(analysis.stack));
  db.exec('COMMIT');
  db.close();
}

export function loadFacts(path: string): Analysis {
  const db = new DatabaseSync(path, { readOnly: true });
  const meta = Object.fromEntries(
    (db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map((r) => [r.key, r.value]),
  );
  const files = (db.prepare('SELECT * FROM files').all() as any[]).map((r) => ({
    path: r.path, lang: r.lang, role: r.role, lines: r.lines,
    lastTouched: r.last_touched ?? undefined, commits: r.commits ?? undefined,
  }));
  const observations = (db.prepare('SELECT * FROM observations').all() as any[]).map((r) => ({
    feature: r.feature, value: JSON.parse(r.value), file: r.file, line: r.line, role: r.role,
  }));
  const imports = (db.prepare('SELECT * FROM imports').all() as any[]).map((r) => ({
    from: r.src, spec: r.spec, to: r.target ?? undefined, kind: r.kind, line: r.line,
  }));
  db.close();
  return {
    root: meta.root, files, observations, imports,
    dependencies: JSON.parse(meta.dependencies), stack: JSON.parse(meta.stack),
  };
}
