import { basename } from 'node:path';
import type { ImportEdge, StackInfo } from '../core/types.ts';
import { LANG_BY_EXT } from './roles.ts';

/** Stack-neutral analyzer: languages, manifests, frameworks and shallow imports for any repository. */

const MANIFESTS: Record<string, string> = {
  'package.json': 'node', 'pyproject.toml': 'python', 'requirements.txt': 'python', 'setup.py': 'python',
  'go.mod': 'go', 'Cargo.toml': 'rust', 'pom.xml': 'java', 'build.gradle': 'java', 'build.gradle.kts': 'kotlin',
  'Gemfile': 'ruby', 'composer.json': 'php',
};

const FRAMEWORKS: [string, RegExp][] = [
  ['React', /^react$/], ['Next.js', /^next$/], ['Vite', /^vite$/], ['Remix', /^@remix-run\//], ['Vue', /^vue$/],
  ['Svelte', /^svelte$/], ['Angular', /^@angular\/core$/], ['Express', /^express$/], ['NestJS', /^@nestjs\/core$/],
  ['React Native', /^react-native$/], ['Tailwind CSS', /^tailwindcss$/],
];

const PY_FRAMEWORKS: [string, RegExp][] = [['Django', /django/i], ['Flask', /flask/i], ['FastAPI', /fastapi/i]];

export const DEEP_LANGUAGES = new Set(['typescript', 'javascript']);

export function langOf(path: string): string {
  const m = path.match(/\.[a-z0-9]+$/i);
  return (m && LANG_BY_EXT[m[0].toLowerCase()]) || 'other';
}

/** Merge dependencies from every package.json in the repo (handles monorepos). */
export function collectDependencies(texts: Map<string, string>): Record<string, string> {
  const deps: Record<string, string> = {};
  for (const [path, text] of texts) {
    if (basename(path) !== 'package.json') continue;
    try {
      const pkg = JSON.parse(text);
      Object.assign(deps, pkg.devDependencies, pkg.dependencies);
    } catch {
      /* malformed manifest: ignore */
    }
  }
  return deps;
}

export function detectStack(files: string[], texts: Map<string, string>, deps: Record<string, string>): StackInfo {
  const languages: Record<string, number> = {};
  for (const f of files) {
    const lang = langOf(f);
    if (!['json', 'markdown', 'yaml', 'toml', 'other'].includes(lang)) languages[lang] = (languages[lang] ?? 0) + 1;
  }
  const manifests = files.filter((f) => MANIFESTS[basename(f)]);
  const frameworks = FRAMEWORKS.filter(([, re]) => Object.keys(deps).some((d) => re.test(d))).map(([n]) => n);
  const pyManifest = [...texts].filter(([p]) => /(pyproject\.toml|requirements\.txt)$/.test(p)).map(([, t]) => t).join('\n');
  frameworks.push(...PY_FRAMEWORKS.filter(([, re]) => re.test(pyManifest)).map(([n]) => n));
  const coverage = Object.fromEntries(
    Object.keys(languages).map((l) => [l, DEEP_LANGUAGES.has(l) ? 'deep' : 'shallow'] as const),
  );
  return { languages, frameworks, manifests, coverage };
}

/** Shallow, regex-based imports for languages without a deep analyzer. */
export function shallowImports(file: string, text: string): ImportEdge[] {
  const lang = langOf(file);
  const re =
    lang === 'python' ? /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm
    : lang === 'go' ? /^\s*(?:import\s+)?"([\w./-]+)"/gm
    : lang === 'rust' ? /^\s*use\s+([\w:]+)/gm
    : lang === 'java' || lang === 'kotlin' ? /^\s*import\s+([\w.]+)/gm
    : null;
  if (!re) return [];
  return [...text.matchAll(re)].map((m) => ({
    from: file,
    spec: m[1] ?? m[2],
    kind: (m[1] ?? m[2]).startsWith('.') ? 'relative' : 'package',
    line: text.slice(0, m.index).split('\n').length,
  }));
}
