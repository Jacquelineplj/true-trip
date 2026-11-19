// Paid paired comparison: draw 10 properties once, then run both strategies independently.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createHotelResearch} from '../providers/hotel-research.js';
import {makeCache} from '../providers/cache.js';
import {runLLM} from '../providers/llm.js';
import {realProviders} from '../providers/index.js';
import {verifyParking} from '../core/verify.js';
import {extractJSON} from '../providers/parking-prompt.js';

const fixture=JSON.parse(fs.readFileSync('fixtures/boston-30.json','utf8'));
const seed=process.env.TRUETRIP_COMPARISON_SEED?Number(process.env.TRUETRIP_COMPARISON_SEED)>>>0:randomBytes(4).readUInt32LE(0);
let rng=seed;
function random(){rng=(Math.imul(1664525,rng)+1013904223)>>>0;return rng/4294967296;}
const pool=fixture.hotels.map(h=>({name:h.name,city:fixture.context.city,url:h.url}));
for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
const sample=pool.slice(0,10);
const output='out/validation/boston-10-strategy-comparison.json';
const report={at:new Date().toISOString(),seed,population:fixture.hotels.length,populationSource:'fixtures/boston-30.json',populationCapturedAt:fixture.context.capturedAt,model:'gpt-4o-mini',sample,method:'One live cold-cache trial per strategy per property. Random sample without replacement, saved before requests. Both strategies have independent caches and use production prompts/validators. OTA only runs one parking-only search. Cascade runs the combined parking/address lookup, then OTA only when unresolved. Ratings off. Each model request allows one web-search tool call. No retries beyond the configured cascade. Strategies are interleaved, with two hotel pairs in flight. This measures numeric-answer coverage, not independently verified accuracy.',rows:[]};
fs.mkdirSync(path.dirname(output),{recursive:true});
function summary(){
 const result={};
 for(const strategy of ['ota_only','initial_then_ota']){
  const rows=report.rows.filter(r=>r.strategy===strategy),valid=rows.filter(r=>r.verified.status==='ok');
  const total=rows.reduce((s,r)=>s+r.knownEstimatedUsd,0);
  result[strategy]={completed:rows.length,numericPrices:valid.length,numericCoverage:rows.length?valid.length/rows.length:0,noOnSitePolicies:rows.filter(r=>r.verified.type==='none'&&r.verified.sourceUrl).length,knownEstimatedUsd:Number(total.toFixed(12)),unknownCostRequests:rows.reduce((s,r)=>s+r.unknownCostRequests,0),apiRequests:rows.reduce((s,r)=>s+r.calls.length,0),searchCalls:rows.reduce((s,r)=>s+r.calls.reduce((n,c)=>n+(c.webSearchCalls??0),0),0),fallbacks:rows.filter(r=>r.recovery?.attempted).length,meanKnownCostPerHotel:rows.length?total/rows.length:null,knownCostPerNumericResult:valid.length?total/valid.length:null,meanLatencyMs:rows.length?rows.reduce((s,r)=>s+r.elapsedMs,0)/rows.length:null};
 }
 return result;
}
function save(){report.summary=summary();fs.writeFileSync(output,JSON.stringify(report,null,2));}
save();console.log(JSON.stringify({seed,sample:sample.map(h=>h.name)}));
async function trial(hotel,strategy){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-boston-paired-')),calls=[];
 const started=Date.now();let result;
 try{
  const research=createHotelResearch({cache:makeCache('isolated',{dir}),run:async(prompt,opts)=>{
   const began=Date.now();
   try{
    const response=await runLLM(prompt,{...opts,model:'gpt-4o-mini',usageContext:{purpose:`boston10_${strategy}_${opts.usageContext.purpose}`,hotel:hotel.name,city:hotel.city}});
    calls.push({stage:opts.usageContext.purpose,model:response.model,usage:response.usage,webSearchCalls:response.webSearchCalls,costUsd:response.costUsd,latencyMs:response.latencyMs,prompt,text:response.text,sources:response.sources,citations:response.citations});
    return response;
   }catch(e){calls.push({stage:opts.usageContext.purpose,model:opts.model,error:e.message,status:e.status,code:e.code,costUsd:null,latencyMs:Date.now()-began});throw e;}
  }});
  const providers=await realProviders({research,model:'gpt-4o-mini'});
  result=await providers.findParkingFee({...hotel,...(strategy==='ota_only'?{deepSearch:true}:{allowDeepSearch:true})});
 }catch(e){result={error:e.message,claim:null};}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
 const row={hotel:hotel.name,url:hotel.url,strategy,elapsedMs:Date.now()-started,verified:verifyParking(result.claim,result.evidence),claim:result.claim,error:result.error,recovery:result.recovery,knownEstimatedUsd:Number(calls.reduce((s,c)=>s+(c.costUsd??0),0).toFixed(12)),unknownCostRequests:calls.filter(c=>c.costUsd==null).length,addressFound:calls.some(c=>!!extractJSON(c.text)?.address),calls};
 report.rows.push(row);save();
 console.log(JSON.stringify({hotel:row.hotel,strategy,status:row.verified.status,fee:row.verified.perNight,type:row.verified.type,reason:row.verified.reason,cost:row.knownEstimatedUsd,unknownCostRequests:row.unknownCostRequests,calls:calls.length,elapsedMs:row.elapsedMs}));
}
let next=0;
async function worker(){
 while(next<sample.length){
  const hotel=sample[next++];
  const strategies=random()<0.5?['ota_only','initial_then_ota']:['initial_then_ota','ota_only'];
  await Promise.all(strategies.map(s=>trial(hotel,s)));
 }
}
await Promise.all([worker(),worker()]);
report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({summary:report.summary,report:output}));
