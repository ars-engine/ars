import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A local folder's .git/config is untrusted: settings such as core.fsmonitor or core.hooksPath run
 * commands. Override them on every call, and never allow the ext:: transport.
 */
const SAFE_CONFIG = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never'];

const git = (cwd: string, args: string[]) =>
  execFileSync('git', [...SAFE_CONFIG, ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

export const isGitRepo = (dir: string) => existsSync(join(dir, '.git'));

export const isRemoteSource = (source: string) => /^(https?:\/\/|git@|ssh:\/\/)/.test(source) || source.endsWith('.git');

/** Refuse sources that git would read as an option, and URLs that carry credentials. */
export function checkSource(source: string): void {
  if (source.startsWith('-')) throw new Error('A Git URL or folder path cannot start with "-".');
  if (/^https?:\/\/[^/]*@/i.test(source)) {
    throw new Error("Remove the credentials from the URL. ARS clones with your machine's own git credentials (SSH keys or a credential helper) and never stores tokens.");
  }
}

/** Clone using the machine's own git credentials; ARS never sees or stores tokens. */
export function cloneRepo(url: string, dest: string): void {
  checkSource(url);
  execFileSync('git', [...SAFE_CONFIG, 'clone', '--depth', '300', '--', url, dest], { stdio: ['ignore', 'pipe', 'pipe'] });
}

export function pullRepo(dir: string): void {
  git(dir, ['pull', '--ff-only']);
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
