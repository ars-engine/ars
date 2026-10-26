import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Root of the ARS checkout (…/ars). */
export const ARS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

export const DATA_DIR = resolve(process.env.ARS_DATA ?? join(ARS_ROOT, 'data'));

export function dataPath(...parts: string[]): string {
  const p = join(DATA_DIR, ...parts);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

export function ensureDir(p: string): string {
  mkdirSync(p, { recursive: true });
  return p;
}

/** Command used by Claude Code hooks to call back into the ARS checker. */
export const ARS_CLI_COMMAND = `"${join(ARS_ROOT, 'node_modules/.bin/tsx')}" "${join(ARS_ROOT, 'packages/engine/src/cli.ts')}"`;
