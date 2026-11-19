// Explicit, paid/network test: never part of npm test.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {getParkingProvider} from '../providers/parking.js';
const {findParkingFee}=await getParkingProvider();
import {verifyParking} from '../core/verify.js';
import {closeParkingBrowser} from '../providers/parking-source-reader.js';
import {mapLimit} from '../providers/http.js';
const positional=process.argv.slice(2).filter(a=>!a.startsWith('--'));
const file=positional[0] || 'fixtures/boston-parking-audit.json';
const input=JSON.parse(fs.readFileSync(file));
fs.mkdirSync('out/validation',{recursive:true});
let rows;
try { rows=await mapLimit(input.hotels,3,async hotel=>{
 const started=Date.now();
 const result=await findParkingFee({...hotel,city:input.context.city},{noCache:true,refreshSources:process.argv.includes('--refresh-sources')});
 const row={id:hotel.id,name:hotel.name,elapsedMs:Date.now()-started,...result,verified:verifyParking(result.claim,result.requiresEvidence ? (result.evidence??null) : undefined)};
 fs.writeFileSync(`out/validation/fresh-${hotel.id}.json`,JSON.stringify(row,null,2));
 console.log(`${hotel.name}: ${row.verified.status}, ${row.verified.perNight ?? '?'}; ${result.error ?? ''}`);
 return row;
}); } finally { await closeParkingBrowser(); }
const report={reference:positional[1] || 'validation/parking-reference.json',at:new Date().toISOString(),input:file,rows,found:rows.filter(r=>r.verified.status==='ok').length,total:rows.length,costUsd:rows.some(r=>r.llm && r.costUsd==null) ? null : rows.reduce((s,r)=>s+(r.costUsd??0),0)};
const reference=JSON.parse(fs.readFileSync(positional[1] || 'validation/parking-reference.json'));
report.referenceChecks=rows.map(row=>{const ref=reference.rows.find(r=>r.name===row.name);return {name:row.name,accepted:row.verified.status==='ok',correct:ref?.fee!=null && row.verified.status==='ok' ? row.verified.perNight===ref.fee && row.verified.type===ref.type : null};});
const scored=report.referenceChecks.filter(r=>r.correct!=null);
report.scored=scored.length;report.correct=scored.filter(r=>r.correct).length;report.accuracy=report.scored?report.correct/report.scored:null;
report.resolved=rows.filter(r=>['fetched','searched'].includes(r.evidence?.status) && (r.verified.status==='ok'||r.verified.type==='none')).length;
report.numericCoverage=report.found/report.total;report.resolutionCoverage=report.resolved/report.total;
report.qualityPassed=report.numericCoverage>=0.7 && report.accuracy>=0.8 && report.scored>=Math.min(10,report.total);
fs.writeFileSync(process.env.TRUETRIP_PARKING_REPORT || 'out/validation/fresh-parking-batch.json',JSON.stringify(report,null,2));
assert.ok(rows.some(r=>r.verified.status==='ok'),'No real sourced fees returned');
// Unavailable sources are measured as abstentions in coverage; no fee is guessed.

assert.ok(report.qualityPassed,'Parking coverage/accuracy target failed; see saved reference checks');
