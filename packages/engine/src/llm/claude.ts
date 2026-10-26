import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type * as z from 'zod/v4';

/** Single entry point for Messages API calls. Every LLM feature in ARS goes through askJson(). */

export const MODEL = process.env.ARS_MODEL ?? 'claude-opus-5-5';
export const AGENT_MODEL = process.env.ARS_AGENT_MODEL ?? 'claude-opus-5-5';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', input: 4, output: 20 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', input: 2, output: 10 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', input: 0.1, output: 0.5 },
];

let client: Anthropic | undefined;

export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
}

/** Raised when Claude cannot be used at all (no credit, bad key, not logged in). Callers stop instead of retrying. */
export class LlmUnavailableError extends Error {}

const BAD_CREDENTIALS = 'Claude credentials are missing or invalid. Check ANTHROPIC_API_KEY (or your Claude Code login) and restart ARS.';

const ACCOUNT_PROBLEMS: [RegExp, string][] = [
  [/credit balance is too low/i, 'Your Anthropic API credit balance is too low. Add credits at console.anthropic.com (Settings → Billing), then try again.'],
  [/invalid.{0,10}api.?key|authentication_error/i, BAD_CREDENTIALS],
  [/not logged in|please run \/login/i, 'Claude Code is not logged in. Set ANTHROPIC_API_KEY or log in to Claude Code, then restart ARS.'],
];

/** Maps an error message to a user-facing explanation when it is an account problem no retry can fix. */
export function accountProblem(message: string): string | undefined {
  return ACCOUNT_PROBLEMS.find(([pattern]) => pattern.test(message))?.[1];
}

export async function askJson<S extends z.ZodType>(
  schema: S,
  system: string,
  prompt: string,
  opts: { effort?: 'low' | 'medium' | 'high'; maxTokens?: number } = {},
): Promise<z.infer<S>> {
  client ??= new Anthropic();
  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      system,
      messages: [{ role: 'user', content: prompt }],
      // Server-side fallback: if a request is declined, the API retries on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { format: betaZodOutputFormat(schema), effort: opts.effort ?? 'medium' },
    });
    if (response.stop_reason === 'refusal') throw new Error('The model declined this request.');
    if (!response.parsed_output) throw new Error('The model returned output that did not match the schema.');
    return response.parsed_output as z.infer<S>;
  } catch (err) {
    const problem = err instanceof Error ? accountProblem(err.message) : undefined;
    if (problem || err instanceof Anthropic.AuthenticationError) throw new LlmUnavailableError(problem ?? BAD_CREDENTIALS);
    throw err;
  }
}
