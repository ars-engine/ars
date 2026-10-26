import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

export const isGitRepo = (dir: string) => existsSync(join(dir, '.git'));

export const isRemoteSource = (source: string) => /^(https?:\/\/|git@|ssh:\/\/)/.test(source) || source.endsWith('.git');

/** Clone using the machine's own git credentials; ARS never sees or stores tokens. */
export function cloneRepo(url: string, dest: string): void {
  execFileSync('git', ['clone', '--depth', '300', url, dest], { stdio: ['ignore', 'pipe', 'pipe'] });
}

export function headSha(dir: string): string {
  try {
    return git(dir, ['rev-parse', 'HEAD']).trim();
  } catch {
    return 'working-tree';
  }
}

/** Tracked + untracked-but-not-ignored files, honouring every .gitignore. */
export function gitFiles(dir: string): string[] {
  return git(dir, ['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean);
}

/** path -> { lastTouched (unix seconds), commits } from a single `git log` pass. */
export function fileHistory(dir: string): Map<string, { lastTouched: number; commits: number }> {
  const history = new Map<string, { lastTouched: number; commits: number }>();
  let out = '';
  try {
    out = git(dir, ['log', '--format=@@%ct', '--name-only', '--no-renames']);
  } catch {
    return history;
  }
  let ts = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('@@')) ts = Number(line.slice(2));
    else if (line) {
      const h = history.get(line);
      if (h) h.commits++;
      else history.set(line, { lastTouched: ts, commits: 1 });
    }
  }
  return history;
}
