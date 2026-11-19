import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';

const pageContext=new AsyncLocalStorage();
export const currentPageUsage=()=>pageContext.getStore()??null;
export function withPageUsage(page,fn){
 const safe=page&&typeof page.id==='string'&&/^[\w-]{1,128}$/.test(page.id)?{
  id:page.id,site:page.site==='booking'?'booking':'demo',city:String(page.city??'').slice(0,160),
  checkin:/^\d{4}-\d{2}-\d{2}$/.test(page.checkin??'')?page.checkin:null,
  checkout:/^\d{4}-\d{2}-\d{2}$/.test(page.checkout??'')?page.checkout:null,
 }:null;
 return pageContext.run(safe,fn);
}

export const usageFile=fileURLToPath(new URL('../.usage/requests.jsonl',import.meta.url));
const SOURCES=['https://developers.openai.com/api/docs/models/gpt-4o-mini','https://developers.openai.com/api/docs/models/gpt-4.1','https://developers.openai.com/api/docs/pricing'];
const RATES={
 'gpt-4o-mini':{input:0.15,cachedInput:0.075,output:0.60},
 'gpt-4.1':{input:2,cachedInput:0.5,output:8},
};
export function estimateOpenAICost(model,usage,webSearchCalls){
 const family=Object.keys(RATES).find(name=>model===name||new RegExp(`^${name.replaceAll('.','\\.')}-(?:\\d{4}-\\d{2}-\\d{2})$`).test(model));
 const rates=family?{...RATES[family],searchCall:0.01}:null;
 const input=usage?.input_tokens,output=usage?.output_tokens,cached=usage?.input_tokens_details?.cached_tokens??0;
 const valid=Number.isInteger(input)&&input>=0&&Number.isInteger(output)&&output>=0&&Number.isInteger(cached)&&cached>=0&&cached<=input&&Number.isInteger(webSearchCalls)&&webSearchCalls>=0;
 if(!rates||!valid)return {estimatedUsd:null,pricingStatus:rates?'missing_usage':'unknown_model',rates,pricingCheckedOn:'2026-11-17',pricingSources:SOURCES};
 // Response usage already contains the model's search-content input tokens.
 // Do not add the mini model's 8,000-token search block a second time.
 const inputUsd=((input-cached)*rates.input+cached*rates.cachedInput)/1e6;
 const outputUsd=output*rates.output/1e6,searchUsd=webSearchCalls*rates.searchCall;
 return {estimatedUsd:Number((inputUsd+outputUsd+searchUsd).toFixed(12)),inputUsd,outputUsd,searchUsd,rates,pricingStatus:'estimated',pricingCheckedOn:'2026-11-17',pricingSources:SOURCES};
}
export function initializeUsageLog(file=usageFile){
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.closeSync(fs.openSync(file,'a',0o600));
}
export function appendUsage(entry,{file=usageFile}={}){
 initializeUsageLog(file);
 fs.appendFileSync(file,JSON.stringify({id:randomUUID(),at:new Date().toISOString(),pageLoad:currentPageUsage(),...entry})+'\n');
}
export function readUsage({file=usageFile,limit=200}={}){
 let lines=[];
 try{lines=fs.readFileSync(file,'utf8').split('\n').filter(Boolean);}catch(e){if(e.code!=='ENOENT')throw e;}
 const entries=[];let unreadableRows=0;
 for(const line of lines){try{entries.push(JSON.parse(line));}catch{unreadableRows++;}}
 const paid=entries.filter(e=>e.kind==='api_request');
 const groups=new Map();
 for(const e of entries){
  const p=e.pageLoad;if(!p?.id)continue;
  let g=groups.get(p.id);
  if(!g){g={id:p.id,at:e.at,lastUpdatedAt:e.at,site:p.site,city:p.city,checkin:p.checkin,checkout:p.checkout,estimatedUsd:0,unknownCostRequests:0,hotels:new Set()};groups.set(p.id,g);}
  g.lastUpdatedAt=e.at;
  if(e.hotel)g.hotels.add(e.hotel);
  if(e.kind==='api_request'){
   if(e.cost?.estimatedUsd==null)g.unknownCostRequests++;
   else g.estimatedUsd+=e.cost.estimatedUsd;
  }
 }
 const pages=[...groups.values()].map(g=>({...g,estimatedUsd:Number(g.estimatedUsd.toFixed(12)),hotels:g.hotels.size})).reverse();
 return {currency:'USD',basis:'Estimates from reported API usage and recorded public standard rates; actual invoice may differ. Missing usage is unknown, never zero. Cache hits make no paid API request.',
  totalEstimatedUsd:paid.reduce((sum,e)=>sum+(e.cost?.estimatedUsd??0),0),apiRequests:paid.length,cacheHits:entries.filter(e=>e.kind==='cache_hit').length,
  unknownCostRequests:paid.filter(e=>e.cost?.estimatedUsd==null).length,unreadableRows,pageLoadCount:pages.length,pages:pages.slice(0,limit),
  ungroupedEstimatedUsd:paid.filter(e=>!e.pageLoad?.id).reduce((sum,e)=>sum+(e.cost?.estimatedUsd??0),0),entries:entries.slice(-limit).reverse()};
}
