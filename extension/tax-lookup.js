// Share Booking page reads across parking, location and tax recovery.
(() => {
  const hasPrice=d=>Number.isFinite(d?.price)&&d.price>=0;
  const hasParking=d=>{const fee=d?.parking?.claim?.parking_fee_per_night;return typeof fee==='number'&&Number.isFinite(fee)&&fee>=0&&fee<=250;};
  const complete=d=>hasPrice(d)&&d.status==='ok'&&Number.isFinite(d.tax)&&d.tax>=0;
  const merge=(a,b)=>({...((complete(b)||!complete(a)&&hasPrice(b))?b:a??b??{}),parking:b?.parking||a?.parking||null,address:b?.address||a?.address||null,location:b?.location||a?.location||null});
  async function resolve({readHtml,readAlternateHtml,parseHtml,readBrowser,needTaxes=true,needParking=false,onDetails=()=>{},onParkingReady=()=>{}}){
    let first=null,last=null,htmlReason=null,browserReason=null,method='background-http';
    // Stop at the first usable parking quote. Otherwise both language variants
    // finish before onParkingReady permits the paid lookup to start.
    const readers=[readHtml,...(needParking&&readAlternateHtml?[readAlternateHtml]:[])];
    for(let i=0;i<readers.length;i++){
      try{
        const r=await readers[i]();
        if(r.ok&&r.data?.html){const parsed=await parseHtml(r.data);first=merge(first,parsed);onDetails(first);if(i)method='background-http-en-gb';}
        else htmlReason=r.error??r.data?.reason;
      }catch(e){htmlReason=e.message;}
      if(!needParking||hasParking(first))break;
    }
    onParkingReady(first);
    if(complete(first)||(!needTaxes&&(first?.location||first?.address||first?.parking?.claim)))return {ok:true,data:{...first,method}};
    try{
      const r=await readBrowser();last=r.data;onDetails(merge(first,last));
      if(r.ok&&(complete(last)||(!needTaxes&&(last?.location||last?.address||last?.parking?.claim))))return {ok:true,data:{...merge(first,last),taxRecovery:{attempted:true,htmlReason:first?.reason??htmlReason}}};
      browserReason=r.error??last?.reason;
    }catch(e){browserReason=e.message;}
    const best=merge(first,last);
    return {ok:true,data:{...best,status:'unknown',tax:null,reason:best.reason??browserReason??htmlReason??'Tax details unavailable from the hotel page',taxRecovery:{attempted:true,htmlReason:first?.reason??htmlReason,browserReason}}};
  }
  globalThis.TrueTripTaxLookup={resolve};
})();
