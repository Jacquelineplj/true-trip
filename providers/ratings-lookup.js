// Keep useful scores for seven days; retry only missing platforms after a short cooldown.
import {makeCache} from './cache.js';
import {llmRatings} from './ratings-llm.js';
import {llmProvider,DEFAULT_OPENAI_MODEL} from './config.js';
import {appendUsage} from './usage.js';
export const RATING_SUCCESS_TTL=7*86400000;
export const RATING_MISS_TTL=30*60000;
const platforms=['google','tripadvisor'];
export function createRatingsLookup({research,cache=makeCache('ratings-state-v2',{ttlMs:RATING_SUCCESS_TTL}),now=Date.now,record=appendUsage}={}){
 const pending=new Map();
 const parse=(hotel,response)=>llmRatings(hotel,{runLLM:async()=>{if(response.error)throw new Error(response.error);return response;},noCache:true,persistCache:false,recoverMissing:false,allowUnverified:true});
 return async function lookup(hotel,{model=DEFAULT_OPENAI_MODEL}={}){
  let url=null;try{const u=new URL(hotel.url);url=u.origin+u.pathname;}catch{}
  const key=[llmProvider(),model,hotel.name,hotel.city??'',url];
  const id=JSON.stringify(key);
  if(pending.has(id))return pending.get(id);
  const task=(async()=>{
   const time=now();let state=cache.get(key);const hadState=!!state;
   if(!state){
    // Parse the existing combined answer once. Its original age determines when
    // missing ratings can retry, even if parking keeps that answer alive longer.
    const response=await research(hotel,{model,includeRatings:true});
    const initial=await parse(hotel,response);
    const timestamp=Date.parse(response.researchedAt);
    const checkedAt=Number.isFinite(timestamp)?Math.min(timestamp,time):time;
    state={scores:{},rejections:initial.rejections??{},nextRetryAt:checkedAt+RATING_MISS_TTL,llm:initial.llm??null};
    for(const p of platforms)if(initial[p]&&checkedAt+RATING_SUCCESS_TTL>time)state.scores[p]={value:initial[p],expiresAt:checkedAt+RATING_SUCCESS_TTL};
   }
   for(const p of platforms)if(state.scores[p]?.expiresAt<=time)delete state.scores[p];
   const missing=platforms.filter(p=>!state.scores[p]);
   if(missing.length&&state.nextRetryAt<=time){
    let result;
    try{
     const response=await research(hotel,{model:DEFAULT_OPENAI_MODEL,mode:'ratings',ratingPlatforms:missing});
     result=await parse(hotel,response);
    }catch(e){result={error:e.message};}
    const completedAt=now();
    for(const p of missing){
     if(result[p]){state.scores[p]={value:result[p],expiresAt:completedAt+RATING_SUCCESS_TTL};state.rejections[p]=null;}
     else state.rejections[p]=result.rejections?.[p]??result.error??'No supported rating found';
    }
    state.nextRetryAt=completedAt+RATING_MISS_TTL;
    state.llm=result.llm??state.llm;
   }else if(record&&hadState){
    try{record({kind:'cache_hit',provider:llmProvider(),model,purpose:'hotel_ratings',hotel:hotel.name,city:hotel.city??null,status:'cached',cost:{estimatedUsd:0,pricingStatus:'no_api_request'}});}catch(e){console.error(`TrueTrip usage log write failed (${e.code??'write_error'})`);}
   }
   cache.set(key,state);
   const google=state.scores.google?.value??null,tripadvisor=state.scores.tripadvisor?.value??null;
   return {google,tripadvisor,rejections:state.rejections,llm:state.llm,retryAfter:platforms.some(p=>!state.scores[p])?new Date(state.nextRetryAt).toISOString():null,...(!google&&!tripadvisor?{error:'No valid platform rating found'}:{})};
  })().finally(()=>pending.delete(id));
  pending.set(id,task);return task;
 };
}
