import { basename } from 'node:path';
import type { Role } from '../core/types.ts';

export interface RoleSignals {
  lang: string;
  hasJsx: boolean;
  definesHook: boolean;
  hasNetwork: boolean;
  onlyTypes: boolean;
  isStore: boolean;
}

const inDir = (path: string, dirs: string) => new RegExp(`(^|/)(${dirs})/`, 'i').test(path);

/** Decide what job a file does. Path conventions win; content signals break ties. */
export function classifyRole(path: string, s: RoleSignals): Role {
  const base = basename(path);
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base) || inDir(path, '__tests__|tests?|e2e|cypress')) return 'test';
  if (/\.stories\.[jt]sx?$/.test(base)) return 'story';
  if (/\.(css|scss|sass|less)$/.test(base)) return 'style';
  if (/\.config\.[cm]?[jt]s$|^\.?[a-z]+rc(\.[a-z]+)?$/.test(base) || /\.(json|ya?ml|toml)$/.test(base)) return 'config';
  if (!['typescript', 'javascript'].includes(s.lang)) return 'module';
  if (s.hasJsx && (inDir(path, 'pages|routes|screens|views') || /(^|\/)app\/.*(page|layout)\.[jt]sx$/.test(path))) return 'route';
  if (inDir(path, 'store|stores|slices|state|redux|atoms') || s.isStore) return 'store';
  if (!s.hasJsx && inDir(path, 'api|apis|services?|clients?|requests|endpoints|queries')) return 'api';
  if (/^use[A-Z-]/.test(base) || (inDir(path, 'hooks') && !s.hasJsx) || (s.definesHook && !s.hasJsx)) return 'hook';
  if (s.hasJsx) return 'component';
  if (s.hasNetwork) return 'api';
  if (s.onlyTypes || inDir(path, 'types?|interfaces|models') || /(^|\.)types?\.ts$/.test(base)) return 'type';
  if (inDir(path, 'utils?|lib|helpers?|shared')) return 'util';
  return 'module';
}

export const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin', '.rb': 'ruby', '.php': 'php', '.cs': 'csharp',
  '.swift': 'swift', '.vue': 'vue', '.svelte': 'svelte', '.css': 'css', '.scss': 'scss', '.sass': 'scss', '.less': 'less',
  '.html': 'html', '.json': 'json', '.md': 'markdown', '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.sql': 'sql',
};
