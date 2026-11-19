#!/usr/bin/env node
// Local bridge for the Chrome extension. The extension cannot run `claude` itself, so it posts hotel cards here.
//   node cli/server.js [--port 8787]
// Endpoints:
//   GET  /health                 -> provider status
//   GET  /demo                   -> mock Booking.com results page (for testing the extension without Booking)
//   POST /enrich     {context, hotels, settings}  -> full pipeline result
//   POST /enrich-one {context, hotel,  settings}  -> one enriched hotel (the extension calls this per card)
//   POST /notes      {hotels: [enriched], settings} -> break-even notes + ranking
import {llmProvider,llmModel,parkingMode} from '../providers/config.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrichHotels } from '../core/pipeline.js';
import { breakEvenNotes, sortByTrueCost } from '../core/cost.js';
import { realProviders } from '../providers/index.js';
import { closeParkingBrowser } from '../providers/parking-source-reader.js';
import {applyParkingAverage} from '../core/parking-estimate.js';
import {repriceHotel} from '../core/reprice.js';
import {llmQueueStats} from '../providers/llm.js';
import {readHotelTaxes,closeTaxBrowser,taxQueueStats} from '../providers/hotel-taxes.js';
import {initializeUsageLog,readUsage,withPageUsage,appendUsage,currentPageUsage} from '../providers/usage.js';
import {parkingFromProvider} from '../core/public-parking.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
initializeUsageLog();
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || Number(process.env.PORT) || 8787;
const providers = await realProviders({ ratingsFallback: process.env.TRUETRIP_RATINGS_FALLBACK ?? 'llm' });
const log = (m) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const send = (res, code, body, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...CORS, ...headers }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } }); req.on('error', reject); });

const pageStarts=new Set();
const server = http.createServer(async(req,res)=>{
 try{
  const body=req.method==='POST'?await readBody(req):{};
  return await withPageUsage(body.pageLoad,()=>handleRequest(req,res,body));
 }catch(e){send(res,500,{error:String(e.message??e)});}
});
async function handleRequest(req,res,body){
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if(req.method==='POST'&&url.pathname==='/page-load'){
      const page=currentPageUsage();
      if(!page)return send(res,400,{error:'Invalid page load'});
      if(!pageStarts.has(page.id)){appendUsage({kind:'page_load',status:'opened'});pageStarts.add(page.id);}
      return send(res,200,{ok:true});
    }
    if(req.method==='GET'&&url.pathname==='/usage.json')return send(res,200,readUsage(),{'Cache-Control':'no-store'});
    if(req.method==='GET'&&url.pathname==='/usage'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      return res.end(fs.readFileSync(path.join(ROOT,'extension','usage.html')));
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, parking: parkingMode()==='search' ? 'gpt-web-search' : 'source-verified', llm: {provider:llmProvider(),model:llmModel(),concurrency:llmQueueStats(),configured:llmProvider()==='openai' ? Boolean(process.env.OPENAI_API_KEY) : true}, taxes: {background:true,queue:taxQueueStats()}, ratings: { google: Boolean(process.env.GOOGLE_MAPS_API_KEY), tripadvisor: Boolean(process.env.TRIPADVISOR_API_KEY), fallback: process.env.TRUETRIP_RATINGS_FALLBACK ?? 'llm' } });
    }
    if (req.method === 'GET' && url.pathname === '/demo') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...CORS });
      return res.end(fs.readFileSync(path.join(ROOT, 'extension', 'demo', 'booking-mock.html')));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/ext/')) {
      const f = path.join(ROOT, 'extension', path.basename(url.pathname));
      if (!fs.existsSync(f)) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : 'text/javascript', ...CORS });
      return res.end(fs.readFileSync(f));
    }
    if (req.method === 'POST' && url.pathname === '/enrich') {
      log(`enrich ${body.hotels?.length ?? 0} hotels`);
      return send(res, 200, await enrichHotels(body, providers, { log, concurrency: 3, mapLimit: providers.mapLimit }));
    }
    if (req.method === 'POST' && url.pathname === '/enrich-one') {
      log(`enrich-one ${body.hotel?.name}`);
      const r = await enrichHotels({ context: body.context, hotels: [body.hotel], settings: body.settings }, providers, { log, concurrency: 1 });
      return send(res, 200, { context: r.context, anchors: r.anchors, hotel: r.hotels[0] });
    }
    if(req.method==='POST' && url.pathname==='/hotel-taxes'){
      return send(res,200,await readHotelTaxes(body.hotel,body.context,{parkingOnly:!!body.parkingOnly}));
    }
    if(req.method==='POST' && url.pathname==='/reprice'){
      return send(res,200,{hotel:repriceHotel(body.hotel,body.details,body.settings)});
    }
    if(req.method==='POST' && url.pathname==='/hotel-research'){
      if(!['ratings','deep'].includes(body.kind)||!body.hotel?.name||!body.current?.costDrive)return send(res,400,{error:'Invalid hotel research request'});
      const hotel={...body.hotel,city:body.context?.city,lookupRatings:body.kind==='ratings',deepSearch:body.kind==='deep'};
      let updated={...body.current};
      if(body.kind==='ratings'){
        const [ratings,p]=await Promise.all([providers.ratings(hotel),body.settings?.parking?providers.findParkingFee(hotel):null]);
        updated.ratings={...ratings,requested:true};
        // Both readers consume the same combined response, so a newly found
        // parking price can improve the total without another paid lookup.
        if(p){const verified=parkingFromProvider(p);if(['ok','estimated'].includes(verified.status))updated.parking=verified;}
      }else{
        const p=await providers.findParkingFee(hotel);
        const verified=parkingFromProvider(p);
        // Keep useful parking when a deeper lookup fails.
        if(['ok','estimated'].includes(verified.status)||!['ok','estimated'].includes(updated.parking.status))updated.parking=verified;
        updated.deepSearchDone=true;
      }
      return send(res,200,{hotel:repriceHotel(updated,{},body.settings)});
    }
    if (req.method === 'POST' && url.pathname === '/notes') {
      const adjusted=applyParkingAverage(body.hotels??[],body.settings??{});
      const hotels=adjusted.hotels;
      const pageCost=readUsage().pages.find(p=>p.id===currentPageUsage()?.id)??null;
      return send(res, 200, {hotels,parkingAverage:adjusted.parkingAverage,pageCost, notes: breakEvenNotes(hotels, body.settings ?? {}), rankedByTrueCost: sortByTrueCost(hotels).map((h) => h.id) });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    log(`error ${e.message}`);
    send(res, 500, { error: String(e.message ?? e) });
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  server.close();
  await closeParkingBrowser();
  await closeTaxBrowser();
  process.exit(0);
});
server.listen(port, '127.0.0.1', () => log(`TrueTrip server on http://localhost:${port}  (demo page: http://localhost:${port}/demo?ss=Boston&checkin=2026-12-10&checkout=2026-12-11)`));
