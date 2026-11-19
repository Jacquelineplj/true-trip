import {tripCost,DEFAULT_SETTINGS} from './cost.js';
import {bookingParkingResult} from './booking-parking.js';
import {parkingFromProvider} from './public-parking.js';
import {needsDefaultPublicParking,defaultPublicParking} from './public-parking.js';
export function repriceHotel(h,details,settings={}) {
 if(needsDefaultPublicParking(h.parking))h={...h,parking:defaultPublicParking(h.parking)};
 const pageParking=settings.parking===false?null:bookingParkingResult(details.bookingParking,h.url);
 if(pageParking)h={...h,parking:parkingFromProvider(pageParking)};
 const s={...DEFAULT_SETTINGS,...settings},b=h.costDrive.breakdown;
 const price=details.price??h.room;
 const input={room:details.priceWarning||(details.currency&&details.currency!=='USD')?null:price,
  tax:details.priceIncludesTaxes?0:details.tax===undefined?b.tax:details.tax,fees:details.fees??b.fees,nights:h.nights,
  parkingPerNight:['ok','estimated'].includes(h.parking.status)?h.parking.perNight:null,
  legs:h.commute.map(c=>({durationMin:c.durationMin,fare:c.fare}))};
 const costDrive=tripCost(input,{...s,mode:'drive'}),costRide=tripCost(input,{...s,mode:'ride'});
 const cost=s.mode==='drive'?costDrive:costRide;
 const overLimit=(h.overLimit??[]).filter(x=>!x.startsWith('true cost '));
 if(s.budget&&cost.total&&cost.total.mid>s.budget)overLimit.push(`true cost $${Math.round(cost.total.mid)} > $${s.budget} budget`);
 return {...h,taxLookup:details.taxLookup??h.taxLookup,room:price,taxEvidence:details.taxEvidence??h.taxEvidence,costDrive,costRide,cost,overLimit};
}
