// Offline replay: never call a model or modify the original live experiment.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {makeCache} from '../providers/cache.js';
import {createHotelResearch} from '../providers/hotel-research.js';
import {realProviders} from '../providers/index.js';
import {verifyParking} from '../core/verify.js';
const source='out/validation/boston-10-strategy-comparison.json';
const original=JSON.parse(fs.readFileSync(source,'utf8'));
const output='out/validation/boston-10-free-parking-replay.json';
const report={at:new Date().toISOString(),source,sourceAt:original.at,seed:original.seed,method:'Offline replay of the original live responses using updated production validation and fallback decisions. No model requests. Costs below are counterfactual sums of consumed stages from the original measured calls, not new spending or a new live coverage measurement. The original experiment and expense ledger are unchanged.',rows:[]};
for(const row of original.rows){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-free-replay-')),consumed=[];
 try{
  const research=createHotelResearch({cache:makeCache('isolated',{dir}),run:async(_prompt,opts)=>{
   const recorded=row.calls.find(c=>c.stage===opts.usageContext.purpose);
   if(!recorded)throw new Error(`No recorded response for ${row.hotel}: ${opts.usageContext.purpose}`);
   consumed.push(recorded);
   if(recorded.error)throw new Error(recorded.error);
   return {provider:'openai',...recorded};
  }});
  const providers=await realProviders({model:'gpt-4o-mini',research});
  const hotel=original.sample.find(h=>h.name===row.hotel);
  const result=await providers.findParkingFee({...hotel,...(row.strategy==='ota_only'?{deepSearch:true}:{allowDeepSearch:true})});
  report.rows.push({hotel:row.hotel,strategy:row.strategy,before:row.verified,after:verifyParking(result.claim,result.evidence),recovery:result.recovery,beforeRequests:row.calls.length,replayedRequests:consumed.length,originalEstimatedUsd:row.knownEstimatedUsd,replayedEstimatedUsd:Number(consumed.reduce((s,c)=>s+(c.costUsd??0),0).toFixed(12)),consumedStages:consumed.map(c=>c.stage)});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
report.summary={};
for(const strategy of ['ota_only','initial_then_ota']){
 const rows=report.rows.filter(r=>r.strategy===strategy);
 report.summary[strategy]={properties:rows.length,beforeNumericPrices:rows.filter(r=>r.before.status==='ok').length,afterNumericPrices:rows.filter(r=>r.after.status==='ok').length,afterNumericCoverage:rows.filter(r=>r.after.status==='ok').length/rows.length,afterNoOnSitePolicies:rows.filter(r=>r.after.type==='none'&&r.after.sourceUrl).length,normalizedFreeResults:rows.filter(r=>r.after.normalizedFreeParking).map(r=>r.hotel),originalRequests:rows.reduce((s,r)=>s+r.beforeRequests,0),replayedRequests:rows.reduce((s,r)=>s+r.replayedRequests,0),originalEstimatedUsd:rows.reduce((s,r)=>s+r.originalEstimatedUsd,0),replayedEstimatedUsd:rows.reduce((s,r)=>s+r.replayedEstimatedUsd,0)};
}
fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({summary:report.summary,report:output},null,2));
