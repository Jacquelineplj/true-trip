// Paid integration comparison; deliberately excludes production cache writes.
import fs from 'node:fs';
import {findParkingFee} from '../providers/parking-search.js';
import {runOpenAI} from '../providers/openai.js';
import {verifyParking} from '../core/verify.js';

const models=process.argv.slice(2);
if(!models.length)throw new Error('Pass model IDs to compare');
const hotel={name:'Hyatt Regency Boston',city:'Boston',url:'https://www.booking.com/hotel/us/hyatt-regency-boston.html'};
const report={at:new Date().toISOString(),hotel,rounds:2,method:'Identical production prompts and verification, no cache reads/writes, up to one recovery per trial. Timing includes recovery. API acceptance does not independently validate the price.',rows:[]};
const file='out/validation/hyatt-model-comparison.json';
fs.mkdirSync('out/validation',{recursive:true});
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
for(let round=1;round<=report.rounds;round++){
 await Promise.all(models.map(async model=>{
  const calls=[];const started=Date.now();
  try{
   const result=await findParkingFee(hotel,{model,noCache:true,persistCache:false,runLLM:async prompt=>{
    const start=Date.now();
    try{const response=await runOpenAI(prompt,{model,timeoutMs:90000,maxOutputTokens:1800});calls.push({prompt,...response});return response;}
    catch(e){calls.push({error:e.message,latencyMs:Date.now()-start});throw e;}
   }});
   const row={round,model,elapsedMs:Date.now()-started,verified:verifyParking(result.claim,result.evidence),result,calls};
   report.rows.push(row);
   console.log(JSON.stringify({round,model,elapsedMs:row.elapsedMs,verified:row.verified,calls:calls.length,recovery:result.recovery,error:result.error}));
  }catch(e){report.rows.push({round,model,error:e.message,calls});console.log(JSON.stringify({round,model,error:e.message}));}
  save();
 }));
}
console.log(`Report: ${file}`);
