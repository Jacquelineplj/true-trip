// Geocoding: free Photon -> free Nominatim (1 req/s) -> optional Google Geocoding.
// Free-text hotel names and "name, address, city" strings work best with Photon when biased to the city.
import { getJSON, sleep } from './http.js';
import { makeCache } from './cache.js';
import { nameSimilarity,tokens } from '../core/match.js';
import { haversineKm } from '../core/geo.js';

const cache = makeCache('geocode-v3', { ttlMs: 30 * 86400000 });
const addressCache=makeCache('place-address',{ttlMs:30*86400000});
let lastNominatim = 0;let nominatimStart=Promise.resolve();

async function photon(q, bias, kind) {
  let url = `https://photon.komoot.io/api/?limit=5&lang=en&q=${encodeURIComponent(q)}`;
  if (bias) url += `&lat=${bias.lat}&lon=${bias.lon}`;
  const j = await getJSON(url,{timeoutMs:4500});
  const feats = j.features ?? [];
  const rows = feats.map((f) => ({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], label: [f.properties.name, f.properties.housenumber && f.properties.street ? `${f.properties.housenumber} ${f.properties.street}` : f.properties.street, f.properties.city, f.properties.state].filter(Boolean).join(', '), kind: f.properties.osm_value, provider: 'photon' }));
  const near = bias ? rows.filter((r) => haversineKm(r, bias) <= 60) : rows;
  return kind==='city'?[...near.filter(r=>['city','town','administrative','municipality'].includes(r.kind)),...near.filter(r=>!['city','town','administrative','municipality'].includes(r.kind))]:near;
}

async function nominatim(q) {
  const start=nominatimStart.then(async()=>{const wait=1100-(Date.now()-lastNominatim);if(wait>0)await sleep(wait);lastNominatim=Date.now();});
  nominatimStart=start.catch(()=>{});await start;
  const rows = await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&q=${encodeURIComponent(q)}`,{timeoutMs:4500});
  if (!rows?.length) return null;
  return rows.map(pick=>({lat:Number(pick.lat),lon:Number(pick.lon),label:pick.display_name,kind:pick.type,provider:'nominatim'}));
}

async function google(q) {
  const j = await getJSON(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${process.env.GOOGLE_MAPS_API_KEY}`,{timeoutMs:4500});
  return (j.results??[]).map(r=>({lat:r.geometry.location.lat,lon:r.geometry.location.lng,label:r.formatted_address,provider:'google'}));
}

/** Geocode free text. Returns {lat, lon, label, provider} or null. Misses are cached for five minutes. */
export async function geocode(query, { bias = null, kind=null,accept=null,cacheStore=cache,lookupProviders } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return null;
  const key = [kind==='address'?'address-v1':kind==='hotel'?'v4':'v3', kind, q, bias ? [bias.lat.toFixed(2), bias.lon.toFixed(2)] : null];
  const valid=r=>r&&Number.isFinite(r.lat)&&Number.isFinite(r.lon)&&Math.abs(r.lat)<=90&&Math.abs(r.lon)<=180&&(!bias||haversineKm(r,bias)<=60)&&(!accept||accept(r));
  if(kind==='address'){
    const legacy=cacheStore.get(['v3',null,q,bias?[bias.lat.toFixed(2),bias.lon.toFixed(2)]:null]);
    if(valid(legacy))return legacy;
  }
  return cacheStore.wrap(key,async()=>{
    const chain=lookupProviders??[x=>photon(x,bias,kind),nominatim,...(process.env.GOOGLE_MAPS_API_KEY?[google]:[])];
    for(const fn of chain){try{const response=await fn(q);const match=(Array.isArray(response)?response:[response]).find(valid);if(match)return match;}catch{}}
    return null;
  },{accept:r=>r===null||valid(r),cacheNull:true,ttlMs:r=>r==null?5*60000:30*86400000});
}

/** Resolve a sourced street address, rejecting street-only and wrong-building results
 * before moving on to the next geocoder. Do not append an already-present city. */
export async function geocodeAddress(address,{bias=null,city='',lookup=geocode}={}){
 const input=String(address??'').trim();if(!input)return null;
 const town=String(city??'').split(',')[0].trim();
 const base=town&&!input.toLowerCase().includes(town.toLowerCase())?`${input}, ${town}`:input;
 const expanded=expandStreet(base).replace(/\bMA\b/g,'Massachusetts');
 const simplified=town?`${expandStreet(input.split(',')[0])}, ${town}`:null;
 for(const query of [...new Set([base,expanded,simplified].filter(Boolean))].slice(0,3)){
  const r=await lookup(query,{bias,kind:'address',accept:point=>matchesStreetAddress(input,point)});
  if(r&&matchesStreetAddress(input,r))return r;
 }
 return null;
}

/** City centroid used to bias every other lookup. */
export async function geocodeCity(city) {
  const first = String(city ?? '').split(',')[0].trim();
  return (await geocode(city,{kind:'city'})) ?? geocode(first,{kind:'city'});
}

/** Geocode a hotel by name/address, trying progressively looser queries, biased to the city. */
export async function geocodeHotel({ name, address, city, location }, { bias = null, resolveAddress,resolvedAddressCache=addressCache,lookup=geocode,addressLookup=geocodeAddress,geocodeCache=cache } = {}) {
  if(Number.isFinite(location?.lat)&&Number.isFinite(location?.lon)&&Math.abs(location.lat)<=90&&Math.abs(location.lon)<=180&&(!bias||haversineKm(location,bias)<=60))return {...location,label:name,provider:'page'};
  const known=resolvedAddressCache.get([`${name}, ${city??''}`,bias?.lat,bias?.lon]);
  if(known&&/^https?:\/\//.test(known.addressSource??'')&&Number.isFinite(known.lat)&&Number.isFinite(known.lon)&&(!bias||haversineKm(known,bias)<=60)&&matchesHotelLocation({name,address},known,!!address)&&(!address||matchesStreetAddress(address,known)))return known;
  if(address){
    for(const query of [name&&city?`${name}, ${city.split(',')[0]}`:null,name].filter(Boolean)){
      const hit=geocodeCache.get(['v4','hotel',query,bias?[bias.lat.toFixed(2),bias.lon.toFixed(2)]:null]);
      if(hit&&Number.isFinite(hit.lat)&&Number.isFinite(hit.lon)&&(!bias||haversineKm(hit,bias)<=60)&&matchesStreetAddress(address,hit))return {...hit,query};
    }
  }
  const tries = [];
  if (name && city) tries.push([`${name}, ${city.split(',')[0]}`, false]);
  if (address && /\d/.test(address)) tries.unshift([address.includes(city?.split(',')[0] ?? '\u0000') ? address : `${address}, ${city?.split(',')[0] ?? ''}`, true]);
  const shortName=String(name??'').replace(/\bby (?:Hilton|Marriott|IHG|Sonesta|Wyndham)\b/ig,'').replace(/\s+/g,' ').trim();
  if(shortName&&shortName!==name&&city)tries.push([`${shortName}, ${city.split(',')[0]}`,false]);
  if (name) tries.push([name, false]);
  for (const [q, addressQuery] of tries) {
    const r = addressQuery?await addressLookup(address,{bias,city}):await lookup(q, { bias,kind:'hotel',accept:point=>matchesHotelLocation({name,address},point) });
    if (r && (!bias || haversineKm(r, bias) <= 60) && matchesHotelLocation({ name, address }, r, addressQuery)) return { ...r, query: q };
  }
  if(resolveAddress){
    const recovered=await resolveAddress({bias});
    if(recovered&&Number.isFinite(recovered.lat)&&Number.isFinite(recovered.lon)&&Math.abs(recovered.lat)<=90&&Math.abs(recovered.lon)<=180&&(!bias||haversineKm(recovered,bias)<=60)){
      if(/^https?:\/\//.test(recovered.addressSource??''))resolvedAddressCache.set?.([`${name}, ${city??''}`,bias?.lat,bias?.lon],recovered);
      return recovered;
    }
    return null;
  }
  return resolvePlace(`${name}, ${city??''}`,{bias,hotel:{name,address}});
}

// A nearby search result is not necessarily the requested hotel.
export function matchesHotelLocation(hotel, result, addressQuery = false) {
  if (!result?.label) return false;
  const unbrand=name=>String(name??'').replace(/\bby (?:Hilton|Marriott|IHG|Sonesta|Wyndham)\b/ig,'');
  const target=tokens(unbrand(hotel.name)).filter(t=>t!=='hostel'),found=tokens(unbrand(result.label.split(',')[0])).filter(t=>t!=='hostel');
  if(target.length&&target.filter(t=>found.includes(t)).length/target.length>=0.85&&nameSimilarity(hotel.name,result.label.split(',')[0])>=0.6)return true;
  if (addressQuery && hotel.address)return matchesStreetAddress(hotel.address,result);
  return false;
}

function expandStreet(s){return String(s).replace(/\bst\.?\b/ig,'Street').replace(/\bave\.?\b/ig,'Avenue').replace(/\brd\.?\b/ig,'Road').replace(/\bblvd\.?\b/ig,'Boulevard').replace(/\bdr\.?\b/ig,'Drive').replace(/\bpkwy\.?\b/ig,'Parkway');}
function streetKey(s){return expandStreet(s).toLowerCase().replace(/[^a-z0-9]/g,'');}
function matchesStreetAddress(address,result){
 const street=streetKey(String(address??'').split(',')[0]);
 if(/\d/.test(street)&&new RegExp(`(?:^|[^0-9])${street}`).test(streetKey(result?.label??'')))return true;
 // A named thoroughfare may omit a given name + middle initial, e.g.
 // Morrissey Blvd / William T. Morrissey Boulevard. Keep the house number exact
 // and require that particular name expansion; never drop direction prefixes.
 const requested=String(address??'').split(',')[0].match(/^\s*(\d+[a-z]?)\s+(.+)$/i);
 if(!requested)return false;
 const wanted=streetKey(requested[2]);
 for(const match of String(result?.label??'').matchAll(/\b(\d+[a-z]?)\s*,?\s+([^,]+)/gi)){
  if(match[1].toLowerCase()!==requested[1].toLowerCase())continue;
  const expanded=match[2].match(/^([a-z]+)\s+([a-z])\.?\s+(.+)$/i);
  if(expanded&&!/^(?:north|south|east|west)$/i.test(expanded[1])&&streetKey(expanded[3])===wanted)return true;
 }
 return false;
}

async function resolvePlace(query,{bias,hotel}={}){
  return addressCache.wrap([query,bias?.lat,bias?.lon],async()=>{
    try{
      const [{runLLM},{extractJSON}]=await Promise.all([import('./llm.js'),import('./parking-prompt.js')]);
      const r=await runLLM(`Find the exact current street address for ${JSON.stringify(query)} using web search. This is for geocoding. Match the exact hotel or venue, including renamed properties, not a similarly named hotel. Return JSON only: {"matched_name":string,"address":string|null,"source_url":string|null}. Do not invent coordinates.`,{maxOutputTokens:500,usageContext:{purpose:'address_lookup',hotel:hotel?.name}});
      const j=extractJSON(r.text);if(!j?.address||!/^https?:/.test(j.source_url??'')||!/\d/.test(j.address))return null;
      const g=await geocodeAddress(j.address,{bias});
      if(g&&(!hotel||matchesHotelLocation({name:hotel.name,address:j.address},g,true)))return {...g,label:`${j.matched_name}, ${j.address}`,addressSource:j.source_url};
    }catch{}
    return null;
  });
}
export async function geocodeAnchor(query,{bias=null}={}){
  const candidates=[query,String(query).split(',')[0]].filter((q,i,a)=>q&&a.indexOf(q)===i);
  for(const q of candidates){const g=await geocode(q,{bias});if(g)return g;}
  return resolvePlace(query,{bias});
}
