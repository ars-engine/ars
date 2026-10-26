import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { gitFiles, isGitRepo } from './git.ts';
import { findSecrets, type SecretHit } from './secrets.ts';

/** Directories and files that never describe how a developer writes code. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo', '.vercel', 'coverage',
  'vendor', '.cache', '.parcel-cache', 'storybook-static', '__generated__', 'generated', '.claude', '.ars',
  '__pycache__', '.venv', 'venv', 'target', '.idea', '.vscode',
]);
const SKIP_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|CLAUDE\.md|AGENTS\.md)$|\.min\.(js|css)$|\.map$|\.d\.ts$/;
const SECRET_FILES = /(^|\/)\.env(\..*)?$|\.(pem|key|p12|pfx)$/;
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.scss', '.sass', '.less', '.html', '.md',
  '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.swift', '.vue', '.svelte', '.yml', '.yaml', '.toml', '.sql',
]);
const MAX_BYTES = 300_000;

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

function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, join(dir, entry.name), out);
    } else out.push(relative(root, join(dir, entry.name)));
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
  if (statSync(abs).size > MAX_BYTES) return 'file too large (likely generated)';
  return undefined;
}

const isGenerated = (text: string) => /@generated|auto-generated|do not edit/i.test(text.slice(0, 400));

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
  const candidates = isGitRepo(root) ? gitFiles(root) : walk(root);
  const files: string[] = [];
  const texts = new Map<string, string>();
  const skipped: { path: string; reason: string }[] = [];
  const secrets: SecretHit[] = [];
  for (const path of candidates) {
    const abs = join(root, path);
    if (!existsSync(abs)) continue;
    const reason = skipReason(path, abs);
    if (reason) {
      skipped.push({ path, reason });
      continue;
    }
    const text = readFileSync(abs, 'utf8');
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
