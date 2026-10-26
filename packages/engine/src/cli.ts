#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { analyzeDirectory } from './analyzers/index.ts';
import { formatText, isFormattable } from './analyzers/format.ts';
import { checkConventions } from './check/checker.ts';
import { loadRules } from './check/rules.ts';
import { getJob, onJob } from './jobs.ts';
import { createProfile } from './pipeline.ts';
import { installPackage } from './skills/install.ts';

/**
 * ARS command line — the same engine the web UI uses.
 *   ars analyze <git-url | folder>        learn a developer's signature
 *   ars check <folder> --rules <file>      score a folder against a skill package's rules
 *   ars install <package-dir> <project> --slug <name>
 *   ars hook --rules <file>                Claude Code PostToolUse hook (reads JSON on stdin)
 */

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function readStdin(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function analyze(source: string) {
  const { profile, jobId } = createProfile(source);
  console.log(`Profile ${profile.name} (${profile.id})`);
  await new Promise<void>((done) => {
    let printed = 0;
    const off = onJob(jobId, (job) => {
      for (const line of job.log.slice(printed)) console.log(line);
      printed = job.log.length;
      if (job.status !== 'running') {
        off();
        done();
      }
    });
  });
  const job = getJob(jobId)!;
  if (job.status === 'failed') process.exitCode = 1;
}

async function check(dir: string, rulesPath: string) {
  const { conventions } = loadRules(rulesPath);
  const analysis = analyzeDirectory(resolve(dir));
  const report = await checkConventions(conventions, analysis, { honorExceptions: true });
  for (const r of report.results.filter((x) => x.applicable)) {
    const c = conventions.find((x) => x.id === r.conventionId)!;
    console.log(`${r.passed === r.total ? '✓' : '✗'} ${Math.round((r.passed / r.total) * 100).toString().padStart(3)}%  ${c.title}`);
    for (const v of r.violations.slice(0, 3)) console.log(`        ${v.file}:${v.line}  ${v.value ?? ''}`);
  }
  console.log(`\nAdherence: ${Math.round(report.adherence * 100)}%`);
}

/** Format the edited file, then block on enforced-rule violations so Claude fixes them immediately. */
async function hook(rulesPath: string) {
  const input = JSON.parse((await readStdin()) || '{}');
  const file: string | undefined = input.tool_input?.file_path;
  if (!file || !isFormattable(file) || !existsSync(file) || !existsSync(rulesPath)) return;
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const rel = relative(projectDir, file);
  if (rel.startsWith('..') || /^(\.claude|\.ars|node_modules)\//.test(rel)) return;
  const { file: ruleFile, conventions } = loadRules(rulesPath);

  let text = readFileSync(file, 'utf8');
  const fmt = conventions.find((c) => c.check.type === 'formatting');
  if (fmt?.check.type === 'formatting') {
    const formatted = await formatText(text, file, fmt.check.options).catch(() => text);
    if (formatted !== text) writeFileSync(file, (text = formatted));
  }

  const texts = new Map([[rel, text]]);
  for (const name of ['tsconfig.json', 'tsconfig.app.json']) {
    if (existsSync(join(projectDir, name))) texts.set(name, readFileSync(join(projectDir, name), 'utf8'));
  }
  const root = '/__ars_hook__';
  const analysis = analyzeDirectory(root, { root, files: [...texts.keys()], texts, skipped: [], secrets: [] });
  const enforced = conventions.filter((c) => c.enforce && !['formatting', 'dependency', 'judgment'].includes(c.check.type));
  const report = await checkConventions(enforced, analysis, { files: new Set([rel]), honorExceptions: true, readText: (p) => texts.get(p) ?? '' });
  const failed = report.results.filter((r) => r.violations.length);
  if (!failed.length) return;
  const lines = failed.map((r) => {
    const c = enforced.find((x) => x.id === r.conventionId)!;
    const where = r.violations.slice(0, 3).map((v) => `line ${v.line}`).join(', ');
    return `- ${c.title} (${where}). ${c.instruction}`;
  });
  process.stderr.write(`ARS: ${rel} does not match ${ruleFile.profile}'s style yet. Fix these before continuing:\n${lines.join('\n')}\n`);
  process.exitCode = 2;
}

async function main() {
  const [cmd, a, b] = args;
  if (cmd === 'analyze' && a) return analyze(a);
  if (cmd === 'check' && a && flag('rules')) return check(a, flag('rules')!);
  if (cmd === 'hook' && flag('rules')) return hook(flag('rules')!);
  if (cmd === 'install' && a && b) {
    for (const f of installPackage(resolve(a), resolve(b), flag('slug') ?? 'profile')) console.log(`wrote ${f}`);
    return;
  }
  console.log('Usage:\n  ars analyze <git-url|folder>\n  ars check <folder> --rules <rules.json>\n  ars install <package-dir> <project> --slug <name>\n  ars hook --rules <rules.json>');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
