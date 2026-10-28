import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataPath } from '../core/paths.ts';

/**
 * Git only ever runs to clone or pull ARS's own checkout of a Git URL. A folder's .git/config is
 * untrusted (core.fsmonitor, gpg.program, hooks and more run commands, and a blocklist of keys keeps
 * missing some), so analyzed folders are read without starting git inside them: HEAD is read as a
 * file, and history comes from a fresh repository that borrows only the folder's object store.
 */
const SAFE_CONFIG = [
  '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never', '-c', 'log.showSignature=false',
];

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

/** A small regular file under .git, or undefined. Never follows a symlink. */
function readGitFile(gitDir: string, rel: string): string | undefined {
  try {
    const path = join(gitDir, rel);
    const stat = lstatSync(path);
    return stat.isFile() && stat.size <= 1_000_000 ? readFileSync(path, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

/** The real .git directory of a folder (not a worktree's .git file), or undefined. */
function gitDirOf(dir: string): string | undefined {
  try {
    const gitDir = join(dir, '.git');
    return lstatSync(gitDir).isDirectory() ? gitDir : undefined;
  } catch {
    return undefined;
  }
}

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** HEAD's commit, read from .git as plain files. */
export function readHead(dir: string): string | undefined {
  const gitDir = gitDirOf(dir);
  const head = gitDir && readGitFile(gitDir, 'HEAD')?.trim();
  if (!gitDir || !head) return undefined;
  if (SHA.test(head)) return head;
  const ref = head.match(/^ref: (refs\/[\w./-]+)$/)?.[1];
  if (!ref || ref.split('/').includes('..')) return undefined;
  const loose = readGitFile(gitDir, ref)?.trim();
  if (loose && SHA.test(loose)) return loose;
  for (const line of readGitFile(gitDir, 'packed-refs')?.split('\n') ?? []) {
    const [sha, name] = line.split(' ');
    if (name === ref && SHA.test(sha)) return sha;
  }
  return undefined;
}

export const headSha = (dir: string) => readHead(dir) ?? 'working-tree';

/**
 * path -> { lastTouched (unix seconds), commits } from a single `git log` pass. Git runs in an empty
 * bare repository that ARS creates, pointed at the folder's objects through objects/info/alternates,
 * so the folder's config, hooks and attributes are never read.
 */
export function fileHistory(dir: string): Map<string, { lastTouched: number; commits: number }> {
  const history = new Map<string, { lastTouched: number; commits: number }>();
  const gitDir = gitDirOf(dir);
  const sha = readHead(dir);
  if (!gitDir || !sha) return history;
  let tmp: string | undefined;
  let out = '';
  try {
    const objects = realpathSync(join(gitDir, 'objects'));
    if (!statSync(objects).isDirectory() || /[\r\n]/.test(objects)) return history;
    tmp = mkdtempSync(dataPath('tmp', 'history-'));
    execFileSync('git', ['init', '--quiet', '--bare', tmp], { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
    writeFileSync(join(tmp, 'objects', 'info', 'alternates'), `${objects}\n`);
    const shallow = readGitFile(gitDir, 'shallow');
    if (shallow && shallow.split('\n').every((l) => !l || SHA.test(l))) writeFileSync(join(tmp, 'shallow'), shallow);
    out = git(tmp, ['--git-dir', tmp, 'log', '--no-show-signature', '--format=@@%ct', '--name-only', '--no-renames', sha, '--']);
  } catch {
    return history;
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
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
