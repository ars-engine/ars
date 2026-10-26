import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { writeFileSync } from 'node:fs';
import type { RunResult } from '../core/entities.ts';

/** Headless Claude Code run in an isolated folder. Identical options for every condition. */

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
  return { usage, skillsLoaded: [...skillsLoaded].filter(Boolean), error };
}
