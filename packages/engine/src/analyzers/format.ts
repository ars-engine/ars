import { diffLines } from 'diff';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as prettier from 'prettier';
import type { FormatOptions, FormattingProfile } from '../core/types.ts';

/**
 * L1 formatting. If the repo has a static Prettier config we use it; otherwise we infer one by
 * searching the option space for the config that reproduces the source with the fewest changed lines.
 *
 * Analyzed repos are untrusted, so Prettier never loads their config itself: a JS config or a plugin
 * would run the repo's code. We parse static configs ourselves and keep only the options we learn.
 */

const SEARCH_SPACE: Record<string, (string | number | boolean)[]> = {
  useTabs: [false, true],
  tabWidth: [2, 4],
  semi: [true, false],
  singleQuote: [false, true],
  jsxSingleQuote: [false, true],
  trailingComma: ['all', 'es5', 'none'],
  printWidth: [80, 100, 120],
  bracketSpacing: [true, false],
  arrowParens: ['always', 'avoid'],
  bracketSameLine: [false, true],
};

const DEFAULTS: FormatOptions = Object.fromEntries(Object.entries(SEARCH_SPACE).map(([k, v]) => [k, v[0]]));
const FORMATTABLE = /\.[cm]?[jt]sx?$/;
const STATIC_CONFIGS = ['.prettierrc', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.yml', '.prettierrc.toml'];

export const isFormattable = (path: string) => FORMATTABLE.test(path);

/** Keep only the options ARS learns, as plain values: never plugins, overrides or parser settings. */
export function safeOptions(options: Record<string, unknown>): FormatOptions {
  return Object.fromEntries(
    Object.entries(options).filter(([k, v]) => k in SEARCH_SPACE && ['string', 'number', 'boolean'].includes(typeof v)),
  ) as FormatOptions;
}

/** Top-level `key: value` (YAML) or `key = value` (TOML) pairs; nested sections are ignored. */
function parseFlatConfig(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of text.split('\n')) {
    if (/^\s*\[/.test(line)) break;
    const m = line.match(/^([A-Za-z]+)\s*[:=]\s*(.+?)\s*$/);
    if (!m) continue;
    const raw = m[2].replace(/\s+#.*$/, '');
    out[m[1]] = raw === 'true' ? true : raw === 'false' ? false : /^\d+$/.test(raw) ? Number(raw) : raw.replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** A regular file at the repo root, never a symlink, and small. */
function readRootFile(root: string, name: string): string | undefined {
  try {
    const stat = lstatSync(join(root, name));
    return stat.isFile() && stat.size < 64_000 ? readFileSync(join(root, name), 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

function staticConfig(root: string, texts: Map<string, string>): Record<string, unknown> | undefined {
  for (const name of STATIC_CONFIGS) {
    const text = readRootFile(root, name);
    if (text === undefined) continue;
    try {
      return JSON.parse(text);
    } catch {
      return parseFlatConfig(text);
    }
  }
  try {
    const key = JSON.parse(texts.get('package.json') ?? '{}').prettier;
    // A string here names a shared config package, which would have to be imported: skip it.
    return key && typeof key === 'object' ? key : undefined;
  } catch {
    return undefined;
  }
}

async function changedLines(text: string, filepath: string, options: FormatOptions): Promise<number> {
  try {
    const out = await prettier.format(text, { ...safeOptions(options), filepath });
    return diffLines(text, out).reduce((n, part) => n + (part.added || part.removed ? part.count ?? 0 : 0), 0);
  } catch {
    return Number.MAX_SAFE_INTEGER / 1000;
  }
}

async function score(samples: [string, string][], options: FormatOptions): Promise<number> {
  let total = 0;
  for (const [path, text] of samples) total += await changedLines(text, path, options);
  return total;
}

function pickSamples(texts: Map<string, string>, max = 12): [string, string][] {
  return [...texts]
    .filter(([p, t]) => isFormattable(p) && !/\.(test|spec)\./.test(p) && t.split('\n').length > 15)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .filter((_, i, all) => i % Math.max(1, Math.floor(all.length / max)) === 0)
    .slice(0, max)
    .map(([p, t]) => [p, t.split('\n').slice(0, 400).join('\n')]);
}

function repoConfig(root: string, texts: Map<string, string>): FormatOptions | undefined {
  const options = safeOptions(staticConfig(root, texts) ?? {});
  return Object.keys(options).length ? { ...DEFAULTS, ...options } : undefined;
}

export async function inferFormatting(root: string, texts: Map<string, string>): Promise<FormattingProfile> {
  const samples = pickSamples(texts);
  const fromRepo = repoConfig(root, texts);
  let options = fromRepo ?? { ...DEFAULTS };
  if (!fromRepo && samples.length) {
    let best = await score(samples, options);
    for (let pass = 0; pass < 2; pass++) {
      for (const [key, values] of Object.entries(SEARCH_SPACE)) {
        for (const value of values) {
          if (options[key] === value) continue;
          const candidate = { ...options, [key]: value };
          const s = await score(samples, candidate);
          if (s < best) {
            best = s;
            options = candidate;
          }
        }
      }
    }
  }
  const totalLines = samples.reduce((n, [, t]) => n + t.split('\n').length, 0) || 1;
  const changed = await score(samples, options);
  let filesExact = 0;
  for (const [path, text] of samples) if ((await changedLines(text, path, options)) === 0) filesExact++;
  return {
    options,
    source: fromRepo ? 'repo-config' : 'inferred',
    lineMatch: Math.max(0, 1 - changed / totalLines),
    filesExact,
    filesSampled: samples.length,
  };
}

export async function formatText(text: string, filepath: string, options: FormatOptions): Promise<string> {
  // Also filters options from rules.json files generated before this check existed.
  return prettier.format(text, { ...safeOptions(options), filepath });
}

export async function isFormatted(text: string, filepath: string, options: FormatOptions): Promise<boolean> {
  try {
    return (await formatText(text, filepath, options)) === text;
  } catch {
    return false;
  }
}

/** Human summary of formatter options, e.g. "2 spaces · single quotes · no semicolons". */
export function describeFormatting(o: FormatOptions): string[] {
  return [
    o.useTabs ? 'tabs' : `${o.tabWidth} spaces`,
    o.singleQuote ? 'single quotes' : 'double quotes',
    o.semi ? 'semicolons' : 'no semicolons',
    `trailing commas: ${o.trailingComma}`,
    `line width ${o.printWidth}`,
    o.bracketSpacing ? '{ spaced } braces' : '{tight} braces',
    o.arrowParens === 'always' ? '(x) => arrow parens' : 'x => no arrow parens',
    o.jsxSingleQuote ? "JSX single quotes" : 'JSX double quotes',
  ];
}
