import { DatabaseSync } from 'node:sqlite';
import { dataPath } from './paths.ts';

/**
 * A tiny document store on SQLite. Every entity (profile, analysis, convention, skill
 * version, experiment, run, proposal, job, vote) is a JSON document in a named collection.
 */
let db: DatabaseSync | undefined;

function conn(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(dataPath('ars.db'));
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS docs (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        profile_id TEXT,
        created_at INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS docs_profile ON docs (collection, profile_id);
    `);
  }
  return db;
}

export interface Doc {
  id: string;
  profileId?: string;
  createdAt?: number;
}

export function put<T extends Doc>(collection: string, doc: T): T {
  const saved = { ...doc, createdAt: doc.createdAt ?? Date.now() };
  conn()
    .prepare('INSERT OR REPLACE INTO docs (collection, id, profile_id, created_at, data) VALUES (?, ?, ?, ?, ?)')
    .run(collection, saved.id, saved.profileId ?? null, saved.createdAt, JSON.stringify(saved));
  return saved;
}

export function get<T>(collection: string, id: string): T | undefined {
  const row = conn().prepare('SELECT data FROM docs WHERE collection = ? AND id = ?').get(collection, id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as T) : undefined;
}

export function mustGet<T>(collection: string, id: string): T {
  const doc = get<T>(collection, id);
  if (!doc) throw new Error(`${collection} ${id} not found`);
  return doc;
}

export function list<T>(collection: string, profileId?: string): T[] {
  const rows = (
    profileId
      ? conn().prepare('SELECT data FROM docs WHERE collection = ? AND profile_id = ? ORDER BY created_at').all(collection, profileId)
      : conn().prepare('SELECT data FROM docs WHERE collection = ? ORDER BY created_at').all(collection)
  ) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as T);
}

export function update<T extends Doc>(collection: string, id: string, patch: Partial<T>): T {
  return put(collection, { ...mustGet<T>(collection, id), ...patch });
}

export function remove(collection: string, id: string): void {
  conn().prepare('DELETE FROM docs WHERE collection = ? AND id = ?').run(collection, id);
}
