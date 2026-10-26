/** Secret detection and redaction. Anything sent to an LLM or written into a skill passes through redact(). */
const PATTERNS: [string, RegExp][] = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ['openai-style-key', /\bsk-[A-Za-z0-9]{32,}\b/g],
  ['slack-token', /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ['assigned-secret', /\b(?:api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/gi],
];

export interface SecretHit {
  file: string;
  line: number;
  kind: string;
}

export function findSecrets(file: string, text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const [kind, re] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      hits.push({ file, kind, line: text.slice(0, m.index).split('\n').length });
    }
  }
  return hits;
}

export function redact(text: string): string {
  return PATTERNS.reduce((t, [kind, re]) => t.replace(re, `«redacted:${kind}»`), text);
}
