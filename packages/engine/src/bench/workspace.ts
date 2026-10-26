import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Condition, Profile, SkillVersion } from '../core/entities.ts';
import { dataPath, ensureDir } from '../core/paths.ts';
import { mustGet } from '../core/store.ts';
import { runCommand } from '../core/util.ts';
import { ingest } from '../ingest/ingest.ts';
import { installPackage } from '../skills/install.ts';
import { genericSkill } from './generic.ts';
import { SCAFFOLD } from './tasks.ts';

/** Isolated workspaces for agent runs: one fresh folder per run, nothing shared between conditions. */

const SCAFFOLD_VERSION = 'v1';

const writeFiles = (dir: string, files: Record<string, string>) => {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
};

/** npm install the neutral scaffold once; later runs clone its node_modules. */
export async function ensureScaffoldCache(log: (m: string) => void, signal?: AbortSignal): Promise<string> {
  const dir = dataPath('cache', `scaffold-${SCAFFOLD_VERSION}`, '.keep').replace(/\/\.keep$/, '');
  if (existsSync(join(dir, 'node_modules/.bin/vitest'))) return dir;
  log('Installing the benchmark scaffold dependencies (first run only)…');
  writeFiles(dir, SCAFFOLD);
  const ok = await runCommand('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, timeout: 600_000, signal });
  if (!ok) throw new Error('npm install failed for the benchmark scaffold.');
  return dir;
}

/** Copy-on-write clone on macOS (APFS), plain copy elsewhere. */
async function cloneDir(from: string, to: string, signal?: AbortSignal) {
  const ok = await runCommand('cp', process.platform === 'darwin' ? ['-cR', from, to] : ['-R', from, to], { signal });
  if (!ok) cpSync(from, to, { recursive: true });
}

export async function scaffoldWorkspace(dir: string, withDeps: boolean, log: (m: string) => void, signal?: AbortSignal): Promise<void> {
  rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
  writeFiles(dir, SCAFFOLD);
  if (withDeps) await cloneDir(join(await ensureScaffoldCache(log, signal), 'node_modules'), join(dir, 'node_modules'), signal);
}

/** Copy the reference repo's own files (minus held-out files and agent configs) for T1. */
export function repoWorkspace(dir: string, repoDir: string, exclude: Set<string>): void {
  rmSync(dir, { recursive: true, force: true });
  const { files, texts } = ingest(repoDir);
  writeFiles(dir, Object.fromEntries(files.filter((f) => !exclude.has(f)).map((f) => [f, texts.get(f)!])));
}

export function installCondition(dir: string, condition: Condition, profile: Profile, arsWords: number): void {
  if (condition.kind === 'generic') writeFiles(dir, { '.claude/skills/react-typescript-guide/SKILL.md': genericSkill(arsWords) });
  if (condition.kind === 'ars') {
    const version = mustGet<SkillVersion>('skills', condition.skillVersionId!);
    installPackage(version.dir, dir, profile.slug);
  }
}

/** Hash of every text file, to find what the agent created or changed. */
export function snapshot(dir: string): Map<string, string> {
  const { files, texts } = ingest(dir);
  return new Map(files.map((f) => [f, createHash('sha1').update(texts.get(f)!).digest('hex')]));
}

export function changedFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...after].filter(([f, h]) => before.get(f) !== h && !/^(\.claude|\.ars|ars-acceptance)\//.test(f)).map(([f]) => f);
}
