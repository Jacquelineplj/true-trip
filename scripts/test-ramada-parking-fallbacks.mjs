// Two explicitly requested live mini searches; each has a one-search budget.
import fs from 'node:fs';
import {runLLM} from '../providers/llm.js';
import {extractJSON} from '../providers/parking-prompt.js';
import {otaParkingPrompt} from '../providers/parking-ota-prompt.js';
import {verifyParking} from '../core/verify.js';
const hotel={name:'Ramada by Wyndham Boston',city:'Boston',address:'800 Morrissey Blvd, Boston, MA 02122',url:'https://www.booking.com/hotel/us/r-boston-massachusettes.html'};
const schema='Return JSON only: {"parking_fee_per_night":number|null,"currency":"USD","parking_type":"self"|"valet"|"free"|"none"|"unknown","source_url":string|null,"source_quote":string|null,"confidence":"high"|"medium"|"low"}. Quote the actual daily or nightly guest parking fee. No shuttle, deposit, package, hourly, event or nearby-garage fees. Use null if unavailable; do not invent evidence.';
const variants=[{name:'mini-booking-fine-print',prompt:`Use web search to find the on-site overnight guest parking price for ${JSON.stringify(hotel)}. Search this exact Booking hotel page, especially The fine print / Important information and Facilities / Parking. Search query: site:booking.com/hotel/us/r-boston-massachusettes parking "per day". Its English and en-gb pages can have the parking statement near the bottom. Search the policy section instead of relying only on the hotel introduction. ${schema}`},{name:'mini-ota',prompt:otaParkingPrompt(hotel)}];
const cache=Object.values(JSON.parse(fs.readFileSync('.cache/hotel-research-v1.json'))).filter(e=>e.k?.[2]?.name===hotel.name&&e.k?.[1]==='gpt-4o-mini');
const report={hotel:hotel.name,at:new Date().toISOString(),cachedBaseline:cache.filter(e=>e.k[0]==='openai').map(e=>({includeRatings:e.k.at(-1),fee:extractJSON(e.v.text)?.parking_fee_per_night,quote:extractJSON(e.v.text)?.source_quote})),runs:[]};
for(const variant of variants){
 const row={name:variant.name};
 try{
  const r=await runLLM(variant.prompt,{model:'gpt-4o-mini',maxToolCalls:1,maxOutputTokens:500,usageContext:{purpose:'parking_validation',hotel:hotel.name,city:'Boston'}});
  const claim=extractJSON(r.text),evidence={status:'searched',searchedAt:new Date().toISOString(),webSearchCalls:r.webSearchCalls,sources:r.sources??[],citations:r.citations??[]};
  Object.assign(row,{claim,verified:verifyParking(claim,evidence),estimatedUsd:r.costUsd??r.costEstimate?.estimatedUsd??null,webSearchCalls:r.webSearchCalls,usage:r.usage});
 }catch(e){row.error=e.message;row.estimatedUsd=null;}
 report.runs.push(row);console.log(JSON.stringify(row));
}
report.knownEstimatedUsd=report.runs.reduce((sum,r)=>sum+(r.estimatedUsd??0),0);report.unknownCostRuns=report.runs.filter(r=>r.estimatedUsd==null).length;
fs.mkdirSync('out/validation',{recursive:true});fs.writeFileSync('out/validation/ramada-parking-fallback-searches.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({knownEstimatedUsd:report.knownEstimatedUsd,unknownCostRuns:report.unknownCostRuns}));
