/**
 * Generic baseline: a reasonable, widely-shared React + TypeScript guide with no personal style.
 * It is trimmed to the ARS package's word count so "more instructions" is not what we measure.
 */
const GUIDE = [
  ['Components', [
    'Write function components with clear, descriptive names.',
    'Keep components small and focused on one responsibility; split large components into smaller ones.',
    'Type props explicitly with TypeScript.',
    'Prefer composition over inheritance and avoid deeply nested prop drilling.',
    'Derive values during render instead of storing redundant state.',
  ]],
  ['Hooks & state', [
    'Follow the Rules of Hooks: call hooks at the top level, never conditionally.',
    'Extract reusable stateful logic into custom hooks whose names start with "use".',
    'Keep state as local as possible and lift it only when siblings need it.',
    'Always declare effect dependencies correctly and clean up subscriptions.',
  ]],
  ['Data fetching', [
    'Separate data access from presentation; keep network code out of presentational components.',
    'Handle loading, error and empty states explicitly.',
    'Validate or type API responses at the boundary.',
  ]],
  ['TypeScript', [
    'Enable strict mode and avoid `any`; use `unknown` when a type is genuinely unknown.',
    'Model finite states with union types.',
    'Export shared types from a central place when several modules use them.',
  ]],
  ['Project structure', [
    'Group files by feature or by type consistently across the project.',
    'Use clear, consistent file naming and keep one component per file.',
    'Co-locate tests, styles and helpers with the code they belong to when practical.',
  ]],
  ['Quality', [
    'Write accessible markup: label form controls, use semantic elements and buttons for actions.',
    'Prefer readable code over clever code; add comments only for non-obvious intent.',
    'Write tests for important behaviour using Testing Library, querying by role and label.',
    'Format code consistently with a formatter.',
  ]],
] as const;

export function genericSkill(targetWords: number): string {
  const header = '---\nname: react-typescript-guide\ndescription: Use when writing or editing React + TypeScript code: general best practices for components, hooks, data fetching, typing and structure.\n---\n\n# React + TypeScript best practices\n';
  let out = header;
  let words = header.split(/\s+/).length;
  for (const [section, items] of GUIDE) {
    out += `\n## ${section}\n\n`;
    for (const item of items) {
      if (words >= targetWords) return out;
      out += `- ${item}\n`;
      words += item.split(/\s+/).length;
    }
  }
  return out;
}
