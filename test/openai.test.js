import test from 'node:test';
import assert from 'node:assert/strict';
import {runOpenAI} from '../providers/openai.js';
const reply={status:'completed',model:'gpt-5.4-mini',usage:{input_tokens:100,output_tokens:30},output:[
 {type:'web_search_call',status:'completed',action:{type:'search',sources:[{url:'https://example.com/policy',title:'Policy'}]}},
 {type:'message',content:[{type:'output_text',text:'{"urls":["https://example.com/policy"]}',annotations:[{type:'url_citation',url:'https://example.com/policy',title:'Policy'}]}]},
]};
test('OpenAI uses required web search, bounded output and server-side authentication',async()=>{
 let request;
 const r=await runOpenAI('Find source URLs',{model:'gpt-5.4-mini',apiKey:'unit-test-secret',fetchImpl:async(url,opts)=>{request={url,...opts};return {ok:true,json:async()=>reply};}});
 const b=JSON.parse(request.body);
 assert.equal(request.url,'https://api.openai.com/v1/responses');assert.equal(request.headers.Authorization,'Bearer unit-test-secret');
 assert.equal(b.model,'gpt-5.4-mini');assert.equal(b.store,false);assert.equal(b.tool_choice,'required');assert.equal(b.reasoning.effort,'none');
 assert.ok(b.max_output_tokens<=1800);assert.ok(b.max_tool_calls<=3);assert.ok(!request.body.includes('unit-test-secret'));
 assert.equal(r.webSearchCalls,1);assert.equal(r.sources.length,1);assert.equal(r.citations.length,1);assert.equal(r.costUsd,null);
 assert.ok(!JSON.stringify(r).includes('unit-test-secret'));
});
test('OpenAI auth/quota errors are sanitized and not retried or sent to another provider',async()=>{
 for(const [status,code] of [[401,'invalid_api_key'],[429,'insufficient_quota']]){
  let calls=0;
  await assert.rejects(runOpenAI('x',{model:'gpt-5.4-mini',apiKey:'unit-test-secret',fetchImpl:async()=>{calls++;return {ok:false,status,json:async()=>({error:{code,message:'Bad key: unit-test-secret'}})};}}),e=>e.status===status && e.code===code && !e.message.includes('unit-test-secret'));
  assert.equal(calls,1);
 }
});
test('OpenAI rejects missing keys, incomplete output and unsourced answers',async()=>{
 await assert.rejects(runOpenAI('x',{apiKey:''}),/OPENAI_API_KEY is missing/);
 for(const data of [{...reply,status:'incomplete'}, {...reply,output:reply.output.filter(x=>x.type==='message')}]){
  await assert.rejects(runOpenAI('x',{apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>data})}),/did not complete|did not complete a web search/);
 }
});

test('GPT-4o search request omits unsupported reasoning parameters',async()=>{
 let body;
 await runOpenAI('Search parking',{model:'gpt-4o',apiKey:'test',fetchImpl:async(_url,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>({...reply,model:'gpt-4o'})};}});
 assert.equal(body.model,'gpt-4o');assert.equal(body.reasoning,undefined);assert.equal(body.tools[0].type,'web_search');
});
