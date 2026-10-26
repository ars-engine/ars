import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hookSettings } from './generate.ts';

/**
 * Install a skill package into a target project so Claude Code picks it up:
 *   .claude/skills/ars-<slug>-<skill>/SKILL.md   (+ exemplars)
 *   .ars/<slug>/rules.json + prettierrc.json      (used by the hook)
 *   .claude/settings.json                         (PostToolUse hook merged in)
 *   .prettierrc.json                              (only if the project has none)
 */
export function installPackage(pkgDir: string, target: string, slug: string, opts: { hooks?: boolean } = {}): string[] {
  const written: string[] = [];
  const skillsDir = join(pkgDir, 'skills');
  for (const name of existsSync(skillsDir) ? readdirSync(skillsDir) : []) {
    const dest = join(target, '.claude/skills', `ars-${slug}-${name}`);
    cpSync(join(skillsDir, name), dest, { recursive: true });
    if (name === 'code-style' && existsSync(join(pkgDir, 'exemplars'))) cpSync(join(pkgDir, 'exemplars'), join(dest, 'exemplars'), { recursive: true });
    written.push(`.claude/skills/ars-${slug}-${name}/`);
  }

  const arsDir = join(target, '.ars', slug);
  mkdirSync(arsDir, { recursive: true });
  cpSync(join(pkgDir, 'rules.json'), join(arsDir, 'rules.json'));
  written.push(`.ars/${slug}/rules.json`);
  const prettierrc = join(pkgDir, 'enforce/.prettierrc.json');
  if (existsSync(prettierrc)) {
    const hasConfig = readdirSync(target).some((f) => /^\.prettierrc|^prettier\.config/.test(f));
    if (!hasConfig) {
      cpSync(prettierrc, join(target, '.prettierrc.json'));
      written.push('.prettierrc.json');
    }
  }

  if (opts.hooks !== false) {
    const settingsPath = join(target, '.claude/settings.json');
    const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
    const ours = hookSettings(slug).hooks.PostToolUse[0];
    const post = (settings.hooks?.PostToolUse ?? []).filter((h: any) => !JSON.stringify(h).includes(`.ars/${slug}/`));
    settings.hooks = { ...settings.hooks, PostToolUse: [...post, ours] };
    mkdirSync(join(target, '.claude'), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    written.push('.claude/settings.json');
  }
  return written;
}
