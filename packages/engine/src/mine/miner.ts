import type {
  Analysis, Check, Convention, Evidence, ExceptionRef, FormattingProfile, Observation, Value,
} from '../core/types.ts';
import { tierOf } from '../core/types.ts';
import { clamp, countBy, daysAgo, groupBy, percentile, round, unique } from '../core/util.ts';
import { describeFormatting } from '../analyzers/format.ts';
import { canonicalOrder, matchesFeature } from '../check/match.ts';
import { dependencyConventions } from './dependencies.ts';
import { FEATURE_MAP, fill, type FeatureDef } from './features.ts';
import { dirname } from 'node:path';

/** Turn raw observations into evidence-backed conventions. Deterministic: no LLM involved. */

const MIN_RATIO = { categorical: 0.6, oneOf: 0.85, max: 0.8, order: 0.5 } as const;
const MAX_EVIDENCE = 12;
const MAX_EXCEPTIONS = 30;

type FeatureCheck = Extract<Check, { type: 'feature' }>;

function deriveCheck(def: FeatureDef, values: Value[]): FeatureCheck | undefined {
  const feature = def.id;
  switch (def.kind) {
    case 'categorical': {
      const [top] = countBy(values, (v) => String(v));
      return top ? { type: 'feature', feature, kind: 'categorical', expected: top[0] } : undefined;
    }
    case 'oneOf': {
      const counts = countBy(values, (v) => String(v));
      const expected: string[] = [];
      let covered = 0;
      for (const [v, n] of counts) {
        if (covered / values.length >= 0.9 || n / values.length < 0.08) break;
        expected.push(v);
        covered += n;
      }
      return expected.length && expected.length <= 4 ? { type: 'feature', feature, kind: 'oneOf', expected } : undefined;
    }
    case 'max': {
      const nums = values.filter((v): v is number => typeof v === 'number');
      const threshold = Math.max(30, Math.ceil((percentile(nums, 0.9) * 1.15) / 10) * 10);
      return { type: 'feature', feature, kind: 'max', expected: threshold };
    }
    case 'order': {
      const expected = canonicalOrder(values.filter(Array.isArray) as string[][]);
      return expected.length >= 2 ? { type: 'feature', feature, kind: 'order', expected } : undefined;
    }
  }
}

/** Does adherence rise or fall in recently-touched files vs older ones? */
function trendOf(matched: Observation[], all: Observation[], touched: Map<string, number | undefined>): Convention['trend'] {
  const times = all.map((o) => touched.get(o.file)).filter((t): t is number => !!t);
  if (times.length < 6) return 'unknown';
  const median = percentile(times, 0.5);
  const ok = new Set(matched);
  const rate = (os: Observation[]) => (os.length ? os.filter((o) => ok.has(o)).length / os.length : 0);
  const recent = rate(all.filter((o) => (touched.get(o.file) ?? 0) >= median));
  const older = rate(all.filter((o) => (touched.get(o.file) ?? 0) < median));
  return recent > older + 0.05 ? 'rising' : recent < older - 0.05 ? 'falling' : 'stable';
}

export function confidenceOf(ratio: number, total: number, dirs: number, trend: Convention['trend']): number {
  const size = Math.min(1, Math.sqrt(total / 12));
  const spread = Math.min(1, dirs / 3);
  const trendBonus = trend === 'rising' ? 0.05 : trend === 'falling' ? -0.05 : 0;
  return round(clamp(ratio * (0.6 + 0.4 * size) * (0.85 + 0.15 * spread) + trendBonus));
}

/** Prefer one example per file so evidence shows breadth, not one file repeated. */
function pickEvidence(obs: Observation[]): Evidence[] {
  const seen = new Set<string>();
  const firsts = obs.filter((o) => !seen.has(o.file) && seen.add(o.file));
  return [...firsts, ...obs.filter((o) => !firsts.includes(o))].slice(0, MAX_EVIDENCE).map((o) => ({ file: o.file, line: o.line, value: JSON.stringify(o.value) }));
}

function exceptionsOf(misses: Observation[], matched: Observation[], touched: Map<string, number | undefined>): ExceptionRef[] {
  const matchedTimes = matched.map((o) => touched.get(o.file)).filter((t): t is number => !!t);
  const median = matchedTimes.length ? percentile(matchedTimes, 0.5) : undefined;
  return misses.slice(0, MAX_EXCEPTIONS).map((o) => {
    const t = touched.get(o.file);
    const hint: ExceptionRef['hint'] = !t || !median ? 'unknown' : t < median ? 'likely-legacy' : 'likely-intentional';
    return { file: o.file, line: o.line, value: JSON.stringify(o.value), hint, ageDays: daysAgo(t) };
  });
}

export function buildConvention(
  base: Pick<Convention, 'id' | 'layer' | 'title' | 'instruction' | 'scope' | 'check' | 'source'>,
  matched: Observation[], misses: Observation[], touched: Map<string, number | undefined>,
): Convention {
  const all = [...matched, ...misses];
  const ratio = all.length ? matched.length / all.length : 0;
  const trend = trendOf(matched, all, touched);
  const dirs = unique(matched.map((o) => dirname(o.file))).length;
  const exceptions = exceptionsOf(misses, matched, touched);
  const confidence = confidenceOf(ratio, all.length, dirs, trend);
  const tier = tierOf(base.layer);
  const autoApproved = tier === 'enforced' && confidence >= 0.85 && exceptions.length === 0;
  return {
    ...base,
    support: { matched: matched.length, total: all.length, ratio: round(ratio) },
    evidence: pickEvidence(matched),
    exceptions,
    confidence,
    trend,
    tier,
    status: autoApproved ? 'approved' : 'pending',
    autoApproved,
  };
}

function formattingConvention(f: FormattingProfile): Convention {
  const summary = describeFormatting(f.options);
  return {
    id: 'L1.formatting',
    layer: 'L1',
    title: `Formatting: ${summary.slice(0, 4).join(' · ')}`,
    instruction: `Format every file like this (a hook re-formats automatically): ${summary.join(', ')}.`,
    scope: 'all TS/JS files',
    check: { type: 'formatting', options: f.options },
    support: { matched: f.filesExact, total: f.filesSampled, ratio: round(f.lineMatch) },
    evidence: [],
    exceptions: [],
    confidence: round(f.lineMatch),
    trend: 'unknown',
    tier: 'enforced',
    source: 'miner',
    status: f.lineMatch >= 0.95 ? 'approved' : 'pending',
    autoApproved: f.lineMatch >= 0.95,
  };
}

export interface MineInput {
  analysis: Analysis;
  formatting: FormattingProfile;
  heldOut: Set<string>;
}

export function mineConventions({ analysis, formatting, heldOut }: MineInput): Convention[] {
  const touched = new Map(analysis.files.map((f) => [f.path, f.lastTouched]));
  const observations = analysis.observations.filter((o) => !heldOut.has(o.file));
  const conventions: Convention[] = [formattingConvention(formatting)];

  for (const [feature, obs] of groupBy(observations, (o) => o.feature)) {
    const def = FEATURE_MAP.get(feature);
    if (!def || obs.length < (def.minTotal ?? 3)) continue;
    const check = deriveCheck(def, obs.map((o) => o.value));
    if (!check) continue;
    const matched = obs.filter((o) => matchesFeature(check, o.value));
    if (matched.length / obs.length < MIN_RATIO[def.kind]) continue;
    const misses = obs.filter((o) => !matched.includes(o));
    conventions.push(
      buildConvention(
        {
          id: `${def.layer}.${def.id}`,
          layer: def.layer,
          title: fill(def.title, def, check.expected),
          instruction: fill(def.say, def, check.expected),
          scope: def.subject,
          check,
          source: 'miner',
        },
        matched, misses, touched,
      ),
    );
  }
  conventions.push(...dependencyConventions(analysis));
  return conventions;
}
