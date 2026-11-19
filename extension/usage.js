const money=n=>n==null?'Unknown':`$${Number(n).toFixed(6)}`;
async function refresh(){
 try{
  const response=await fetch('/usage.json',{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const d=await response.json();
  document.getElementById('summary').textContent=`Total known estimated cost: ${money(d.totalEstimatedUsd)} · ${d.pageLoadCount} page loads${d.unknownCostRequests?` · ${d.unknownCostRequests} charges unknown`:''}${d.ungroupedEstimatedUsd?` · Earlier ungrouped cost: ${money(d.ungroupedEstimatedUsd)}`:''}${d.unreadableRows?' · Some unreadable records were excluded':''}`;
  const rows=document.getElementById('rows');rows.replaceChildren();
  for(const p of d.pages??[]){
   const tr=document.createElement('tr');
   const cost=p.unknownCostRequests?(p.estimatedUsd>0?`${money(p.estimatedUsd)} + unknown`:'Unknown'):money(p.estimatedUsd);
   const values=[new Date(p.at).toLocaleString('en-US'),`${p.city||'Booking search'}${p.site==='demo'?' (demo)':''}`,p.checkin&&p.checkout?`${p.checkin} to ${p.checkout}`:'Not specified',p.hotels,cost];
   for(const value of values){const td=document.createElement('td');td.textContent=value;tr.appendChild(td);}rows.appendChild(tr);
  }
  if(!d.pages?.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='No page loads recorded yet. Open or refresh a Booking results page with TrueTrip enabled.';tr.appendChild(td);rows.appendChild(tr);}
 }catch(e){document.getElementById('summary').textContent=`Could not load page costs: ${e.message}`;}
}
document.getElementById('refresh').addEventListener('click',refresh);refresh();setInterval(refresh,5000);
