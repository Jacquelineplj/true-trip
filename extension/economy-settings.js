// Apply cost-saving defaults to existing installations once, preserving custom limits.
globalThis.TrueTripEconomySettings=async defaults=>{
 const s=await chrome.storage.sync.get({...defaults,economyVersion:0});
 if(s.economyVersion<2){
  const change={economyVersion:2,maxCards:(s.maxCards===3||(s.economyVersion<1&&s.maxCards===12))?5:s.maxCards,...(s.economyVersion<1?{ratings:false}:{})};
  await chrome.storage.sync.set(change);Object.assign(s,change);
 }
 return s;
};
