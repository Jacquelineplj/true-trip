// Paid A/B test: two trials each, one search per uncached trial, no production changes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHotelResearch} from '../providers/hotel-research.js';
import {makeCache} from '../providers/cache.js';
import {runLLM} from '../providers/llm.js';
import {extractJSON} from '../providers/parking-prompt.js';
import {verifyParking} from '../core/verify.js';
const hotel={name:'Hyatt Regency Boston',city:'Boston',url:'https://www.booking.com/hotel/us/hyatt-regency-boston.html'};
const original='Parking: prefer official hotel information, then OTA parking terms.';
const proposed='Parking: prefer official hotel information. Explicitly include Expedia and Hotels.com parking terms for the exact property in your search alongside the official site, within the same search-tool call. If the official page describes parking but omits the price, use an explicit overnight guest parking price from Expedia or Hotels.com instead; do not stop at the official page or return null just because it omits a price. Check property name/address and cite the actual OTA URL and its exact fee quote. Do not substitute a public garage for hotel-operated parking.';
const report={at:new Date().toISOString(),hotel,model:'gpt-4o-mini',rounds:2,method:'Identical current combined property prompt, except explicit Expedia/Hotels.com instruction in proposed variant. One search-tool call, no cache, no fallback. No known price injected.',rows:[]};
fs.mkdirSync('out/validation',{recursive:true});
for(let round=1;round<=2;round++){
 await Promise.all(['original','explicit_ota'].map(async variant=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-ota-ab-'));
  let output=null,sentPrompt=null;
  const started=Date.now();
  try{
   const research=createHotelResearch({cache:makeCache('trial',{dir}),run:async(prompt,opts)=>{
    if(!prompt.includes(original))throw new Error('Production prompt changed; review A/B test');
    sentPrompt=variant==='explicit_ota'?prompt.replace(original,proposed):prompt;
    output=await runLLM(sentPrompt,{...opts,usageContext:{purpose:`hyatt_prompt_test_${variant}`,hotel:hotel.name,city:hotel.city}});return output;
   }});
   const result=await research(hotel,{model:'gpt-4o-mini'});
   const claim=extractJSON(result.text);
   const evidence=result.error?null:{status:'searched',searchedAt:result.researchedAt,webSearchCalls:result.webSearchCalls};
   const row={round,variant,elapsedMs:Date.now()-started,verified:verifyParking(claim,evidence),claim,error:result.error,costUsd:output?.costUsd??null,response:output,prompt:sentPrompt};
   report.rows.push(row);console.log(JSON.stringify({round,variant,elapsedMs:row.elapsedMs,verified:row.verified,error:row.error,costUsd:row.costUsd}));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }));
 fs.writeFileSync('out/validation/hyatt-ota-prompt-ab.json',JSON.stringify(report,null,2));
}
console.log(JSON.stringify({totalEstimatedUsd:report.rows.reduce((sum,r)=>sum+(r.costUsd??0),0),report:'out/validation/hyatt-ota-prompt-ab.json'}));
