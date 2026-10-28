import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { resolveInside } from '../core/paths.ts';
import { findSecrets, type SecretHit } from './secrets.ts';

/** Directories and files that never describe how a developer writes code. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo', '.vercel', 'coverage',
  'vendor', '.cache', '.parcel-cache', 'storybook-static', '__generated__', 'generated', '.claude', '.ars',
  '__pycache__', '.venv', 'venv', 'target', '.idea', '.vscode',
]);
const SKIP_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|CLAUDE(\.local)?\.md|AGENTS\.md|\.mcp\.json)$|\.min\.(js|css)$|\.map$|\.d\.ts$/;
const SECRET_FILES = /(^|\/)\.env(\..*)?$|\.(pem|key|p12|pfx)$/;
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.scss', '.sass', '.less', '.html', '.md',
  '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.swift', '.vue', '.svelte', '.yml', '.yaml', '.toml', '.sql',
]);
const MAX_BYTES = 300_000;
/** Whole-repo limits, so a huge or hostile repository can't exhaust memory. */
const MAX_FILES = 20_000;
const MAX_TOTAL_BYTES = 80_000_000;

export interface SkipRecord {
  path: string;
  reason: string;
  count: number;
}

export interface IngestResult {
  root: string;
  files: string[];
  texts: Map<string, string>;
  skipped: SkipRecord[];
  secrets: SecretHit[];
}

/** A small regular file's text, or undefined. Used for ignore files, which may be symlinks. */
function readSmallFile(abs: string): string | undefined {
  try {
    const stat = lstatSync(abs);
    return stat.isFile() && stat.size <= MAX_BYTES ? readFileSync(abs, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

interface IgnoreRules {
  /** Folder the rules apply to, relative to the root ('' for the root). */
  base: string;
  rules: Ignore;
}

const isIgnored = (rules: IgnoreRules[], path: string, isDir: boolean) =>
  rules.some(({ base, rules: r }) => {
    const rel = base ? path.slice(base.length + 1) : path;
    return rel !== '' && r.ignores(isDir ? `${rel}/` : rel);
  });

/**
 * List files without running git, honouring every .gitignore and .git/info/exclude. Symlinked
 * folders are listed as entries, never entered.
 */
function walk(root: string, dir = root, rules: IgnoreRules[] = [], out: string[] = []): string[] {
  const base = relative(root, dir).split('\\').join('/');
  const local = [base ? '' : readSmallFile(join(root, '.git', 'info', 'exclude')), readSmallFile(join(dir, '.gitignore'))].filter(Boolean);
  const scoped = local.length ? [...rules, { base, rules: ignore().add(local.join('\n')) }] : rules;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !isIgnored(scoped, path, true)) walk(root, join(dir, entry.name), scoped, out);
    } else if (!isIgnored(scoped, path, false)) out.push(path);
  }
  return out;
}

function skipReason(path: string, abs: string): string | undefined {
  const segments = path.split('/');
  const dir = segments.slice(0, -1).find((s) => SKIP_DIRS.has(s));
  if (dir) return `${dir}/ (dependencies, build output or tooling)`;
  if (SECRET_FILES.test(path)) return 'secrets file';
  if (SKIP_FILES.test(path)) return 'lockfile, map, declaration or agent config';
  if (!TEXT_EXT.has(extname(path))) return 'binary or unsupported file type';
  // lstat, not stat: a symlink could point anywhere on the machine (~/.ssh, /etc), and a FIFO or
  // device would block the read forever. Only regular files inside the repo are read.
  const stat = lstatSync(abs);
  if (stat.isSymbolicLink()) return 'symlink (never followed)';
  if (!stat.isFile()) return 'not a regular file';
  if (stat.size > MAX_BYTES) return 'file too large (likely generated)';
  return undefined;
}

/** existsSync follows symlinks, so a dangling one would look missing; check the entry itself. */
const lexists = (abs: string) => {
  try {
    lstatSync(abs);
    return true;
  } catch {
    return false;
  }
};

const isGenerated =(text: string) => /@generated|auto-generated|do not edit/i.test(text.slice(0, 400));

/** Collapse skip records by top-level folder + reason so the UI shows a short list. */
function summarizeSkips(items: { path: string; reason: string }[]): SkipRecord[] {
  const map = new Map<string, SkipRecord>();
  for (const { path, reason } of items) {
    const key = `${path.split('/').slice(0, 2).join('/')}|${reason}`;
    const rec = map.get(key);
    if (rec) rec.count++;
    else map.set(key, { path: path.split('/').slice(0, 2).join('/'), reason, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Read a repository: list relevant text files, skip noise, scan for secrets. */
export function ingest(rootInput: string): IngestResult {
  const root = resolve(rootInput);
  if (!existsSync(root)) throw new Error(`Folder not found: ${root}`);
  const candidates = walk(root);
  const files: string[] = [];
  const texts = new Map<string, string>();
  const skipped: { path: string; reason: string }[] = [];
  const secrets: SecretHit[] = [];
  let totalBytes = 0;
  for (const path of candidates) {
    const abs = join(root, path);
    if (!lexists(abs)) continue;
    const reason = files.length >= MAX_FILES || totalBytes > MAX_TOTAL_BYTES ? 'over the repository size limit' : skipReason(path, abs);
    // lstat only checks the last component; a symlinked parent folder could still lead outside.
    const real = reason ? undefined : resolveInside(root, path);
    if (reason || !real) {
      skipped.push({ path, reason: reason ?? 'outside the repository (symlinked folder)' });
      continue;
    }
    const text = readFileSync(real, 'utf8');
    totalBytes += text.length;
    if (isGenerated(text)) {
      skipped.push({ path, reason: 'generated code' });
      continue;
    }
    files.push(path);
    texts.set(path, text);
    secrets.push(...findSecrets(path, text));
  }
  return { root, files, texts, skipped: summarizeSkips(skipped), secrets };
}
