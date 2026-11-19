import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {estimateOpenAICost,appendUsage,readUsage,withPageUsage} from '../providers/usage.js';
import {runOpenAI} from '../providers/openai.js';
const usage={input_tokens:9000,input_tokens_details:{cached_tokens:1000},output_tokens:200};
const reply={model:'gpt-4o-mini-2024-07-18',status:'completed',usage,output:[{type:'web_search_call',status:'completed',action:{sources:[]}},{type:'message',content:[{type:'output_text',text:'{"answer":"ok"}'}]}]};
test('cost includes cached-token discount, output and one search without doubling search input',()=>{
 assert.equal(estimateOpenAICost(reply.model,usage,1).estimatedUsd,0.011395);
 assert.equal(estimateOpenAICost('gpt-4.1',usage,1).estimatedUsd,0.0281);
 assert.equal(estimateOpenAICost('gpt-4.1-mini',usage,1).estimatedUsd,null);
 assert.equal(estimateOpenAICost('gpt-4o-mini',null,1).estimatedUsd,null);
 assert.equal(estimateOpenAICost('gpt-4o-mini',{...usage,input_tokens:-1},1).estimatedUsd,null);
});
test('successful API call records once with context and excludes credentials, prompts and answer',async()=>{
 const rows=[];
 const r=await runOpenAI('private prompt',{apiKey:'private-api-key',model:'gpt-4o-mini',usageContext:{purpose:'hotel_parking_address',hotel:'Audit Hotel'},recordUsage:e=>rows.push(e),fetchImpl:async()=>({ok:true,status:200,json:async()=>reply})});
 assert.equal(rows.length,1);assert.equal(rows[0].hotel,'Audit Hotel');assert.equal(rows[0].cost.estimatedUsd,0.011395);assert.equal(r.costUsd,0.011395);
 assert.ok(!JSON.stringify(rows).match(/private-api-key|private prompt|answer/));
});
test('failed responses with usage still record cost; auth failures record unknown, never zero',async()=>{
 const rows=[];
 await assert.rejects(runOpenAI('x',{apiKey:'test',recordUsage:e=>rows.push(e),fetchImpl:async()=>({ok:true,status:200,json:async()=>({...reply,status:'incomplete'})})}));
 assert.equal(rows[0].status,'failed');assert.equal(rows[0].cost.estimatedUsd,0.011395);
 await assert.rejects(runOpenAI('x',{apiKey:'secret',model:'gpt-4o-mini',recordUsage:e=>rows.push(e),fetchImpl:async()=>({ok:false,status:401,json:async()=>({error:{code:'invalid_api_key',message:'secret'}})})}));
 assert.equal(rows[1].cost.estimatedUsd,null);assert.equal(rows[1].errorCode,'invalid_api_key');assert.ok(!JSON.stringify(rows).includes('secret'));
});
test('missing local credentials do not count as an API request',async()=>{
 const rows=[];await assert.rejects(runOpenAI('x',{apiKey:'',recordUsage:e=>rows.push(e)}));assert.equal(rows.length,0);
});
test('ledger persists across reads and counts cached queries as zero while flagging unknown costs',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-usage-')),file=path.join(dir,'requests.jsonl');
 try{
  assert.equal(readUsage({file}).apiRequests,0);
  appendUsage({kind:'api_request',cost:{estimatedUsd:0.011395}},{file});
  appendUsage({kind:'cache_hit',cost:{estimatedUsd:0}},{file});
  appendUsage({kind:'api_request',cost:{estimatedUsd:null}},{file});
  fs.appendFileSync(file,'invalid partial row\n');
  const d=readUsage({file,limit:2});assert.equal(d.totalEstimatedUsd,0.011395);assert.equal(d.apiRequests,2);assert.equal(d.cacheHits,1);assert.equal(d.unknownCostRequests,1);assert.equal(d.unreadableRows,1);assert.equal(d.entries.length,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('costs aggregate per page load, including manual actions, reloads and zero-cost pages',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-pages-')),file=path.join(dir,'requests.jsonl');
 try{
  const page={id:'page-a',site:'booking',city:'Boston',checkin:'2026-11-17',checkout:'2026-11-18',url:'private-session-url'};
  withPageUsage(page,()=>{
   appendUsage({kind:'page_load'},{file});
   for(const cost of [0.01,0.02,0.03])appendUsage({kind:'api_request',hotel:'Hotel A',cost:{estimatedUsd:cost}},{file});
   appendUsage({kind:'api_request',hotel:'Hotel B',cost:{estimatedUsd:null}},{file});
  });
  withPageUsage({...page,id:'page-reload'},()=>{appendUsage({kind:'page_load'},{file});appendUsage({kind:'cache_hit',hotel:'Hotel A',cost:{estimatedUsd:0}},{file});});
  withPageUsage({...page,id:'page-empty'},()=>appendUsage({kind:'page_load'},{file}));
  const d=readUsage({file});assert.equal(d.pageLoadCount,3);
  const a=d.pages.find(p=>p.id==='page-a');assert.equal(a.estimatedUsd,0.06);assert.equal(a.unknownCostRequests,1);assert.equal(a.hotels,2);
  assert.equal(d.pages.find(p=>p.id==='page-reload').estimatedUsd,0);assert.equal(d.pages.find(p=>p.id==='page-empty').hotels,0);
  assert.ok(!fs.readFileSync(file,'utf8').includes('private-session-url'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('concurrent calls keep page attribution and explicit queued scope wins over ambient scope',async()=>{
 const rows=[];
 const run=id=>withPageUsage({id,site:'booking'},()=>runOpenAI('x',{apiKey:'test',recordUsage:e=>rows.push(e),fetchImpl:async()=>{await new Promise(r=>setTimeout(r,id==='one'?10:1));return {ok:true,status:200,json:async()=>reply};}}));
 await Promise.all([run('one'),run('two')]);assert.deepEqual(rows.map(e=>e.pageLoad.id),['two','one']);
 await withPageUsage({id:'ambient',site:'booking'},()=>runOpenAI('x',{pageLoad:{id:'queued'},apiKey:'test',recordUsage:e=>rows.push(e),fetchImpl:async()=>({ok:true,status:200,json:async()=>reply})}));
 assert.equal(rows[2].pageLoad.id,'queued');
});
