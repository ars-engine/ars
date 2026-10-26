import { basename, dirname, extname } from 'node:path';
import {
  Node, Project, SyntaxKind, ts,
  type ArrowFunction, type FunctionDeclaration, type FunctionExpression, type SourceFile, type Statement,
} from 'ts-morph';
import type { ImportEdge, Observation, Role, Value } from '../core/types.ts';
import { caseOf } from '../core/util.ts';
import { classifyRole } from './roles.ts';

/**
 * Deep analyzer for TypeScript / JavaScript / React.
 * Produces per-file roles, import edges and style observations (one per construct).
 */

type Fn = FunctionDeclaration | ArrowFunction | FunctionExpression;

interface TopFunction {
  name: string;
  fn: Fn;
  style: 'function' | 'arrow';
  line: number;
  declaredType?: string;
}

export interface FileFacts {
  role: Role;
  observations: Observation[];
  imports: ImportEdge[];
  hasNetwork: boolean;
}

const JSX_KINDS = new Set([SyntaxKind.JsxElement, SyntaxKind.JsxSelfClosingElement, SyntaxKind.JsxFragment]);
const BUILTIN_HOOKS = new Set([
  'useState', 'useEffect', 'useLayoutEffect', 'useRef', 'useMemo', 'useCallback', 'useContext', 'useReducer',
  'useId', 'useTransition', 'useDeferredValue', 'useImperativeHandle', 'useSyncExternalStore', 'useInsertionEffect',
]);
const NODE_BUILTINS = /^(node:|fs$|path$|url$|os$|crypto$|child_process$|http$|https$|stream$|util$|events$)/;
const NETWORK_CALL = /^(fetch|axios(\.\w+)?|ky(\.\w+)?|(api|http|client|apiClient|axiosInstance|instance|request)\.(get|post|put|patch|delete|request))$/;

const isPascal = (n: string) => /^[A-Z][A-Za-z0-9]*$/.test(n);
const isHookName = (n: string) => /^use[A-Z0-9]/.test(n);
const hasJsx = (node: Node) => !!node.getFirstDescendant((d) => JSX_KINDS.has(d.getKind()));
const isJsxLike = (node: Node | undefined): boolean => {
  if (!node) return false;
  if (Node.isParenthesizedExpression(node)) return isJsxLike(node.getExpression());
  return JSX_KINDS.has(node.getKind());
};
const calleeName = (node: Node | undefined) =>
  node && Node.isCallExpression(node) ? node.getExpression().getText() : undefined;

const project = new Project({
  useInMemoryFileSystem: true,
  compilerOptions: { jsx: ts.JsxEmit.Preserve, allowJs: true, target: ts.ScriptTarget.ES2022 },
});

/** Collect top-level functions, including `const X = memo(() => …)` wrappers. */
function topFunctions(sf: SourceFile): TopFunction[] {
  const out: TopFunction[] = [];
  for (const fn of sf.getFunctions()) {
    const name = fn.getName() ?? basename(sf.getFilePath(), extname(sf.getFilePath()));
    out.push({ name, fn, style: 'function', line: fn.getStartLineNumber() });
  }
  for (const decl of sf.getVariableDeclarations()) {
    let init = decl.getInitializer();
    if (init && Node.isCallExpression(init) && /^(React\.)?(memo|forwardRef)$/.test(init.getExpression().getText())) {
      init = init.getArguments()[0] as typeof init;
    }
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
      out.push({
        name: decl.getName(), fn: init, style: 'arrow', line: decl.getStartLineNumber(),
        declaredType: decl.getTypeNode()?.getText(),
      });
    }
  }
  return out;
}

function bodyStatements(fn: Fn): Statement[] {
  const body = fn.getBody();
  return body && Node.isBlock(body) ? body.getStatements() : [];
}

/** Classify one statement inside a component body for the anatomy sequence. */
function anatomyCategory(stmt: Statement): string | undefined {
  if (Node.isReturnStatement(stmt)) return 'render';
  if (Node.isIfStatement(stmt) && stmt.getFirstDescendantByKind(SyntaxKind.ReturnStatement)) return 'early-return';
  if (Node.isFunctionDeclaration(stmt)) return 'handler';
  if (Node.isExpressionStatement(stmt)) {
    const name = calleeName(stmt.getExpression());
    return name && /^(React\.)?use(Layout)?Effect$/.test(name) ? 'effect' : undefined;
  }
  if (Node.isVariableStatement(stmt)) {
    const init = stmt.getDeclarations()[0]?.getInitializer();
    if (!init) return 'derived';
    if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) return 'handler';
    const name = calleeName(init)?.replace(/^React\./, '');
    if (!name) return 'derived';
    if (name === 'useState' || name === 'useReducer') return 'state';
    if (name === 'useRef') return 'ref';
    if (name === 'useCallback') return 'handler';
    if (name === 'useMemo') return 'derived';
    if (name === 'useContext' || /^use\w*Context$/.test(name)) return 'context';
    if (isHookName(name)) return 'custom-hook';
    return 'derived';
  }
  return undefined;
}

const compress = (xs: string[]) => xs.filter((x, i) => x !== xs[i - 1]);

interface PropsInfo {
  typing: string;
  typeName?: string;
}

function propsInfo(sf: SourceFile, c: TopFunction): PropsInfo | undefined {
  if (c.declaredType && /\b(FC|FunctionComponent)\b/.test(c.declaredType)) {
    const m = c.declaredType.match(/<\s*([A-Za-z0-9_]+)\s*>/);
    return { typing: 'React.FC', typeName: m?.[1] };
  }
  const param = c.fn.getParameters()[0];
  if (!param) return undefined;
  const tn = param.getTypeNode();
  if (!tn) return { typing: 'untyped' };
  if (Node.isTypeLiteral(tn)) return { typing: 'inline' };
  if (Node.isTypeReference(tn)) {
    const name = tn.getTypeName().getText();
    if (sf.getInterface(name)) return { typing: 'interface', typeName: name };
    if (sf.getTypeAlias(name)) return { typing: 'type-alias', typeName: name };
    return { typing: 'imported-type', typeName: name };
  }
  return { typing: 'other' };
}

type Push = (feature: string, value: Value, line: number) => void;

function componentObservations(sf: SourceFile, c: TopFunction, push: Push): void {
  push('component.declaration', c.style, c.line);
  const props = propsInfo(sf, c);
  const param = c.fn.getParameters()[0];
  if (props) push('component.propsTyping', props.typing, c.line);
  if (param) push('component.propsDestructured', Node.isObjectBindingPattern(param.getNameNode()) ? 'signature' : 'props-object', c.line);
  if (props?.typeName) {
    const v = props.typeName === `${c.name}Props` ? 'ComponentNameProps' : props.typeName === 'Props' ? 'Props' : 'other';
    push('naming.propsType', v, c.line);
  }
  push('component.size', c.fn.getEndLineNumber() - c.fn.getStartLineNumber() + 1, c.line);

  const statements = bodyStatements(c.fn);
  const anatomy = compress(statements.map(anatomyCategory).filter((x): x is string => !!x));
  if (new Set(anatomy).size >= 2) push('component.anatomy', anatomy, c.line);

  let effects = 0;
  let customHooks = 0;
  for (const stmt of statements) {
    const expr = Node.isExpressionStatement(stmt) ? stmt.getExpression() : Node.isVariableStatement(stmt) ? stmt.getDeclarations()[0]?.getInitializer() : undefined;
    const name = calleeName(expr)?.replace(/^React\./, '');
    if (!name) continue;
    if (/^use(Layout)?Effect$/.test(name)) effects++;
    else if (isHookName(name) && !BUILTIN_HOOKS.has(name)) customHooks++;

    if (Node.isVariableStatement(stmt) && name === 'useState') {
      const decl = stmt.getDeclarations()[0];
      const nameNode = decl.getNameNode();
      const arg = (expr as any).getArguments?.()[0] as Node | undefined;
      if (Node.isArrayBindingPattern(nameNode) && arg && (arg.getKind() === SyntaxKind.TrueKeyword || arg.getKind() === SyntaxKind.FalseKeyword)) {
        const first = nameNode.getElements()[0]?.getText() ?? '';
        push('naming.booleanState', /^(is|has|should|can|show|did|was|are)[A-Z]/.test(first) ? 'is/has-prefix' : 'plain', stmt.getStartLineNumber());
      }
    }
  }
  if (effects || customHooks) push('component.logicLocation', effects ? 'effects-inline' : 'custom-hooks', c.line);

  for (const stmt of statements) {
    const names: [string, number][] = [];
    if (Node.isFunctionDeclaration(stmt) && stmt.getName()) names.push([stmt.getName()!, stmt.getStartLineNumber()]);
    if (Node.isVariableStatement(stmt)) {
      const decl = stmt.getDeclarations()[0];
      const init = decl?.getInitializer();
      const isFn = init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init) || calleeName(init)?.endsWith('useCallback'));
      if (isFn && Node.isIdentifier(decl.getNameNode())) names.push([decl.getName(), stmt.getStartLineNumber()]);
    }
    for (const [name, line] of names) {
      if (/^handle[A-Z]/.test(name)) push('naming.handler', 'handleX', line);
      else if (/^on[A-Z]/.test(name)) push('naming.handler', 'onX', line);
    }
  }

  let and = 0;
  let ternaryNull = 0;
  c.fn.forEachDescendant((d) => {
    if (Node.isBinaryExpression(d) && d.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken && isJsxLike(d.getRight())) and++;
    if (Node.isConditionalExpression(d)) {
      const t = d.getWhenTrue();
      const f = d.getWhenFalse();
      if ((isJsxLike(t) && f.getKind() === SyntaxKind.NullKeyword) || (isJsxLike(f) && t.getKind() === SyntaxKind.NullKeyword)) ternaryNull++;
    }
  });
  if (and || ternaryNull) push('jsx.conditional', and >= ternaryNull ? 'logical-and' : 'ternary-null', c.line);
}

function hookObservations(h: TopFunction, push: Push): void {
  push('hook.declaration', h.style, h.line);
  const ret = bodyStatements(h.fn).filter(Node.isReturnStatement).at(-1)?.getExpression();
  if (ret) {
    const shape = Node.isObjectLiteralExpression(ret) ? 'object' : Node.isArrayLiteralExpression(ret) ? 'tuple' : 'value';
    push('hook.returnShape', shape, h.line);
  }
}

function importObservations(sf: SourceFile, file: string, aliases: string[], push: Push): ImportEdge[] {
  const decls = sf.getImportDeclarations();
  const edges: ImportEdge[] = decls.map((d) => {
    const spec = d.getModuleSpecifierValue();
    return { from: file, spec, kind: importKind(spec, aliases), line: d.getStartLineNumber() };
  });
  const groups = compress(edges.map((e) => e.kind));
  if (new Set(groups).size >= 2) {
    push('import.groupOrder', groups, edges[0].line);
    let blank = 0;
    let tight = 0;
    for (let i = 1; i < decls.length; i++) {
      if (edges[i].kind === edges[i - 1].kind) continue;
      if (decls[i].getStartLineNumber() - decls[i - 1].getEndLineNumber() > 1) blank++;
      else tight++;
    }
    push('import.groupSpacing', blank > tight ? 'blank-line-between-groups' : 'no-blank-lines', edges[0].line);
  }
  for (const e of edges) {
    if (e.kind === 'alias' || (e.kind === 'relative' && e.spec.startsWith('../'))) {
      push('import.crossFolder', e.kind === 'alias' ? 'path-alias' : 'relative-parent', e.line);
    }
  }
  return edges;
}

export function importKind(spec: string, aliases: string[]): ImportEdge['kind'] {
  if (/\.(css|scss|sass|less)$/.test(spec)) return 'style';
  if (spec.startsWith('.')) return 'relative';
  if (aliases.some((a) => spec.startsWith(a))) return 'alias';
  if (NODE_BUILTINS.test(spec)) return 'builtin';
  return 'package';
}

function fileObservations(sf: SourceFile, text: string, file: string, role: Role, push: Push): void {
  const base = basename(file, extname(file));
  const parent = basename(dirname(file));

  if (role === 'component' || role === 'hook') {
    push('export.style', /^\s*export\s+default\s|as\s+default\b/m.test(text) ? 'default' : 'named', 1);
  }
  if (role === 'component') {
    const name = base === 'index' ? parent : base;
    const c = caseOf(name);
    if (c !== 'lower' && c !== 'mixed') push('naming.componentFile', c, 1);
    push('component.fileLayout', base === 'index' ? 'Folder/index' : base === parent ? 'Folder/Folder' : 'flat-file', 1);
    const pc = caseOf(parent);
    if (!['lower', 'mixed'].includes(pc)) push('naming.folder', pc, 1);
  }
  if (role === 'hook') {
    if (/^use[A-Z]/.test(base)) push('naming.hookFile', 'useCamelCase', 1);
    else if (/^use-/.test(base)) push('naming.hookFile', 'use-kebab-case', 1);
  }

  for (const i of sf.getInterfaces()) push('types.objectShape', 'interface', i.getStartLineNumber());
  for (const t of sf.getTypeAliases()) {
    const node = t.getTypeNode();
    if (node && Node.isTypeLiteral(node)) push('types.objectShape', 'type', t.getStartLineNumber());
    if (node && Node.isUnionTypeNode(node) && node.getTypeNodes().every((n) => Node.isLiteralTypeNode(n))) {
      push('types.enumeration', 'string-union', t.getStartLineNumber());
    }
  }
  for (const e of sf.getEnums()) push('types.enumeration', 'enum', e.getStartLineNumber());

  for (const stmt of sf.getVariableStatements()) {
    if (stmt.getDeclarationKind() !== 'const') continue;
    for (const d of stmt.getDeclarations()) {
      const init = d.getInitializer();
      if (!init || !Node.isIdentifier(d.getNameNode())) continue;
      if (Node.isStringLiteral(init) || Node.isNumericLiteral(init)) {
        const c = caseOf(d.getName());
        if (c === 'UPPER_CASE' || c === 'camelCase' || c === 'lower') {
          push('naming.constants', c === 'UPPER_CASE' ? 'UPPER_CASE' : 'camelCase', d.getStartLineNumber());
        }
      }
    }
  }

  let awaits = 0;
  let thens = 0;
  let tries = 0;
  let catches = 0;
  sf.forEachDescendant((d) => {
    if (Node.isAwaitExpression(d)) awaits++;
    else if (Node.isTryStatement(d)) tries++;
    else if (Node.isPropertyAccessExpression(d)) {
      const n = d.getName();
      if (n === 'then') thens++;
      if (n === 'catch') catches++;
    }
  });
  if (awaits || thens) push('async.style', awaits >= thens ? 'async-await' : 'promise-then', 1);
  if (tries || catches) push('errors.style', tries >= catches ? 'try-catch' : 'promise-catch', 1);

  const lines = text.split('\n');
  if (lines.length >= 20) {
    const commentLines = lines.filter((l) => /^\s*(\/\/|\/\*|\*)/.test(l)).length;
    const density = (commentLines / lines.length) * 100;
    push('comments.density', density < 3 ? 'sparse' : density < 10 ? 'moderate' : 'heavy', 1);
    const jsdoc = (text.match(/\/\*\*/g) ?? []).length;
    const line = (text.match(/^\s*\/\/ /gm) ?? []).length;
    if (jsdoc || line) push('comments.style', jsdoc > line ? 'jsdoc-blocks' : 'line-comments', 1);
  }
}

/** Analyze one TS/JS file. */
export function analyzeTsFile(file: string, text: string, aliases: string[]): FileFacts {
  const sf = project.createSourceFile(`/${file}`, text, { overwrite: true });
  try {
    const fns = topFunctions(sf);
    let hasNetwork = false;
    sf.forEachDescendant((d) => {
      if (!hasNetwork && Node.isCallExpression(d) && NETWORK_CALL.test(d.getExpression().getText())) hasNetwork = true;
    });
    const components = fns.filter((f) => isPascal(f.name) && hasJsx(f.fn));
    const hooks = fns.filter((f) => isHookName(f.name));
    const onlyTypes =
      sf.getStatements().length > 0 &&
      sf.getStatements().every((s) => Node.isInterfaceDeclaration(s) || Node.isTypeAliasDeclaration(s) || Node.isImportDeclaration(s) || Node.isExportDeclaration(s) || Node.isEnumDeclaration(s));
    const role = classifyRole(file, {
      lang: /\.tsx?$/.test(file) ? 'typescript' : 'javascript',
      hasJsx: components.length > 0 || hasJsx(sf),
      definesHook: hooks.length > 0,
      hasNetwork,
      onlyTypes,
      isStore: /\b(createSlice|configureStore|create\(|atom\(|createStore|defineStore)\b/.test(text) && /from ['"](zustand|@reduxjs\/toolkit|jotai|redux|pinia|valtio)/.test(text),
    });

    const observations: Observation[] = [];
    const push: Push = (feature, value, line) => observations.push({ feature, value, file, line, role });
    const imports = importObservations(sf, file, aliases, push);
    if (role !== 'test' && role !== 'story' && role !== 'config') {
      for (const c of components) componentObservations(sf, c, push);
      for (const h of hooks) hookObservations(h, push);
      for (const f of fns) {
        if (!components.includes(f) && !hooks.includes(f)) push('helper.declaration', f.style, f.line);
      }
      fileObservations(sf, text, file, role, push);
    }
    return { role, observations, imports, hasNetwork };
  } finally {
    project.removeSourceFile(sf);
  }
}

/** Read tsconfig `paths` to learn the project's import aliases ("@/", "~/" …). */
export function readAliases(texts: Map<string, string>): { prefixes: string[]; map: Record<string, string> } {
  const map: Record<string, string> = {};
  for (const [path, text] of texts) {
    if (!/(^|\/)(tsconfig|jsconfig)(\.[a-z]+)?\.json$/.test(path)) continue;
    const parsed = ts.parseConfigFileTextToJson(path, text).config;
    const paths: Record<string, string[]> = parsed?.compilerOptions?.paths ?? {};
    const baseUrl: string = parsed?.compilerOptions?.baseUrl ?? '.';
    const dir = dirname(path) === '.' ? '' : `${dirname(path)}/`;
    for (const [key, targets] of Object.entries(paths)) {
      const prefix = key.replace(/\*$/, '');
      const target = (targets[0] ?? '').replace(/\*$/, '').replace(/^\.\//, '');
      const base = baseUrl === '.' || baseUrl === './' ? '' : `${baseUrl.replace(/^\.\//, '').replace(/\/$/, '')}/`;
      map[prefix] = `${dir}${base}${target}`;
    }
  }
  if (!Object.keys(map).length) {
    map['@/'] = 'src/';
    map['~/'] = 'src/';
  }
  return { prefixes: Object.keys(map), map };
}

const RESOLVE_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

/** Resolve an import specifier to a file in the repo, if it points to one. */
export function resolveImport(edge: ImportEdge, fileSet: Set<string>, aliasMap: Record<string, string>): string | undefined {
  let base: string | undefined;
  if (edge.kind === 'relative') {
    const parts = `${dirname(edge.from)}/${edge.spec}`.split('/');
    const stack: string[] = [];
    for (const p of parts) {
      if (p === '..') stack.pop();
      else if (p && p !== '.') stack.push(p);
    }
    base = stack.join('/');
  } else if (edge.kind === 'alias') {
    const prefix = Object.keys(aliasMap).find((a) => edge.spec.startsWith(a))!;
    base = `${aliasMap[prefix]}${edge.spec.slice(prefix.length)}`.replace(/\/+/g, '/').replace(/^\//, '');
  }
  if (base === undefined) return undefined;
  return RESOLVE_EXT.map((ext) => base + ext).find((p) => fileSet.has(p));
}

/** Sequence of syntax-node kinds; used for structural (AST) similarity in the reconstruction test. */
export function syntaxShape(file: string, text: string): string[] {
  const sf = project.createSourceFile(`/__shape__/${file}`, text, { overwrite: true });
  const kinds: string[] = [];
  sf.forEachDescendant((n) => {
    kinds.push(n.getKindName());
  });
  project.removeSourceFile(sf);
  return kinds;
}
