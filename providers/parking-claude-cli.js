// Parking fee finder via the local `claude` command line (Claude Code in -p mode with web search).
// Legacy backend, used only when TRUETRIP_LLM_PROVIDER=claude-cli is explicitly selected.
import { spawn } from 'node:child_process';

export function runClaude(prompt, { model = process.env.TRUETRIP_CLAUDE_MODEL || 'sonnet', timeoutMs = 180000, maxTurns = 8 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'json', '--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch,WebFetch', '--max-turns', String(maxTurns), '--model', model];
    const env = { ...process.env };
    delete env.CLAUDECODE; // allow nesting when launched from inside Claude Code
    const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`claude timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) return reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
      try {
        const j = JSON.parse(out);
        resolve({ text: j.result ?? '', costUsd: j.total_cost_usd ?? null, raw: j });
      } catch { resolve({ text: out, costUsd: null, raw: null }); }
    });
  });
}

/** Public parking entry point: source text verification replaces legacy LLM fee claims. */
export async function findParkingFee(hotel, opts = {}) {
  const verified = await import('./parking-verified.js');
  return verified.findParkingFee(hotel, opts);
}
