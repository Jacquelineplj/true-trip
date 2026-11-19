chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.type !== 'read-hotel-taxes') return;
  // Availability may hydrate after document_idle. Wait only for our read-only table.
  const started = Date.now();
  const check = () => {
    const result = globalThis.TrueTripHotelTaxes.readCheapestRoom();
    if (result.price != null || Date.now()-started > 15000) { respond(result); return; }
    setTimeout(check,500);
  };
  check();
  return true;
});
