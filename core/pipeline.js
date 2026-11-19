// Orchestrates: geocode anchors -> per hotel: geocode, routes, parking claim, ratings -> cost both modes -> verify -> notes.
// Providers are injected so the pipeline can be unit-tested without network or LLM calls.
import { tripCost, breakEvenNotes, sortByTrueCost, DEFAULT_SETTINGS } from './cost.js';
import { checkDoubleCounting } from './verify.js';
import { estimateFare } from './fare.js';
import { nightsBetween } from './parse.js';
import {applyParkingAverage} from './parking-estimate.js';
import {parkingFromProvider} from './public-parking.js';
import {bookingParkingResult} from './booking-parking.js';

/**
 * @param {object} input
 * @param {{city:string, checkin?:string, checkout?:string, nights?:number, currency?:string}} input.context
 * @param {Array<{id?:string,name:string,address?:string,distanceText?:string,price:number,priceIncludesTaxes?:boolean,bookingScore?:number,bookingReviews?:number,url?:string}>} input.hotels
 * @param {{anchors:string[], mode:'drive'|'ride', timeValue:number, roundTripsPerDay:number, days?:number, maxCommuteMin?:number, budget?:number, parking?:boolean, ratings?:boolean}} input.settings
 * @param {object} providers  { geocode(q), geocodeHotel(h), driveRoute(a,b), findParkingFee(h), ratings(h) }
 * @param {{log?:Function, concurrency?:number}} [opts]
 */
export async function enrichHotels({ context, hotels, settings }, providers, opts = {}) {
  const log = opts.log ?? (() => {});
  const s = { ...DEFAULT_SETTINGS, parking: true, ratings: true, ...settings };
  const nights = context.nights ?? nightsBetween(context.checkin, context.checkout) ?? 1;

  const settled=fn=>Promise.resolve().then(fn).catch(e=>({error:e.message}));
  const lookups=hotels.map(h=>{const hotel={...h,city:context.city,nights,lookupRatings:s.ratings,allowDeepSearch:!!s.deepSearch};return {
    parking:s.parking&&providers.findParkingFee ? settled(()=>bookingParkingResult(h.bookingParking,h.url)??providers.findParkingFee(hotel)) : null,
    ratings:s.ratings&&providers.ratings&&!providers.ratingsNeedsLocation ? settled(()=>providers.ratings(hotel)) : null,
  };});

  // 1) city centroid (bias for every lookup), then anchors
  const cityCenter = providers.geocodeCity ? await providers.geocodeCity(context.city) : null;
  const bias = cityCenter ? { lat: cityCenter.lat, lon: cityCenter.lon } : null;
  const anchors = await Promise.all((s.anchors??[]).slice(0,3).map(async a=>{
    const g=await (providers.geocodeAnchor??providers.geocode)(a,{bias});
    log(`anchor "${a}" -> ${g && !g.error ? g.label : 'NOT FOUND'}`);
    return {query:a,location:g&&!g.error?{lat:g.lat,lon:g.lon,estimated:g.estimated??false}:null,label:g?.label??null,error:g?.error??(g?null:'not found')};
  }));

  // 2) per hotel
  const mapLimit = opts.mapLimit ?? (async (xs, _n, fn) => { const o = []; for (let i = 0; i < xs.length; i++) o.push(await fn(xs[i], i)); return o; });
  let results = await mapLimit(hotels, opts.concurrency ?? 3, (h, i) => enrichOne(h, i));

  async function enrichOne(h, i) {
    const hotel = { ...h, city: context.city, nights, lookupRatings:s.ratings,allowDeepSearch:!!s.deepSearch };
    const out = { id: h.id ?? String(i), name: h.name, room: h.price, nights, taxEvidence: h.taxEvidence ?? null, url: h.url ?? null, bookingScore: h.bookingScore ?? null, bookingReviews: h.bookingReviews ?? null, warnings: [] };

    // geocode
    const g = await providers.geocodeHotel(hotel, { bias });
    out.location = g ? { lat: g.lat, lon: g.lon, label: g.label, provider: g.provider, estimated:g.estimated??false } : null;
    if (!out.location) out.warnings.push('hotel location not found');
    hotel.location = out.location;
    if(s.ratings&&providers.ratings&&providers.ratingsNeedsLocation)lookups[i].ratings=settled(()=>providers.ratings(hotel));

    // commute to each anchor
    out.commute = await Promise.all(anchors.map(async a=>{
      if(!out.location||!a.location)return {anchor:a.query,durationMin:null,distanceKm:null,fare:null,reason:!out.location?'Hotel location unavailable':'Destination location unavailable'};
      const r=await providers.driveRoute(out.location,a.location);
      const fare=r?estimateFare({distanceKm:r.distanceKm,durationMin:r.durationMin,city:context.city}):null;
      return {anchor:a.query,durationMin:r?.durationMin??null,distanceKm:r?.distanceKm??null,estimated:!!(r?.estimated||out.location.estimated||a.location.estimated),provider:r?.provider??null,fare};
    }));
    log(`[${i + 1}/${hotels.length}] ${h.name}: commute ${out.commute.map((c) => c.durationMin == null ? '?' : Math.round(c.durationMin) + 'min').join(', ')}`);

    // Source discovery, independent page read and parking verification
    out.parking = { status: 'unknown', perNight: null, type: 'unknown', sourceUrl: null, quote: null, reason: 'not requested' };
    if (s.parking && providers.findParkingFee) {
      const p = await lookups[i].parking;
      out.parking = parkingFromProvider(p);
      log(`[${i + 1}/${hotels.length}] ${h.name}: parking ${out.parking.status} ${out.parking.perNight ?? ''} (${out.parking.reason})`);
    }

    // ratings (APIs; optional LLM fallback is the provider's choice)
    out.ratings = { google: null, tripadvisor: null };
    if (s.ratings && providers.ratings) {
      const r = await lookups[i].ratings;
      out.ratings = { google: r?.google ?? null, tripadvisor: r?.tripadvisor ?? null, note: r?.note ?? null, rejections:r?.rejections??null, llm: r?.llm ?? null, citations: r?.citations ?? [] };
    }

    if (h.taxLookupNote) out.warnings.push(h.taxLookupNote);
    if (h.priceWarning) out.warnings.push(h.priceWarning);
    if ((h.currency && h.currency !== 'USD') || (context.currency && context.currency !== 'USD')) out.warnings.push('Only USD prices are supported; select USD on Booking.com');

    // cost in both modes
    const legs = out.commute.map((c) => ({ durationMin: c.durationMin, fare: c.fare ? { low: c.fare.low, high: c.fare.high } : null }));
    const costInput = { room: h.priceWarning || (h.currency && h.currency !== 'USD') || (context.currency && context.currency !== 'USD') ? null : h.price, tax: h.priceIncludesTaxes ? 0 : (h.tax === undefined ? 0 : h.tax), fees: h.fees ?? 0, nights, parkingPerNight: ['ok','estimated'].includes(out.parking.status) ? out.parking.perNight : null, legs };
    out.costDrive = tripCost(costInput, { ...s, mode: 'drive' });
    out.costRide = tripCost(costInput, { ...s, mode: 'ride' });
    out.cost = s.mode === 'drive' ? out.costDrive : out.costRide;
    for (const c of [out.costDrive, out.costRide]) out.warnings.push(...checkDoubleCounting(c, { priceIncludesTaxes: h.priceIncludesTaxes }));

    // limits
    const worst = Math.max(...out.commute.map((c) => c.durationMin ?? 0));
    out.overLimit = [];
    if (s.maxCommuteMin && worst > s.maxCommuteMin) out.overLimit.push(`commute ${Math.round(worst)} min > ${s.maxCommuteMin} min limit`);
    if (s.budget && out.cost.total && out.cost.total.mid > s.budget) out.overLimit.push(`true cost $${Math.round(out.cost.total.mid)} > $${s.budget} budget`);
    return out;
  }

  const adjusted=applyParkingAverage(results,s);
  results=adjusted.hotels;
  const notes = breakEvenNotes(results, s);
  const ranked = sortByTrueCost(results).map((r) => r.id);
  return { context: { ...context, nights, center: bias }, settings: s, anchors, hotels: results, parkingAverage:adjusted.parkingAverage, notes, rankedByTrueCost: ranked };
}

/** Compact text summary for the CLI block ("ADDED BY TRUETRIP"). */
export function formatBlock(h, settings) {
  const lines = [];
  const p = h.parking;
  if (p.status === 'estimated') lines.push(`Parking: default public-parking estimate $${p.perNight}/night x ${h.nights} = $${Math.round(p.perNight*h.nights*100)/100} (no usable nearby public parking price found; not a quoted rate)`);
  else if(p.type==='public'&&p.status==='ok')lines.push(`Parking: nearby public parking $${p.perNight}/night x ${h.nights} = $${p.perNight*h.nights} (${p.facility.name}, approx. ${p.facility.distanceM} m away; source: ${p.sourceUrl})`);
  else if (p.status === 'ok') lines.push(`Parking: $${p.perNight}/night x ${h.nights} = $${p.perNight * h.nights} (${p.type}; source: ${p.sourceUrl})`);
  else if (p.status === 'flagged') lines.push(`Parking: $${p.perNight}/night FLAGGED (${p.reason}; source: ${p.sourceUrl})`);
  else lines.push(`Parking: unknown (${p.reason})`);
  const rides = h.costRide.breakdown.rides;
  const hrs = h.costRide.travelHours;
  lines.push(`Rides to your anchors: ${rides ? `$${Math.round(rides.low)}-${Math.round(rides.high)}` : 'unknown'}, about ${hrs == null ? '?' : hrs.toFixed(1)} h total travel`);
  const g = h.ratings.google, t = h.ratings.tripadvisor;
  lines.push(`Ratings: Booking ${h.bookingScore ?? '?'}, Google ${g?.rating ?? 'n/a'}, Tripadvisor ${t?.rating ?? 'n/a'}${g?.source?.includes('llm') ? ' (ratings via LLM search, unverified)' : ''}`);
  const c = h.cost;
  lines.push(c.total ? `True trip cost (${settings.mode}): about $${Math.round(c.total.mid)}${c.total.low !== c.total.high ? ` ($${Math.round(c.total.low)}-${Math.round(c.total.high)})` : ''}` : `True trip cost (${settings.mode}): incomplete (unknown: ${c.unknowns.join(', ')})`);
  if (h.overLimit.length) lines.push(`Over limit: ${h.overLimit.join('; ')}`);
  return lines;
}
