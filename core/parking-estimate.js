import {tripCost,DEFAULT_SETTINGS} from './cost.js';
import {hasNoOnSiteParkingPolicy,needsDefaultPublicParking,defaultPublicParking} from './public-parking.js';

// Retain the exported name/response field for older clients. Public parking now
// uses a sourced nearby quote or the explicit $50 default, never a cohort mean.
export function applyParkingAverage(hotels,settings={}) {
  const s={...DEFAULT_SETTINGS,parking:true,...settings};
  const adjusted=hotels.map(h=>{
    const p=h.parking;
    if(!s.parking||(!hasNoOnSiteParkingPolicy(p)&&!needsDefaultPublicParking(p))||p.type==='public'||p.estimate?.method==='default-public-parking')return h;
    const parking=defaultPublicParking(p);
    const b=h.costDrive.breakdown;
    const costDrive=tripCost({room:b.room,tax:b.tax,fees:b.fees,nights:h.nights,parkingPerNight:parking.perNight,
      legs:h.commute.map(c=>({durationMin:c.durationMin,fare:c.fare}))},{...s,mode:'drive'});
    const cost=s.mode==='drive'?costDrive:h.costRide;
    const overLimit=(h.overLimit??[]).filter(text=>!text.startsWith('true cost '));
    if(s.budget&&cost.total&&cost.total.mid>s.budget)overLimit.push(`true cost $${Math.round(cost.total.mid)} > $${s.budget} budget`);
    return {...h,parking,costDrive,cost,overLimit};
  });
  return {hotels:adjusted,parkingAverage:{perNight:null,sampleSize:0}};
}
