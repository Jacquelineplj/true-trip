import {llmModel} from './config.js';
import {appendUsage,estimateOpenAICost,currentPageUsage} from './usage.js';

export async function runOpenAI(prompt,options={}){
 const started=Date.now();let captured=null,result,error,attempted=false;
 const model=options.model??llmModel();
 const pageLoad=options.pageLoad!==undefined?options.pageLoad:currentPageUsage();
 const record=options.recordUsage??(options.fetchImpl?null:appendUsage);
 try{
  result=await executeOpenAI(prompt,{...options,onRequest:()=>{attempted=true;},capture:(data,response)=>{captured={model:data.model||model,status:data.status??null,httpStatus:response.status??200,usage:data.usage??null,webSearchCalls:(data.output??[]).filter(x=>x.type==='web_search_call'&&x.status==='completed').length};}});
  return result;
 }catch(e){error=e;throw e;}
 finally{
  const cost=estimateOpenAICost(captured?.model??model,captured?.usage,captured?.webSearchCalls??0);
  if(result){result.costUsd=cost.estimatedUsd;result.costEstimate=cost;}
  const context=options.usageContext??{};
  if(record&&attempted)try{record({kind:'api_request',pageLoad,provider:'openai',model:captured?.model??model,purpose:context.purpose??'model_query',hotel:context.hotel??null,city:context.city??null,status:error?'failed':'completed',responseStatus:captured?.status??null,httpStatus:captured?.httpStatus??error?.status??null,errorCode:error?(error.code??error.name):null,usage:captured?.usage??null,webSearchCalls:captured?.webSearchCalls??null,latencyMs:Date.now()-started,cost});}catch(e){console.error(`TrueTrip usage log write failed (${e.code??'write_error'})`);}
 }
}

// Native fetch keeps the API key in the Node service; the extension never receives it.
async function executeOpenAI(prompt, {
  model = llmModel(), apiKey = process.env.OPENAI_API_KEY,
  timeoutMs = 45000, maxOutputTokens = 1800, webSearch = true, maxToolCalls = 3,
  fetchImpl = fetch, capture, onRequest,
} = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing; configure the local .env file');
  const started = Date.now();
  const body = {
    model, store: false, input: prompt,
    ...(/^gpt-(?:5\.|6)/.test(model) ? {reasoning: {effort: 'none'}} : {}),
    max_output_tokens: maxOutputTokens,
    ...(webSearch ? {
      tools: [{type: 'web_search', search_context_size: 'low'}],
      tool_choice: 'required', max_tool_calls: maxToolCalls,
      include: ['web_search_call.action.sources'],
    } : {}),
  };
  onRequest?.();
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  capture?.(data,response);
  // Never echo API bodies: authentication errors can contain credential fragments.
  if (!response.ok) {
    const code = /^[a-z0-9_]+$/i.test(data.error?.code ?? '') ? data.error.code : 'request_failed';
    const error = new Error(`OpenAI API HTTP ${response.status} (${code})`);
    error.status = response.status; error.code = code; throw error;
  }
  if (data.status !== 'completed') throw new Error(`OpenAI response did not complete (${data.status || 'unknown'})`);
  const output = data.output ?? [];
  const content = output.filter(x => x.type === 'message').flatMap(x => x.content ?? []);
  const text = content.filter(x => x.type === 'output_text').map(x => x.text).join('\n');
  if (!text.trim()) throw new Error('OpenAI response contains no text');
  const searches = output.filter(x => x.type === 'web_search_call' && x.status === 'completed');
  if (webSearch && !searches.length) throw new Error('OpenAI did not complete a web search');
  const citations = content.flatMap(x => x.annotations ?? []).filter(x => x.type === 'url_citation')
    .map(x => ({url: x.url, title: x.title}));
  const sources = searches.flatMap(x => x.action?.sources ?? []).map(x => ({url: x.url, title: x.title}));
  return {text, provider: 'openai', model: data.model || model, usage: data.usage ?? null,
    webSearchCalls: searches.length, citations, sources, costUsd: null, latencyMs: Date.now() - started};
}
