import { z } from 'zod/v4';
import type { Analysis, Convention, Layer, Role } from '../core/types.ts';
import { slug } from '../core/util.ts';
import { redact } from '../ingest/secrets.ts';
import { askJson } from '../llm/claude.ts';
import { buildConvention } from './miner.ts';

/**
 * LLM deep-read: reads whole representative files and proposes L5/L6 conventions plus a
 * style dossier. Proposals must be structured rules; regex rules get their support counted
 * by code, never by the model.
 */

const ROLES = ['component', 'hook', 'api', 'store', 'route', 'util', 'type'] as const;

const Proposal = z.object({
  dossier: z.string().describe('Markdown, 200-400 words: how this developer writes code, quoting tiny snippets.'),
  conventions: z.array(
    z.object({
      layer: z.enum(['L4', 'L5', 'L6']),
      title: z.string(),
      instruction: z.string().describe('Imperative instruction an agent can follow.'),
      kind: z.enum(['pattern', 'judgment']),
      role: z.enum(ROLES).nullable(),
      regex: z.string().nullable().describe('For kind=pattern: a JavaScript regex tested against whole file text.'),
      expect: z.enum(['present', 'absent']).nullable(),
      exampleFiles: z.array(z.string()),
      sample: z.string().describe('A short (5-15 line) code sample in a NEUTRAL domain (todos/notes) written in this style.'),
    }),
  ),
});

const SYSTEM = `You are a senior engineer studying one developer's codebase to capture their personal coding signature.
Deterministic tools already measured formatting, syntax idioms and naming; you focus on what they cannot see:
architecture decisions, how features are decomposed, error/loading handling, abstraction appetite, testing habits,
comment voice and problem-solving patterns. Every convention must be grounded in the files shown. Prefer conventions
that make this developer DIFFERENT from generic React best practice. Return at most 12 conventions.`;

function pickFiles(analysis: Analysis, texts: Map<string, string>, heldOut: Set<string>): [string, string][] {
  const quota: Partial<Record<Role, number>> = { component: 3, route: 1, hook: 2, api: 1, store: 1, util: 1, type: 1 };
  const picked: [string, string][] = [];
  for (const [role, n] of Object.entries(quota)) {
    const files = analysis.files
      .filter((f) => f.role === role && !heldOut.has(f.path) && f.lines >= 15 && f.lines <= 260)
      .sort((a, b) => (b.commits ?? 0) - (a.commits ?? 0))
      .slice(0, n);
    for (const f of files) picked.push([f.path, redact(texts.get(f.path) ?? '')]);
  }
  return picked;
}

export interface DeepReadResult {
  dossier: string;
  conventions: Convention[];
  voiceSamples: Record<string, string>;
}

export async function deepRead(
  analysis: Analysis, texts: Map<string, string>, mined: Convention[], heldOut: Set<string>,
): Promise<DeepReadResult> {
  const files = pickFiles(analysis, texts, heldOut);
  const known = mined.map((c) => `- ${c.title}`).join('\n');
  const prompt = [
    `Stack: ${analysis.stack.frameworks.join(', ') || 'unknown'}. Files: ${analysis.files.length}.`,
    `Already measured (do not repeat):\n${known}`,
    ...files.map(([p, t]) => `<file path="${p}">\n${t}\n</file>`),
  ].join('\n\n');
  const result = await askJson(Proposal, SYSTEM, prompt, { effort: 'high' });

  const touched = new Map(analysis.files.map((f) => [f.path, f.lastTouched]));
  const conventions: Convention[] = [];
  const voiceSamples: Record<string, string> = {};
  for (const p of result.conventions) {
    const id = `${p.layer}.llm.${slug(p.title)}`;
    const base = { id, layer: p.layer as Layer, title: p.title, instruction: p.instruction, scope: p.role ?? 'codebase', source: 'llm' as const };
    if (p.kind === 'pattern' && p.regex && p.expect) {
      let re: RegExp;
      try {
        re = new RegExp(p.regex, 'm');
      } catch {
        continue;
      }
      const scope = analysis.files.filter((f) => (!p.role || f.role === p.role) && /\.[jt]sx?$/.test(f.path) && !heldOut.has(f.path));
      const obs = scope.map((f) => ({ feature: id, value: re.test(texts.get(f.path) ?? '') ? 'present' : 'absent', file: f.path, line: 1, role: f.role }));
      const matched = obs.filter((o) => o.value === p.expect);
      if (obs.length < 3 || matched.length / obs.length < 0.6) continue;
      conventions.push({
        ...buildConvention({ ...base, check: { type: 'pattern', role: p.role, regex: p.regex, expect: p.expect } }, matched, obs.filter((o) => !matched.includes(o)), touched),
        example: p.sample,
      });
    } else {
      const evidence = p.exampleFiles.filter((f) => texts.has(f)).map((file) => ({ file, line: 1 }));
      conventions.push({
        ...base,
        check: { type: 'judgment', rubric: p.instruction },
        support: { matched: evidence.length, total: evidence.length, ratio: 1 },
        evidence,
        exceptions: [],
        confidence: 0.6,
        trend: 'unknown',
        tier: 'learned',
        status: 'pending',
        example: p.sample,
      });
    }
    voiceSamples[id] = p.sample;
  }
  return { dossier: result.dossier, conventions, voiceSamples };
}
