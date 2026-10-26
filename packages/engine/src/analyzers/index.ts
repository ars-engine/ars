import { basename, dirname } from 'node:path';
import type { Analysis, FileInfo, ImportEdge, Observation, Role } from '../core/types.ts';
import { fileHistory, isGitRepo } from '../ingest/git.ts';
import { ingest, type IngestResult } from '../ingest/ingest.ts';
import { collectDependencies, DEEP_LANGUAGES, detectStack, langOf, shallowImports } from './generic.ts';
import { classifyRole } from './roles.ts';
import { analyzeTsFile, readAliases, resolveImport } from './typescript.ts';

/** Folders that group many sibling units; the unit name is generalized to "*". */
const GROUPING_DIRS = new Set(['features', 'modules', 'domains', 'pages', 'components', 'views', 'screens', 'routes', 'app', 'widgets', 'entities', 'containers']);
const ROLE_DIRS = new Set(['hooks', 'api', 'components', 'utils', 'lib', 'types', 'services', 'store', 'stores', 'helpers', 'ui', 'styles', '__tests__', 'tests', 'context', 'contexts', 'constants', 'queries']);

export function dirPattern(path: string): string {
  const segs = dirname(path).split('/');
  if (segs[0] === '.') return '(root)';
  return segs.map((s, i) => (i > 0 && GROUPING_DIRS.has(segs[i - 1]) && !ROLE_DIRS.has(s) ? '*' : s)).join('/');
}

const PLACED_ROLES: Role[] = ['component', 'hook', 'api', 'store', 'type', 'util', 'route'];
const testBase = (p: string) => basename(p).replace(/\.(test|spec)\.[cm]?[jt]sx?$/, '');
const srcBase = (p: string) => basename(p).replace(/\.[cm]?[jt]sx?$/, '');
const featureOf = (p: string) => p.match(/(^|\/)(features|modules|domains)\/([^/]+)\//);

/** Facts that need the whole repo: placement, data access, feature boundaries, tests. */
function relationalObservations(files: FileInfo[], edges: ImportEdge[], network: Set<string>): Observation[] {
  const out: Observation[] = [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  const push = (feature: string, value: string, f: FileInfo, line = 1) => out.push({ feature, value, file: f.path, line, role: f.role });
  const edgesFrom = new Map<string, ImportEdge[]>();
  for (const e of edges) edgesFrom.set(e.from, [...(edgesFrom.get(e.from) ?? []), e]);
  const roleOf = (p?: string) => (p ? byPath.get(p)?.role : undefined);

  for (const f of files) {
    if (!DEEP_LANGUAGES.has(f.lang)) continue;
    if (PLACED_ROLES.includes(f.role)) push(`placement.${f.role}`, dirPattern(f.path), f);
    if (network.has(f.path)) push('network.location', f.role, f);
    if (f.role === 'component' || f.role === 'route') {
      const targets = (edgesFrom.get(f.path) ?? []).map((e) => e.to).filter((t): t is string => !!t);
      const hookFetches = (h: string) => network.has(h) || (edgesFrom.get(h) ?? []).some((e) => roleOf(e.to) === 'api');
      const access = network.has(f.path) ? 'inline-request'
        : targets.some((t) => roleOf(t) === 'api') ? 'direct-api-import'
        : targets.some((t) => roleOf(t) === 'hook' && hookFetches(t)) ? 'via-hook'
        : targets.some((t) => roleOf(t) === 'store') ? 'via-store'
        : undefined;
      if (access) push('component.dataAccess', access, f);
    }
  }

  for (const e of edges) {
    const a = featureOf(e.from);
    const b = e.to ? featureOf(e.to) : null;
    if (!a || !b || a[3] === b[3]) continue;
    const isEntry = new RegExp(`(^|/)${b[2]}/${b[3]}/index\\.[cm]?[jt]sx?$`).test(e.to!);
    push('architecture.featureImports', isEntry ? 'public-entry' : 'deep-import', byPath.get(e.from)!, e.line);
  }

  const tests = files.filter((f) => f.role === 'test' && DEEP_LANGUAGES.has(f.lang));
  if (tests.length >= 3) {
    for (const t of tests) push('tests.naming', /\.spec\./.test(t.path) ? '.spec' : '.test', t);
    const testsByBase = new Map<string, string[]>();
    for (const t of tests) testsByBase.set(testBase(t.path), [...(testsByBase.get(testBase(t.path)) ?? []), t.path]);
    for (const f of files) {
      if (!['component', 'hook', 'util', 'api'].includes(f.role)) continue;
      const match = testsByBase.get(srcBase(f.path))?.[0];
      if (!match) continue;
      const loc = dirname(match) === dirname(f.path) ? 'sibling'
        : dirname(match) === `${dirname(f.path)}/__tests__` ? '__tests__' : 'separate-folder';
      push('tests.location', loc, f);
    }
  }
  return out;
}

/**
 * Analyze a directory: deep analysis for TS/JS, shallow inventory for everything else.
 * The same function analyzes the reference repo and agent-generated workspaces.
 */
export function analyzeDirectory(root: string, ingested?: IngestResult): Analysis {
  const ing = ingested ?? ingest(root);
  const history = isGitRepo(ing.root) ? fileHistory(ing.root) : new Map();
  const dependencies = collectDependencies(ing.texts);
  const stack = detectStack(ing.files, ing.texts, dependencies);
  const aliases = readAliases(ing.texts);
  const files: FileInfo[] = [];
  const observations: Observation[] = [];
  const imports: ImportEdge[] = [];
  const network = new Set<string>();

  for (const path of ing.files) {
    const text = ing.texts.get(path)!;
    const lang = langOf(path);
    let role: Role;
    if (DEEP_LANGUAGES.has(lang)) {
      const facts = analyzeTsFile(path, text, aliases.prefixes);
      role = facts.role;
      observations.push(...facts.observations);
      imports.push(...facts.imports);
      if (facts.hasNetwork) network.add(path);
    } else {
      role = classifyRole(path, { lang, hasJsx: false, definesHook: false, hasNetwork: false, onlyTypes: false, isStore: false });
      imports.push(...shallowImports(path, text));
    }
    const h = history.get(path);
    files.push({ path, lang, role, lines: text.split('\n').length, lastTouched: h?.lastTouched, commits: h?.commits });
  }

  const fileSet = new Set(ing.files);
  for (const e of imports) e.to = resolveImport(e, fileSet, aliases.map);
  observations.push(...relationalObservations(files, imports, network));
  return { root: ing.root, files, observations, imports, dependencies, stack };
}
