import {llmProvider, llmModel} from './config.js';
import {createLimiter} from './async.js';
import {currentPageUsage} from './usage.js';
const queue=createLimiter(Math.max(1,Math.min(12,Number(process.env.TRUETRIP_AI_CONCURRENCY)||6)));
export const llmQueueStats=()=>queue.stats();
export function runLLM(prompt,opts={}){const scoped={...opts,pageLoad:currentPageUsage()};return queue.run(()=>execute(prompt,scoped));}
async function execute(prompt, opts = {}) {
  const provider = llmProvider();
  if (provider === 'openai') {
    const {runOpenAI} = await import('./openai.js');
    return runOpenAI(prompt, {...opts, model: llmModel(opts)});
  }
  const {runClaude} = await import('./parking-claude-cli.js');
  return {...await runClaude(prompt, {...opts, model: llmModel(opts)}), provider, model: llmModel(opts)};
}
