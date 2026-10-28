import { query, type HookCallback, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { RunResult } from '../core/entities.ts';
import { isInside } from '../core/paths.ts';

/**
 * Headless Claude Code run in an isolated folder. Identical options for every condition.
 *
 * Workspaces hold untrusted text (a copy of the analyzed repo for T1, exemplars for T2) that could
 * steer the agent, and runs skip permission prompts. So:
 * - file tools are refused for any path outside the workspace (PreToolUse hook below);
 * - Bash (T2 only) runs in Claude Code's OS sandbox, which confines writes to the workspace;
 * - the agent gets a minimal environment, not the user's whole shell;
 * - no MCP servers are loaded, whatever files the workspace contains.
 */

/** Variables the agent needs to run and authenticate. Everything else in the user's shell stays out. */
const AGENT_ENV_KEYS = [
  'PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM',
  'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS',
];
const agentEnv = () => Object.fromEntries(AGENT_ENV_KEYS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));

/** The real path a tool would touch, following symlinks for the part of the path that exists. */
function realTarget(root: string, p: string): string {
  let cur = resolve(root, p);
  const rest: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(cur), ...rest.reverse());
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return resolve(root, p);
      rest.push(basename(cur));
      cur = parent;
    }
  }
}

/** The first path-like tool argument that points outside the workspace, if any. */
function outsideWorkspace(root: string, input: Record<string, unknown>): string | undefined {
  for (const key of ['file_path', 'path', 'notebook_path']) {
    const v = input[key];
    if (typeof v === 'string' && v && !isInside(root, realTarget(root, v))) return v;
  }
  for (const key of ['pattern', 'glob']) {
    const v = input[key];
    if (typeof v === 'string' && /^[/~]|(^|\/)\.\.(\/|$)/.test(v)) return v;
  }
  return undefined;
}

const confineToWorkspace = (root: string): HookCallback => async (input) => {
  const toolInput = ((input as { tool_input?: unknown }).tool_input ?? {}) as Record<string, unknown>;
  const outside = outsideWorkspace(root, toolInput);
  if (!outside) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `This run may only use files inside its workspace; ${outside} is outside it.`,
    },
  };
};

export interface AgentRunOptions {
  cwd: string;
  prompt: string;
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  allowBash: boolean;
  transcriptPath: string;
  onEvent?: (line: string) => void;
  signal?: AbortSignal;
}

export interface AgentRunOutput {
  usage: RunResult['usage'];
  skillsLoaded: string[];
  error?: string;
}

function describeToolUse(name: string, input: Record<string, unknown>): string {
  const target = input.file_path ?? input.path ?? input.pattern ?? input.command ?? input.skill ?? '';
  return `${name} ${String(target).slice(0, 120)}`;
}

export async function runAgent(o: AgentRunOptions): Promise<AgentRunOutput> {
  const transcript: SDKMessage[] = [];
  const skillsLoaded = new Set<string>();
  const usage = { costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, durationMs: 0 };
  let error: string | undefined;
  const abortController = new AbortController();
  // A cancel that arrived before this run started must stop it too (a late listener never fires).
  if (o.signal?.aborted) abortController.abort();
  else o.signal?.addEventListener('abort', () => abortController.abort(), { once: true });
  const tools = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', ...(o.allowBash ? ['Bash'] : [])];
  const root = realpathSync(o.cwd);

  try {
    for await (const msg of query({
      prompt: o.prompt,
      options: {
        cwd: o.cwd,
        model: o.model,
        maxTurns: o.maxTurns,
        maxBudgetUsd: o.maxBudgetUsd,
        tools,
        allowedTools: tools,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // Only the workspace's own .claude/ (skills + hooks) — never the user's personal config.
        settingSources: ['project'],
        env: agentEnv(),
        hooks: { PreToolUse: [{ matcher: 'Read|Write|Edit|MultiEdit|NotebookEdit|Glob|Grep', hooks: [confineToWorkspace(root)] }] },
        // failIfUnavailable: with no sandbox (e.g. no bubblewrap on Linux) the run fails instead of running Bash unsandboxed.
        sandbox: { enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false },
        mcpServers: {},
        strictMcpConfig: true,
        abortController,
      },
    })) {
      transcript.push(msg);
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'tool_use') {
            const input = block.input as Record<string, unknown>;
            if (block.name === 'Skill') skillsLoaded.add(String(input.skill ?? input.name ?? input.command ?? ''));
            if (block.name === 'Read' && /\/\.claude\/skills\/([^/]+)\/SKILL\.md$/.test(String(input.file_path))) {
              skillsLoaded.add(String(input.file_path).match(/skills\/([^/]+)\//)![1]);
            }
            o.onEvent?.(`→ ${describeToolUse(block.name, input)}`);
          } else if (block.type === 'text' && block.text.trim()) {
            o.onEvent?.(block.text.trim().slice(0, 200));
          }
        }
      }
      if (msg.type === 'result') {
        usage.costUsd = msg.total_cost_usd;
        usage.turns = msg.num_turns;
        usage.durationMs = msg.duration_ms;
        for (const m of Object.values(msg.modelUsage ?? {})) {
          usage.inputTokens += (m.inputTokens ?? 0) + (m.cacheReadInputTokens ?? 0) + (m.cacheCreationInputTokens ?? 0);
          usage.outputTokens += m.outputTokens ?? 0;
        }
        if (msg.subtype !== 'success') error = `${msg.subtype}${'errors' in msg && msg.errors.length ? `: ${msg.errors.join('; ')}` : ''}`;
      }
    }
  } catch (err) {
    error = (err as Error).message;
  } finally {
    writeFileSync(o.transcriptPath, JSON.stringify(transcript, null, 1));
  }
  if (error && /sandbox/i.test(error)) error = `Bash sandboxing is unavailable, so the run was refused. On Linux, install bubblewrap and socat. (${error})`;
  return { usage, skillsLoaded: [...skillsLoaded].filter(Boolean), error };
}
