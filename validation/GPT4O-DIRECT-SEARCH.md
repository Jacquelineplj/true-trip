# GPT-4o direct web search — 2026-11-16

> **Parking average fallback (user decision, 2026-11-16):** Hotels reporting no on-site parking now
> use the average of valid numeric quotes in the current comparison and are labeled **estimated off-site
> parking**, with the sample count. Failed/flagged/previously estimated prices do not enter the average.
> Drive totals, budgets and ranking update together; ride costs remain unchanged. 59 offline tests and
> a browser/real-aggregation fixture regression pass. Saved 30-property response replay: 22 valid quotes
> yield **$51.05/night** for the six no-parking hotels. These remain estimates, not new source quotes.
> Read [parking-average report](PARKING-AVERAGE.md). Reload the extension for the updated labels and aggregation.

Per the user's request, default parking lookup is now **GPT-4o web search → parking JSON → trip calculation**. The service does not separately fetch hotel pages, launch Chrome, enforce a hotel-domain allowlist, or parse hotel HTML in this default flow. The tested model was `gpt-4o-2024-08-06` through the Responses API's `web_search` tool.

## Runtime behavior

- `TRUETRIP_OPENAI_MODEL=gpt-4o` and `TRUETRIP_PARKING_MODE=search` are the defaults and are configured in the local ignored `.env`. Credentials stay in the Node service.
- GPT returns amount, currency, self/valet/free/none type, source URL, supporting quotation and confidence in one searched response. No local source-page availability check blocks the result.
- Hosted search can put the source URL in API citation annotations rather than the JSON field. The adapter uses actual returned citation/source URLs when the JSON contains a page title or a missing URL; it does not invent links. The first 30-property integration run exposed this formatting issue and is preserved as `gpt4o-direct-initial-format.json`.
- Basic checks still reject inconsistent amounts/quotes, impossible values and unsupported currencies. No on-site parking remains distinct from free parking. A missing off-site cost leaves the drive total incomplete.
- Evidence is explicitly `searched`, with `independentlyVerified:false`. The extension displays **GPT web search** and a clickable source, rather than saying the hotel page was independently checked. Search results are cached for six hours in a separate namespace; changing the provider/model does not reuse another model's search cache.
- The previous independent-page-fetch provider remains optional with `TRUETRIP_PARKING_MODE=verified`. Its historical stricter source-access reports do not describe the new default flow.
- GPT-4o requests omit the reasoning parameter, which is used only for compatible reasoning models. API authentication/quota failures remain explicit; no silent model fallback is configured.

## Actual tests

- **56/56 offline tests passed**, including direct-search operation without a local page fetch, API citation URL attachment, no-parking/free distinction, actual completed-search requirement, evidence expiry and GPT-4o request compatibility.
- **Fresh final 30-property audit passed the existing quality gate**: 22/30 accepted numeric fees (**73.3% coverage**); **20/20 independently scorable fee/type pairs matched**. Two accepted returns lack a settled numeric reference and are not counted as correct. Six additional properties returned no on-site/managed parking, for **28/30 resolved results (93.3%)**.
- The remaining two returns were held because their numeric value contradicted their own quotation: Wyndham Beacon Hill returned $58 while quoting $60; FOUND Copley returned $65 while quoting $59. Neither enters the trip total as an accepted fee.
- All 30 lookups used a completed real GPT-4o web search. Model-request median latency: **3,458.5 ms**, range **2,170–5,451 ms**. Geocoding/routing add their own time. Actual charges are not returned by the API; reports retain token usage and `costUsd:null`.
- Installed extension + real updated backend on the local mock page **passed**: six cards read, three provider blocks rendered, sorting/ranks and DOM replacement recovery passed. This is not a new live Booking.com search. The no-on-site-parking label/source presentation was subsequently clarified; its change passed syntax checking.

These match rates compare this sample with the existing dated independent references; they do not prove every GPT quotation is verbatim or current, nor guarantee future coverage. The source pages were deliberately not fetched again. This is the requested search-result workflow, and its provenance is retained in every result.

Reports: [final 30-property audit](gpt4o-direct-30.json), [extension integration](gpt4o-direct-extension.json), [initial formatting failure](gpt4o-direct-initial-format.json).

```bash
npm test
npm run server
TRUETRIP_PARKING_REPORT=out/validation/gpt4o-direct-final-30.json \
  npm run test:live -- fixtures/boston-parking-audit.json
```

Reload the unpacked extension to load the updated provenance label, then refresh the search page. The bridge has been restarted on localhost:8787 using GPT-4o and direct search.

Official documentation checked: [GPT-4o model](https://developers.openai.com/api/docs/models/gpt-4o), [Responses web search](https://developers.openai.com/api/docs/guides/tools-web-search). The catalog marks GPT-4o deprecated; the requested model was verified as available with the supplied account and used successfully in the real tests above.
