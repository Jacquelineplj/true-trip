// Parking fee finder via the Claude API (web search server tool). Same contract as parking-claude-cli.js.
// Select with TRUETRIP_PARKING_PROVIDER=api and set ANTHROPIC_API_KEY. Requires: npm install @anthropic-ai/sdk
import { parkingPrompt, extractJSON } from './parking-prompt.js';
import { makeCache } from './cache.js';

const cache = makeCache('parking', { ttlMs: 14 * 86400000 });
let clientPromise = null;

async function getClient() {
  if (!clientPromise) clientPromise = import('@anthropic-ai/sdk').then((m) => new m.default());
  return clientPromise;
}

export async function findParkingFee(hotel, opts = {}) {
  const key = ['v1', hotel.name, hotel.city ?? '', hotel.address ?? ''];
  if (!opts.noCache) {
    const hit = cache.get(key);
    if (hit) return { ...hit, cached: true };
  }
  try {
    const client = await getClient();
    const params = {
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
      messages: [{ role: 'user', content: parkingPrompt(hotel) }],
    };
    let response = await client.messages.create(params);
    // A long server-tool turn may pause; resend to continue (bounded).
    for (let i = 0; i < 4 && response.stop_reason === 'pause_turn'; i++) {
      params.messages.push({ role: 'assistant', content: response.content });
      response = await client.messages.create(params);
    }
    if (response.stop_reason === 'refusal') return { claim: null, provider: 'claude-api', error: 'refused' };
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const claim = extractJSON(text);
    const res = { claim, provider: 'claude-api', costUsd: null, usage: response.usage };
    if (claim) cache.set(key, res);
    return res;
  } catch (e) {
    return { claim: null, provider: 'claude-api', error: String(e.message ?? e) };
  }
}
