// Parking-only retry: make the OTA query explicit instead of repeating the
// combined property-research prompt. Never seed a known price into the prompt.
export function otaParkingPrompt({name,city,url}){
 let bookingUrl=null;try{const u=new URL(url);bookingUrl=u.origin+u.pathname;}catch{}
 const schema='{"parking_fee_per_night":number|null,"currency":"USD","parking_type":"self"|"valet"|"free"|"none"|"unknown","source_url":string|null,"source_quote":string|null,"confidence":"high"|"medium"|"low"}';
 return `Use web search to find the overnight hotel-guest parking rate for ${name} in ${city??''}, at ${bookingUrl??'the exact property'}. Search specifically: ${JSON.stringify(name)} (site:expedia.com OR site:hotels.com) parking per night. Use the exact property, not a similarly named sister hotel. Read the property's parking/transportation amenity or fee terms; exclude reviews, wedding packages, hourly rates and adjacent public garages. Choose hotel-operated self parking if offered, otherwise hotel-operated valet. A self-parking quote must actually be hotel-operated/on-site; do not infer that an adjacent public garage qualifies. Return null if no sourced overnight amount is found. Quote the fee and night/day unit exactly. Return JSON only: ${schema}. Do not search the official hotel page in this request.`;
}
