import { loadFacts } from './facts.ts';
import type { Analysis } from './types.ts';

/** Small in-memory cache so the API doesn't re-read SQLite facts on every request. */
const cache = new Map<string, Analysis>();
const MAX = 4;

export function facts(path: string): Analysis {
  const hit = cache.get(path);
  if (hit) return hit;
  const loaded = loadFacts(path);
  cache.set(path, loaded);
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return loaded;
}
