import type { Layer, Role } from '../core/types.ts';

/**
 * The feature registry: one declarative entry per measurable style dimension.
 * The miner, the checker, the skill writer and the self-test all read from here,
 * so adding a dimension means adding one entry, not touching four modules.
 */

export type FeatureKind = 'categorical' | 'oneOf' | 'max' | 'order';

/** A deliberate violation used to prove a checker works. */
export interface Plant {
  /** Code appended to a conforming file. */
  append?: string;
  /** Or: a new file (relative to the sample file's folder) with this content. */
  file?: { name: string; content: string; atRoot?: boolean };
}

export interface FeatureDef {
  id: string;
  layer: Layer;
  kind: FeatureKind;
  subject: string;
  /** Title / instruction templates; "{v}" becomes the readable value. */
  title: string;
  say: string;
  labels?: Record<string, string>;
  minTotal?: number;
  plant?: (expected: any) => Plant | undefined;
}

const newFile = (name: string, content: string): Plant => ({ file: { name, content } });

const IMPORT_SAMPLES: Record<string, string> = {
  builtin: "import { join } from 'node:path';",
  package: "import { useState } from 'react';",
  alias: "import { arsAlias } from '@/ars/alias';",
  relative: "import { arsLocal } from './ars-local';",
  style: "import './ars.css';",
};

const comp = (body: string, sig = '') => `\nexport function ArsPlanted(${sig}) {\n${body}\n  return <div />;\n}\n`;

const ANATOMY_SNIPPETS: Record<string, string> = {
  state: '  const [arsCount, setArsCount] = useState(0);',
  ref: '  const arsRef = useRef(null);',
  context: '  const arsCtx = useContext(ArsContext);',
  'custom-hook': '  const arsData = useArsThing();',
  derived: '  const arsDerived = 1;',
  effect: '  useEffect(() => {}, []);',
  handler: '  const handleArs = () => {};',
  'early-return': '  if (!arsDerived) return null;',
};

const FEATURES: FeatureDef[] = [
  // ── L2 syntax idioms ────────────────────────────────────────────────
  {
    id: 'component.declaration', layer: 'L2', kind: 'categorical', subject: 'React components',
    title: 'Components are {v}', say: 'Declare React components as {v}.',
    labels: { function: 'function declarations (`function UserCard() {}`)', arrow: 'arrow functions (`const UserCard = () => {}`)' },
    plant: (v) => ({ append: v === 'function' ? '\nexport const ArsPlanted = () => <div />;\n' : comp('') }),
  },
  {
    id: 'export.style', layer: 'L2', kind: 'categorical', subject: 'components and hooks',
    title: 'Modules use {v}', say: 'Export components and hooks with {v}.',
    labels: { named: 'named exports (`export function X`)', default: 'default exports (`export default X`)' },
    plant: (v) =>
      v === 'named'
        ? { append: '\nexport default ArsPlanted;\nfunction ArsPlanted() {\n  return <div />;\n}\n' }
        : { file: { name: 'ArsPlanted.tsx', content: 'export function ArsPlanted() {\n  return <div />;\n}\n' } },
  },
  {
    id: 'component.propsTyping', layer: 'L2', kind: 'categorical', subject: 'component props',
    title: 'Props are typed with {v}', say: 'Type component props with {v}.',
    labels: {
      inline: 'an inline object type in the signature (`({ title }: { title: string })`)',
      interface: 'a separate `interface` declared above the component',
      'type-alias': 'a separate `type` alias declared above the component',
      'React.FC': '`React.FC<Props>` on the component variable',
      'imported-type': 'a props type imported from a types module',
      untyped: 'no explicit type annotation',
      other: 'other type expressions',
    },
    plant: (v) =>
      v === 'inline'
        ? { append: '\ninterface ArsPlantedProps {\n  a: string;\n}\nexport function ArsPlanted({ a }: ArsPlantedProps) {\n  return <div>{a}</div>;\n}\n' }
        : { append: '\nexport function ArsPlanted({ a }: { a: string }) {\n  return <div>{a}</div>;\n}\n' },
  },
  {
    id: 'component.propsDestructured', layer: 'L2', kind: 'categorical', subject: 'component props',
    title: 'Props are {v}', say: 'Receive props {v}.',
    labels: { signature: 'destructured in the parameter list', 'props-object': 'as a single `props` object (`props.title`)' },
    plant: (v) =>
      v === 'signature'
        ? { append: '\nexport function ArsPlanted(props: { a: string }) {\n  return <div>{props.a}</div>;\n}\n' }
        : { append: '\nexport function ArsPlanted({ a }: { a: string }) {\n  return <div>{a}</div>;\n}\n' },
  },
  {
    id: 'jsx.conditional', layer: 'L2', kind: 'categorical', subject: 'conditional rendering',
    title: 'Conditional UI uses {v}', say: 'Render optional UI with {v}.',
    labels: { 'logical-and': '`condition && <Element />`', 'ternary-null': '`condition ? <Element /> : null`' },
    plant: (v) => ({
      append: `\nexport function ArsPlanted({ a }: { a: boolean }) {\n  return <div>{${v === 'logical-and' ? 'a ? <span /> : null' : 'a && <span />'}}</div>;\n}\n`,
    }),
  },
  {
    id: 'helper.declaration', layer: 'L2', kind: 'categorical', subject: 'helper functions',
    title: 'Helpers are {v}', say: 'Write non-component helper functions as {v}.',
    labels: { function: 'function declarations (`function formatDate() {}`)', arrow: 'arrow functions (`const formatDate = () => {}`)' },
    plant: (v) => ({ append: v === 'function' ? '\nexport const arsPlanted = (x: number) => x * 2;\n' : '\nexport function arsPlanted(x: number) {\n  return x * 2;\n}\n' }),
  },
  {
    id: 'hook.declaration', layer: 'L2', kind: 'categorical', subject: 'custom hooks',
    title: 'Hooks are {v}', say: 'Declare custom hooks as {v}.',
    labels: { function: 'function declarations (`function useThing() {}`)', arrow: 'arrow functions (`const useThing = () => {}`)' },
    plant: (v) => ({ append: v === 'function' ? '\nexport const useArsPlanted = () => {\n  return { a: 1 };\n};\n' : '\nexport function useArsPlanted() {\n  return { a: 1 };\n}\n' }),
  },
  {
    id: 'hook.returnShape', layer: 'L2', kind: 'categorical', subject: 'custom hooks',
    title: 'Hooks return {v}', say: 'Custom hooks return {v}.',
    labels: { object: 'an object (`return { data, isLoading }`)', tuple: 'a tuple (`return [value, setValue]`)', value: 'a single value' },
  },
  {
    id: 'types.objectShape', layer: 'L2', kind: 'categorical', subject: 'object types',
    title: 'Object shapes use {v}', say: 'Declare object shapes with {v}.',
    labels: { interface: '`interface`', type: '`type` aliases' },
    plant: (v) => ({ append: v === 'interface' ? '\nexport type ArsPlanted = { a: string };\n' : '\nexport interface ArsPlanted {\n  a: string;\n}\n' }),
  },
  {
    id: 'types.enumeration', layer: 'L2', kind: 'categorical', subject: 'enumerations',
    title: 'Enumerations use {v}', say: 'Model fixed sets of values with {v}.',
    labels: { enum: '`enum`', 'string-union': "string-literal unions (`type Status = 'idle' | 'done'`)" },
    plant: (v) => ({ append: v === 'string-union' ? "\nexport enum ArsPlanted {\n  A = 'a',\n}\n" : "\nexport type ArsPlanted = 'a' | 'b';\n" }),
  },
  {
    id: 'async.style', layer: 'L2', kind: 'categorical', subject: 'asynchronous code',
    title: 'Async code uses {v}', say: 'Write asynchronous code with {v}.',
    labels: { 'async-await': '`async`/`await`', 'promise-then': '`.then()` chains' },
    plant: (v) => newFile('arsPlanted.ts', v === 'async-await' ? "export function arsLoad() {\n  return fetch('/ars').then((r) => r.json());\n}\n" : "export async function arsLoad() {\n  const r = await fetch('/ars');\n  return r.json();\n}\n"),
  },
  {
    id: 'import.groupOrder', layer: 'L2', kind: 'order', subject: 'imports',
    title: 'Import order: {v}', say: 'Order import groups as: {v}.',
    labels: { builtin: 'Node built-ins', package: 'packages', alias: 'aliased (`@/…`)', relative: 'relative (`./`, `../`)', style: 'stylesheets' },
    plant: (order: string[]) => (order.length < 2 ? undefined : newFile('arsPlanted.ts', `${[...order].reverse().map((k) => IMPORT_SAMPLES[k] ?? '').join('\n')}\nexport const arsPlanted = 1;\n`)),
  },
  {
    id: 'import.groupSpacing', layer: 'L2', kind: 'categorical', subject: 'imports',
    title: 'Import groups: {v}', say: 'Imports: {v}.',
    labels: { 'blank-line-between-groups': 'separate groups with a blank line', 'no-blank-lines': 'keep all imports in one block, no blank lines' },
    plant: (v) => newFile('arsPlanted.ts', v === 'no-blank-lines' ? "import { a } from 'ars-pkg';\n\nimport { b } from './ars-local';\nexport const c = [a, b];\n" : "import { a } from 'ars-pkg';\nimport { b } from './ars-local';\nexport const c = [a, b];\n"),
  },
  {
    id: 'import.crossFolder', layer: 'L2', kind: 'categorical', subject: 'imports',
    title: 'Cross-folder imports use {v}', say: 'When importing from another folder, use {v}.',
    labels: { 'path-alias': 'the path alias (`@/components/…`)', 'relative-parent': 'relative paths (`../../components/…`)' },
    plant: (v) => ({ append: v === 'path-alias' ? "\nimport { arsPlanted } from '../../ars/planted';\n" : "\nimport { arsPlanted } from '@/ars/planted';\n" }),
  },

  // ── L3 naming ───────────────────────────────────────────────────────
  {
    id: 'naming.handler', layer: 'L3', kind: 'categorical', subject: 'event handlers',
    title: 'Handlers are named {v}', say: 'Name event handlers defined in components {v}.',
    labels: { handleX: '`handleX` (e.g. `handleSubmit`)', onX: '`onX` (e.g. `onSubmit`)' },
    plant: (v) => {
      const name = v === 'handleX' ? 'onArsClick' : 'handleArsClick';
      return { append: `\nexport function ArsPlanted() {\n  const ${name} = () => {};\n  return <button onClick={${name}} />;\n}\n` };
    },
  },
  {
    id: 'naming.booleanState', layer: 'L3', kind: 'categorical', subject: 'boolean state',
    title: 'Boolean state is named {v}', say: 'Name boolean state {v}.',
    labels: { 'is/has-prefix': 'with an `is`/`has` prefix (`isOpen`)', plain: 'without a prefix (`open`, `loading`)' },
    plant: (v) => ({
      append: `\nexport function ArsPlanted() {\n  const [${v === 'plain' ? 'isArsOpen, setIsArsOpen' : 'arsOpen, setArsOpen'}] = useState(false);\n  return <div />;\n}\n`,
    }),
  },
  {
    id: 'naming.componentFile', layer: 'L3', kind: 'categorical', subject: 'component files',
    title: 'Component files are {v}', say: 'Name component files in {v}.',
    labels: { PascalCase: 'PascalCase (`UserCard.tsx`)', 'kebab-case': 'kebab-case (`user-card.tsx`)', camelCase: 'camelCase (`userCard.tsx`)', snake_case: 'snake_case (`user_card.tsx`)' },
    plant: (v) => ({
      file: { name: v === 'PascalCase' ? 'ars-planted.tsx' : 'ArsPlanted.tsx', content: 'export function ArsPlanted() {\n  return <div />;\n}\n' },
    }),
  },
  {
    id: 'naming.folder', layer: 'L3', kind: 'categorical', subject: 'component folders',
    title: 'Component folders are {v}', say: 'Name folders that hold components in {v}.',
    labels: { PascalCase: 'PascalCase (`UserCard/`)', 'kebab-case': 'kebab-case (`user-card/`)', camelCase: 'camelCase (`userCard/`)', snake_case: 'snake_case' },
  },
  {
    id: 'naming.hookFile', layer: 'L3', kind: 'categorical', subject: 'hook files',
    title: 'Hook files are {v}', say: 'Name hook files {v}.',
    labels: { useCamelCase: '`useThing.ts`', 'use-kebab-case': '`use-thing.ts`' },
    plant: (v) => newFile(v === 'useCamelCase' ? 'use-ars-planted.ts' : 'useArsPlanted.ts', 'export function useArsPlanted() {\n  return { a: 1 };\n}\n'),
  },
  {
    id: 'naming.propsType', layer: 'L3', kind: 'categorical', subject: 'props types',
    title: 'Props types are named {v}', say: 'Name props types {v}.',
    labels: { ComponentNameProps: '`<ComponentName>Props` (`UserCardProps`)', Props: 'plain `Props`', other: 'freely' },
    plant: (v) => ({ append: v === 'ComponentNameProps' ? '\ninterface Props {\n  a: string;\n}\nexport function ArsPlanted({ a }: Props) {\n  return <div>{a}</div>;\n}\n' : '\ninterface ArsPlantedProps {\n  a: string;\n}\nexport function ArsPlanted({ a }: ArsPlantedProps) {\n  return <div>{a}</div>;\n}\n' }),
  },
  {
    id: 'naming.constants', layer: 'L3', kind: 'categorical', subject: 'module constants',
    title: 'Constants are {v}', say: 'Name module-level literal constants in {v}.',
    labels: { UPPER_CASE: 'UPPER_CASE (`MAX_ITEMS`)', camelCase: 'camelCase (`maxItems`)' },
    plant: (v) => ({ append: v === 'UPPER_CASE' ? '\nexport const arsPlantedLimit = 10;\n' : '\nexport const ARS_PLANTED_LIMIT = 10;\n' }),
  },
  {
    id: 'tests.naming', layer: 'L3', kind: 'categorical', subject: 'test files',
    title: 'Test files use {v}', say: 'Name test files with {v}.',
    labels: { '.test': '`.test.ts(x)`', '.spec': '`.spec.ts(x)`' },
  },

  // ── L4 component anatomy ────────────────────────────────────────────
  {
    id: 'component.anatomy', layer: 'L4', kind: 'order', subject: 'component bodies',
    title: 'Component body order: {v}', say: 'Inside a component, order the code as: {v}.',
    labels: {
      state: 'state', ref: 'refs', context: 'context', 'custom-hook': 'custom hooks', derived: 'derived values',
      effect: 'effects', handler: 'handlers', 'early-return': 'early returns', render: 'JSX return',
    },
    plant: (order: string[]) => {
      const steps = order.filter((s) => ANATOMY_SNIPPETS[s]).reverse();
      if (steps.length < 2) return undefined;
      return { append: `\nexport function ArsPlanted() {\n${steps.map((s) => ANATOMY_SNIPPETS[s]).join('\n')}\n  return <div />;\n}\n` };
    },
  },
  {
    id: 'component.size', layer: 'L4', kind: 'max', subject: 'components', minTotal: 5,
    title: 'Components stay under {v} lines', say: 'Keep components under ~{v} lines; split bigger ones into child components or hooks.',
    plant: (max: number) => ({ append: comp(Array.from({ length: max + 20 }, (_, i) => `  const arsLine${i} = ${i};`).join('\n')) }),
  },
  {
    id: 'component.logicLocation', layer: 'L4', kind: 'categorical', subject: 'component logic',
    title: 'Logic lives {v}', say: 'Put stateful logic and side effects {v}.',
    labels: { 'custom-hooks': 'in custom hooks (`useX`), keeping components thin', 'effects-inline': 'inline in the component with `useEffect`' },
    plant: (v) => ({ append: v === 'custom-hooks' ? comp('  useEffect(() => {}, []);') : comp('  const arsData = useArsThing();') }),
  },

  // ── L5 architecture & decisions ─────────────────────────────────────
  {
    id: 'component.dataAccess', layer: 'L5', kind: 'categorical', subject: 'data access',
    title: 'Components get data {v}', say: 'Components get server data {v}.',
    labels: {
      'via-hook': 'through custom data hooks', 'direct-api-import': 'by calling functions from the API layer',
      'inline-request': 'with requests written inside the component', 'via-store': 'through the store',
    },
    plant: (v) => (v === 'inline-request' ? undefined : newFile('ArsPlanted.tsx', "export function ArsPlanted() {\n  fetch('/ars');\n  return <div />;\n}\n")),
  },
  {
    id: 'network.location', layer: 'L5', kind: 'categorical', subject: 'network requests',
    title: 'Requests are made in {v}', say: 'Make network requests only in {v}.',
    labels: { api: 'the API/services layer', hook: 'hooks', component: 'components', store: 'the store', route: 'route components', util: 'utilities', module: 'plain modules' },
    plant: (v) => (v === 'component' ? newFile('useArsPlanted.ts', "export function useArsPlanted() {\n  return fetch('/ars');\n}\n") : newFile('ArsPlanted.tsx', "export function ArsPlanted() {\n  fetch('/ars');\n  return <div />;\n}\n")),
  },
  {
    id: 'architecture.featureImports', layer: 'L5', kind: 'categorical', subject: 'feature modules',
    title: 'Cross-feature imports go {v}', say: 'When one feature uses another, import {v}.',
    labels: { 'public-entry': "through the feature's `index` entry", 'deep-import': 'directly from internal files' },
  },
  {
    id: 'component.fileLayout', layer: 'L5', kind: 'categorical', subject: 'component files',
    title: 'Components are laid out as {v}', say: 'Lay out each component as {v}.',
    labels: {
      'Folder/index': 'a folder with an `index.tsx`', 'Folder/Folder': 'a folder named after it (`UserCard/UserCard.tsx`)',
      'flat-file': 'a single file directly in its folder (`components/UserCard.tsx`)',
    },
    plant: (v) => (v === 'Folder/index' ? newFile('ArsPlanted.tsx', 'export function ArsPlanted() {\n  return <div />;\n}\n') : newFile('ArsPlanted/index.tsx', 'export function ArsPlanted() {\n  return <div />;\n}\n')),
  },
  {
    id: 'tests.location', layer: 'L5', kind: 'categorical', subject: 'tests',
    title: 'Tests live {v}', say: 'Put tests {v}.',
    labels: { sibling: 'next to the file they test', __tests__: 'in a `__tests__` folder beside the code', 'separate-folder': 'in a separate test folder' },
  },

  // ── L6 problem-solving voice (deterministic part) ───────────────────
  {
    id: 'comments.density', layer: 'L6', kind: 'categorical', subject: 'comments',
    title: 'Comments are {v}', say: 'Comment {v}.',
    labels: { sparse: 'sparse (the code speaks for itself)', moderate: 'moderate (explain non-obvious logic)', heavy: 'generous (explain intent throughout)' },
  },
  {
    id: 'comments.style', layer: 'L6', kind: 'categorical', subject: 'comments',
    title: 'Comments are written as {v}', say: 'Write comments as {v}.',
    labels: { 'line-comments': '`//` line comments', 'jsdoc-blocks': '`/** */` JSDoc blocks' },
    plant: (v) => newFile('arsPlanted.ts', `${(v === 'line-comments' ? '/** ARS planted doc block. */' : '// ARS planted line comment')}\n${Array.from({ length: 24 }, (_, i) => `export const arsLine${i} = ${i};`).join('\n')}\n`),
  },
  {
    id: 'errors.style', layer: 'L6', kind: 'categorical', subject: 'error handling',
    title: 'Errors are handled with {v}', say: 'Handle errors with {v}.',
    labels: { 'try-catch': '`try/catch` around awaited calls', 'promise-catch': '`.catch()` on promises' },
    plant: (v) => newFile('arsPlanted.ts', v === 'try-catch' ? "export function arsLoad() {\n  return fetch('/ars').catch(() => null);\n}\n" : "export async function arsLoad() {\n  try {\n    return await fetch('/ars');\n  } catch {\n    return null;\n  }\n}\n"),
  },
];

const PLACED: Record<string, [Role, string]> = {
  component: ['component', 'components'], hook: ['hook', 'hooks'], api: ['api', 'API modules'], store: ['store', 'stores'],
  type: ['type', 'shared types'], util: ['util', 'utilities'], route: ['route', 'pages / routes'],
};

const misplaced = (name: string, content: string): Plant => ({ file: { name: `ars-misplaced/${name}`, atRoot: true, content } });

const PLACEMENT_PLANT: Partial<Record<Role, Plant>> = {
  type: misplaced('types.ts', 'export interface ArsPlanted {\n  a: string;\n}\n'),
  util: misplaced('utils/arsPlanted.ts', 'export function arsPlanted() {\n  return 1;\n}\n'),
  route: misplaced('pages/ArsPage.tsx', 'export function ArsPage() {\n  return <div />;\n}\n'),
  store: misplaced('store/arsStore.ts', 'export const arsStore = 1;\n'),
  component: { file: { name: 'ars-misplaced/ArsPlanted.tsx', atRoot: true, content: 'export function ArsPlanted() {\n  return <div />;\n}\n' } },
  hook: { file: { name: 'ars-misplaced/useArsPlanted.ts', atRoot: true, content: 'export function useArsPlanted() {\n  return { a: 1 };\n}\n' } },
  api: { file: { name: 'ars-misplaced/arsPlanted.ts', atRoot: true, content: "export async function getArs() {\n  return fetch('/ars');\n}\n" } },
};

for (const [key, [role, plural]] of Object.entries(PLACED)) {
  FEATURES.push({
    id: `placement.${key}`, layer: 'L5', kind: 'oneOf', subject: plural,
    title: `${plural[0].toUpperCase()}${plural.slice(1)} live in {v}`, say: `Put new ${plural} in {v}.`,
    plant: PLACEMENT_PLANT[role] ? () => PLACEMENT_PLANT[role] : undefined,
  });
}

export const FEATURE_MAP = new Map(FEATURES.map((f) => [f.id, f]));

export function labelOf(def: FeatureDef, value: unknown): string {
  if (Array.isArray(value)) {
    return def.kind === 'order'
      ? value.map((v) => def.labels?.[v] ?? v).join(' → ')
      : value.map((v) => `\`${v}/\``).join(' or ');
  }
  return def.labels?.[String(value)] ?? String(value);
}

export const fill = (template: string, def: FeatureDef, value: unknown) => template.replace('{v}', labelOf(def, value));
