import { z } from 'zod/v4';
import type { Convention } from '../core/types.ts';
import { redact } from '../ingest/secrets.ts';
import { askJson } from '../llm/claude.ts';

/** LLM judgments used by the benchmark and improvement loop. Inputs are always redacted. */

export interface CodeFile {
  path: string;
  text: string;
}

const fileBlock = (f: CodeFile, label = f.path) => `<file name="${label}">\n${redact(f.text)}\n</file>`;

/** Behavioural description of a held-out file (what it does, never how it is styled). */
export async function describeForReconstruction(file: CodeFile): Promise<string> {
  const r = await askJson(
    z.object({ description: z.string() }),
    'You write implementation briefs. Describe WHAT a source file does so another engineer can re-implement it: its purpose, exported names and their parameters/props, rendered UI, data it reads or writes, and which existing project modules it relies on. Never describe code style, formatting, internal variable names, declaration style or structure.',
    fileBlock(file),
    { effort: 'low' },
  );
  return r.description;
}

/** Score judgment-type rules against generated files. */
export async function judgeRules(rules: Convention[], files: CodeFile[]): Promise<Record<string, boolean>> {
  if (!rules.length || !files.length) return {};
  const r = await askJson(
    z.object({ results: z.array(z.object({ id: z.string(), followed: z.boolean(), reason: z.string() })) }),
    'You are a strict code reviewer. For each rule, decide whether the code follows it. If the code gives no opportunity to apply a rule, mark it followed.',
    `Rules:\n${rules.map((c) => `- [${c.id}] ${c.instruction}`).join('\n')}\n\n${files.map((f) => fileBlock(f)).join('\n\n')}`,
    { effort: 'low' },
  );
  return Object.fromEntries(r.results.filter((x) => rules.some((c) => c.id === x.id)).map((x) => [x.id, x.followed]));
}

/** T3 blind judge: given reference files by the developer, which of A/B was NOT written by them? */
export async function spotGenerated(references: CodeFile[], a: CodeFile, b: CodeFile): Promise<'A' | 'B'> {
  const r = await askJson(
    z.object({ notByDeveloper: z.enum(['A', 'B']), reason: z.string() }),
    'You are a forensic code stylist. Study the reference files written by one developer. Exactly one of file A and file B was written by someone else imitating them. Identify it from style alone: formatting, naming, idioms, structure and voice.',
    `${references.map((f, i) => fileBlock(f, `reference-${i + 1}`)).join('\n\n')}\n\n${fileBlock(a, 'A')}\n\n${fileBlock(b, 'B')}`,
    { effort: 'medium' },
  );
  return r.notByDeveloper;
}

/** Improvement loop: rewrite an instruction that agents misunderstood. */
export async function rewriteInstruction(c: Convention, violations: string[], evidence: string[]): Promise<string> {
  const r = await askJson(
    z.object({ instruction: z.string() }),
    'You improve coding-agent instructions. Rewrite the instruction so an agent cannot misread it: state the rule precisely, give a one-line correct example and a one-line incorrect example. Keep it under 80 words. Do not change what the rule means.',
    `Current instruction: ${c.instruction}\n\nWhere agents violated it:\n${redact(violations.join('\n'))}\n\nCorrect examples from the developer's code:\n${redact(evidence.join('\n'))}`,
    { effort: 'low' },
  );
  return r.instruction;
}
