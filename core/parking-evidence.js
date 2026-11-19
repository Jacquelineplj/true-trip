// Parse current source text. Prices in reviews, event offers and neighbouring garages are not guest on-site rates.
import { nameSimilarity, normalizeName, tokens } from './match.js';

export function htmlToText(html) {
  return String(html).replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
    .replace(/<\/(?:p|div|li|h[1-6]|section|tr|td|th)>|<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,' ')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,h,d)=>String.fromCodePoint(parseInt(h||d,h?16:10)))
    .replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&dollar;/g,'$')
    .split('\n').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
}
export function matchesProperty(hotel, page) {
  const target=normalizeName(hotel.name);
  const lines=[page.title,...String(page.text).split('\n').slice(0,150)].filter(Boolean);
  const identityStop=new Set(['the','a','an','of','and','at','in','on','by','hotel','hotels','inn','suites','resort']);
  const targetTokens=tokens(hotel.name.replace(/\bby (?:Hilton|Marriott|IHG|Sonesta)\b|\bMOD Collection\b/ig,''),{keepStop:true}).filter(t=>!identityStop.has(t));
  return lines.some(line=>{const candidate=tokens(line,{keepStop:true});const coverage=targetTokens.filter(t=>candidate.includes(t)).length/targetTokens.length;return normalizeName(line).includes(target) || (coverage>=0.9 && nameSimilarity(hotel.name,line)>=0.65);});
}
const money=/(?:US\$|USD\s*|\$)\s*(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:USD|US\$)/gi;
const self=/self[ -]?park(?:ing)?/i, valet=/valet/i;
const offsite=/off[ -]?site|nearby|adjacent|across (?:the )?street|next door|not (?:hotel[ -]operated|affiliated)|public (?:garage|parking)|street parking/i;
const excluded=/restaurant|spa parking|event parking|for hotel functions|oversiz|park[ -]?(?:and|&)\s*(?:fly|stay)|parking package|airport parking package|early bird|hourly|up to \d+ hours?|\d\s*[-–]\s*\d\s*hours?/i;
const basis=/overnight|per (?:vehicle,? )?(?:night|day)|\/(?:night|day)|daily|nightly/i;

export function extractParkingFromText(text, {tier='primary'}={}) {
  if(tier==='secondary'){
    // OTA guest reviews/Q&A are excluded. Only the property's parking amenity section is parsed.
    const start=String(text).search(/Parking and transportation|Parking and transport|Parking details|Parking facilities|Optional extras/i);
    if(start<0)return {status:'unknown',reason:'OTA parking terms section unavailable'};
    let section=String(text).slice(start);
    const end=section.slice(30).search(/\n(?:Food and drink|Food & drink|Accessibility|Guest services|Things to do|Internet|Reviews|Frequently asked questions)\b/i);
    if(end>=0)section=section.slice(0,end+30);
    text=section.slice(0,4000);
  }
  const lines=String(text).replace(/\r/g,'').split('\n').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
  const offers=[];
  let section='', parkingContext=false;
  for(let i=0;i<lines.length;i++) {
    const line=lines[i];
    if(line.length<100 && /parking|self[ -]?park|valet/i.test(line)) {
      // An option label must not erase an event/off-site parent heading.
      if(excluded.test(line)||offsite.test(line)||(!excluded.test(section)&&!offsite.test(section))||/overnight|^parking$|guest parking/i.test(line)) section=line;
      parkingContext=true;
    }
    if(line.length<100 && /^(?:pets|smoking|breakfast|dining|hourly|restaurant|event|other parking|additional parking)/i.test(line)) section=line;
    // Keep per-option boundaries; never attach a neighbouring self-parking price to valet.
    let snippet=line;
    if((self.test(line)||valet.test(line)||/^parking$/i.test(line)) && ![...line.matchAll(money)].length) {
      const next=lines[i+1]??'';
      if(!self.test(next)&&!valet.test(next)) snippet += ' '+next;
      if(![...snippet.matchAll(money)].length && /^parking$/i.test(line)) snippet += ' '+(lines[i+2]??'');
    }
    // A few property FAQs put "all vehicles are valet-serviced" before "The fee is $X per night".
    if(/^the fee is /i.test(line) && /valet/i.test(lines.slice(Math.max(0,i-2),i).join(' '))) snippet='Valet parking. '+line;
    const context=snippet+' '+section;
    if(!parkingContext && !/parking|park|valet/i.test(snippet)) continue;
    if(excluded.test(context)||offsite.test(section)) continue;
    // Separate sentences when a paragraph discusses both hotel valet and an adjacent public garage.
    const clauses=snippet.split(/(?<=[.!?])\s+(?=[A-Z])/);
    for(const clause of clauses) {
      if(offsite.test(clause)||excluded.test(clause)) continue;
      const type=self.test(clause)?'self':valet.test(clause)?'valet':null;
      if(!type) continue;
      const amounts=[...clause.matchAll(money)].map(m=>Number((m[1]??m[2]).replace(/,/g,'')));
      if(amounts.length!==1 || !basis.test(clause)) continue;
      const fee=amounts[0];
      if(fee>0&&fee<=250) offers.push({fee,type,quote:clause});
    }
  }
  // Prefer self-parking. Conflicting rates for the same option require review instead of choosing the lowest.
  for(const type of ['self','valet']) {
    const options=offers.filter(o=>o.type===type);
    if(!options.length) continue;
    const fees=[...new Set(options.map(o=>o.fee))];
    if(fees.length!==1) return {status:'conflict',reason:`conflicting ${type} rates on current page`,offers};
    return {status:'ok',...options[0],offers};
  }
  const none=lines.find(l=>/does not (?:offer|have).*on[ -]site parking|no on[ -]site parking|no (?:kasa[ -]managed|kasa) parking|parking (?:is not|isn't) available|no parking (?:available|facilities)/i.test(l));
  if(none) return {status:'none',type:'none',fee:null,quote:none};
  const free=lines.find(l=>/free (?:private |self[ -]?)?parking.*on[ -]site|(?:on[ -]site|self[ -]?parking).*(?:is |: )?free\b/i.test(l) && !offsite.test(l)&&!excluded.test(l));
  if(free && !/not free|not complimentary|not available/i.test(free)) return {status:'ok',type:'free',fee:0,quote:free};
  return {status:'unknown',reason:'no unambiguous overnight on-site rate in current page',offers};
}
