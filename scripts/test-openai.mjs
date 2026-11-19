// Explicit paid/network integration test; never run by npm test.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {getParkingProvider} from '../providers/parking.js';
const {findParkingFee}=await getParkingProvider();
import {llmRatings} from '../providers/ratings-llm.js';
import {closeParkingBrowser} from '../providers/parking-source-reader.js';
import {verifyParking} from '../core/verify.js';
import {llmProvider,llmModel} from '../providers/config.js';
const fixture=JSON.parse(fs.readFileSync('fixtures/boston-parking-audit.json'));
const reference=JSON.parse(fs.readFileSync('validation/parking-reference.json'));
const names=['Omni Boston Hotel at the Seaport','Hilton Garden Inn Boston Logan Airport','The Westin Copley Place, Boston'];
const report={at:new Date().toISOString(),provider:llmProvider(),model:llmModel(),rows:[]};
try {
 assert.equal(report.provider,'openai');
 for(const name of names){
  const hotel={...fixture.hotels.find(h=>h.name===name),city:fixture.context.city};
  const result=await findParkingFee(hotel,{noCache:true,refreshSources:true});
  const verified=verifyParking(result.claim,result.evidence??null);
  const ref=reference.rows.find(r=>r.name===name);
  report.rows.push({name,...result,verified,referenceMatch:verified.status==='ok'&&ref?.fee!=null ? verified.perNight===ref.fee&&verified.type===ref.type : null});
  console.log(`${name}: OpenAI ${result.llm?.latencyMs??'?'}ms; parking ${verified.status} ${verified.perNight??'?'}`);
 }
 if(process.argv.includes('--ratings')){
  report.ratings=await llmRatings({name:names[0],city:'Boston'},{noCache:true});
 }
 report.apiPassed=report.rows.every(r=>r.llm?.provider==='openai'&&r.llm.webSearchCalls>=1);
 report.scored=report.rows.filter(r=>r.referenceMatch!=null).length;
 report.correct=report.rows.filter(r=>r.referenceMatch===true).length;
 report.numericCoverage=report.rows.filter(r=>r.verified.status==='ok').length/report.rows.length;
 report.limitation='Three-property migration smoke test only. Not a citywide accuracy/coverage evaluation.';
 assert.ok(report.apiPassed,'At least one real OpenAI web-search request failed');
 assert.ok(!report.rows.some(r=>r.referenceMatch===false),'A returned fee differs from the independent reference');
 assert.ok(report.scored>=1,'No independently verifiable parking result');
 report.passed=true;
}catch(e){report.passed=false;report.error=e.message;process.exitCode=1;}
finally{await closeParkingBrowser();fs.mkdirSync('out/validation',{recursive:true});fs.writeFileSync('out/validation/openai-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,apiPassed:report.apiPassed,scored:report.scored,correct:report.correct,numericCoverage:report.numericCoverage,error:report.error}));}
