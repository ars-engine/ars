import { diffLines } from 'diff';
import { join } from 'node:path';
import * as prettier from 'prettier';
import type { FormatOptions, FormattingProfile } from '../core/types.ts';

/**
 * L1 formatting. If the repo has a Prettier config we use it; otherwise we infer one by
 * searching the option space for the config that reproduces the source with the fewest changed lines.
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
const CONFIG_FILE = /(^|\/)(\.prettierrc(\.(json|ya?ml|js|cjs|mjs|toml))?|prettier\.config\.[cm]?js)$/;

export const isFormattable = (path: string) => FORMATTABLE.test(path);

async function changedLines(text: string, filepath: string, options: FormatOptions): Promise<number> {
  try {
    const out = await prettier.format(text, { ...options, filepath });
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

async function repoConfig(root: string, texts: Map<string, string>): Promise<FormatOptions | undefined> {
  const hasConfig = [...texts.keys()].some((p) => CONFIG_FILE.test(p))
    || /"prettier"\s*:/.test(texts.get('package.json') ?? '');
  if (!hasConfig) return undefined;
  const sample = [...texts.keys()].find(isFormattable);
  const config = sample ? await prettier.resolveConfig(join(root, sample)).catch(() => null) : null;
  return config ? { ...DEFAULTS, ...(config as FormatOptions) } : undefined;
}

export async function inferFormatting(root: string, texts: Map<string, string>): Promise<FormattingProfile> {
  const samples = pickSamples(texts);
  const fromRepo = await repoConfig(root, texts);
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
  return prettier.format(text, { ...options, filepath });
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
