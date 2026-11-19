// Server-side only. Environment variables take precedence over the local ignored file.
import {fileURLToPath} from 'node:url';
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export function parkingMode() {
  const mode = process.env.TRUETRIP_PARKING_MODE || 'search';
  if (!['search', 'verified'].includes(mode)) throw new Error('TRUETRIP_PARKING_MODE must be search or verified');
  return mode;
}
export function llmProvider() {
  const name = process.env.TRUETRIP_LLM_PROVIDER || 'openai';
  if (!['openai', 'claude-cli'].includes(name)) throw new Error('TRUETRIP_LLM_PROVIDER must be openai or claude-cli');
  return name;
}
export function llmModel(opts = {}) {
  return opts.model || (llmProvider() === 'openai'
    ? process.env.TRUETRIP_OPENAI_MODEL || DEFAULT_OPENAI_MODEL
    : process.env.TRUETRIP_CLAUDE_MODEL || 'sonnet');
}
