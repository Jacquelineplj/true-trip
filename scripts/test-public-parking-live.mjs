// Three paid public-parking searches. Reuse the prior recorded no-on-site hotel
// policies to avoid paying again for the initial property lookup.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHotelResearch} from '../providers/hotel-research.js';
import {makeCache} from '../providers/cache.js';
import {runLLM} from '../providers/llm.js';
import {realProviders} from '../providers/index.js';
import {parkingFromProvider} from '../core/public-parking.js';
const previous=JSON.parse(fs.readFileSync('out/validation/boston-10-strategy-comparison.json','utf8'));
const names=['Kasa Boston at Fenway','Bay Village Suites','Kasa at Boston Common'];
const report={at:new Date().toISOString(),method:'Live nearby public parking searches for three properties, with recorded prior no-on-site policies/addresses injected for the initial lookup. Independent temporary caches. No production cache or Booking page cost group modified. Only public-search stage is paid/live.',rows:[]};
fs.mkdirSync('out/validation',{recursive:true});
await Promise.all(names.map(async name=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-public-live-')),calls=[];
 try{
  const saved=previous.rows.find(r=>r.hotel===name&&r.strategy==='initial_then_ota');
  const initial=saved.calls.find(c=>c.stage==='hotel_parking_address');
  const research=createHotelResearch({cache:makeCache('isolated',{dir}),run:async(prompt,opts)=>{
   if(opts.usageContext.purpose!=='hotel_public_parking')return {provider:'openai',...initial};
   const start=Date.now();
   try{
    const r=await runLLM(prompt,{...opts,usageContext:{...opts.usageContext,purpose:'public_parking_live_validation'}});
    calls.push({model:r.model,text:r.text,usage:r.usage,costUsd:r.costUsd,webSearchCalls:r.webSearchCalls,latencyMs:r.latencyMs,sources:r.sources});return r;
   }catch(e){calls.push({error:e.message,costUsd:null,latencyMs:Date.now()-start});throw e;}
  }});
  const providers=await realProviders({research});const hotel=previous.sample.find(h=>h.name===name);
  const result=await providers.findParkingFee(hotel);
  const parking=parkingFromProvider(result);
  report.rows.push({hotel:name,parking,knownEstimatedUsd:calls.reduce((s,c)=>s+(c.costUsd??0),0),unknownCostRequests:calls.filter(c=>c.costUsd==null).length,calls});
  fs.writeFileSync('out/validation/public-parking-live.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({hotel:name,status:parking.status,perNight:parking.perNight,facility:parking.facility,lookup:parking.publicLookup,costUsd:report.rows.at(-1).knownEstimatedUsd}));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}));
report.totalKnownEstimatedUsd=report.rows.reduce((s,r)=>s+r.knownEstimatedUsd,0);
fs.writeFileSync('out/validation/public-parking-live.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({knownEstimatedUsd:report.totalKnownEstimatedUsd,report:'out/validation/public-parking-live.json'}));
