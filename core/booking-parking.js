// Accept a rate read from this exact Booking property page; never infer a fee.
import {verifyParking} from './verify.js';
function property(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||!(u.hostname==='booking.com'||u.hostname.endsWith('.booking.com'))||!u.pathname.startsWith('/hotel/'))return null;return u.pathname.replace(/\.[a-z]{2}(?:-[a-z]{2})?\.html$/i,'.html');}catch{return null;}
}
export function bookingParkingResult(details,hotelUrl){
 if(!details?.claim||!property(hotelUrl)||property(details.sourceUrl)!==property(hotelUrl)||property(details.claim.source_url)!==property(hotelUrl))return null;
 const evidence={status:'fetched',tier:'secondary',propertyMatched:true,fetchedAt:details.fetchedAt,sourceUrl:details.sourceUrl,section:details.section};
 const checked=verifyParking(details.claim,evidence);
 if(checked.status!=='ok')return null;
 return {claim:details.claim,evidence,requiresEvidence:true,provider:'booking-page',typeUnspecified:!!details.typeUnspecified};
}
