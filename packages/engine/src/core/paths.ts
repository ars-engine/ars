import { mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Root of the ARS checkout (…/ars). */
export const ARS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

export const DATA_DIR = resolve(process.env.ARS_DATA ?? join(ARS_ROOT, 'data'));

export function dataPath(...parts: string[]): string {
  const p = join(DATA_DIR, ...parts);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

/** True if `child` is `root` or lies inside it (lexically; resolve symlinks first if that matters). */
export function isInside(root: string, child: string): boolean {
  const r = relative(root, child);
  return r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r);
}

/**
 * Resolve `rel` inside `root`, following symlinks, and return the real path only if it is still
 * inside root. Guards file routes against `..` and against symlinks that point out of the folder.
 */
export function resolveInside(root: string, rel: string): string | undefined {
  try {
    const realRoot = realpathSync(root);
    const abs = realpathSync(resolve(realRoot, rel));
    return isInside(realRoot, abs) ? abs : undefined;
  } catch {
    return undefined;
  }
}

export function ensureDir(p: string): string {
  mkdirSync(p, { recursive: true });
  return p;
}

/** Command used by Claude Code hooks to call back into the ARS checker. */
export const ARS_CLI_COMMAND = `"${join(ARS_ROOT, 'node_modules/.bin/tsx')}" "${join(ARS_ROOT, 'packages/engine/src/cli.ts')}"`;
