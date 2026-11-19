# OpenAI migration — 2026-11-16

TrueTrip now defaults to **OpenAI Responses API, `gpt-5.4-mini`**, replacing the local Claude CLI for parking URL discovery and optional rating searches. The tested API snapshot was `gpt-5.4-mini-2026-03-17`.

## Implementation and configuration

- Native Node fetch calls the official `/v1/responses` endpoint. No OpenAI SDK dependency is required. Node 20.12+ is required for local environment loading.
- `.env` is loaded automatically from the project directory; existing environment variables take precedence. The supplied key is stored locally with mode 0600 and ignored by git. The browser extension receives no key.
- Default settings: reasoning effort `none`, at most 1,800 output tokens and 3 hosted web-tool calls per request, 45-second timeout, `store:false`. Web search is required; sources, token usage, model identity and request latency are retained. Tool count/output limits bound each request, not an entire browsing session.
- URL-discovery and rating caches include provider/model identity. Parking evidence retains the separate 24-hour official / 6-hour OTA freshness checks. LLM numeric prices never enter totals directly. Official policies/FAQ pages precede overviews; read failures leave drive totals incomplete.
- The localhost bridge reports provider/model readiness without credentials and explicitly closes its source browser on SIGINT/SIGTERM, avoiding the observed browser-handler shutdown hang.
- Authentication, quota and incomplete-response errors are explicit and sanitized. No automatic fallback to Claude or a larger model, and no automatic request retries. Actual dollar charges are not returned by this endpoint; reports record `costUsd:null` and usage rather than claiming the requests were free.
- Ratings remain **searched, unverified ratings**, not Google Places/Tripadvisor API verification. Out-of-range scores, unrelated matched names, wrong platform hosts, links absent from API source metadata, and opaque Google Travel entities are rejected. An ambiguous Google result observed during migration is now omitted. Failed rating searches are not cached.

Set `TRUETRIP_OPENAI_MODEL` to select another model compatible with Responses web search and reasoning effort `none`; `--model MODEL` overrides it for the CLI. Select `TRUETRIP_LLM_PROVIDER=claude-cli` only to deliberately return to the legacy local CLI. The old `TRUETRIP_PARKING_PROVIDER=api` Anthropic switch is no longer part of the active runtime path.

```bash
npm ci
npm test
npm run server
# Explicit paid/network tests:
npm run test:openai -- --ratings
TRUETRIP_PARKING_REPORT=out/validation/openai-parking-30.json \
  npm run test:live -- fixtures/boston-parking-audit.json --refresh-sources
```

The existing local `.env` is already configured. For a fresh checkout, copy `.env.example` to `.env` and supply your own OpenAI key. Google/Tripadvisor API keys are still optional and separate. Chrome/Playwright are needed for source-page browser fallbacks.

## Executed tests and limits

- **51/51 offline tests passed**, including required search, authentication isolation, sanitized 401/429 errors, incomplete responses, no retries, source parsing, fee freshness, rating identity/URL checks, and final cost ordering.
- **Real mini-model smoke passed**: all three URL searches completed; Omni $60 and Hilton Garden Logan $25 were independently fetched and matched references. Westin was unknown because its source was inaccessible. This 2/3 result is a migration smoke test, not a citywide benchmark. [Report](openai-smoke.json).
- **Fresh 30-property audit completed** with 30 real OpenAI requests and 37 completed web-tool actions. URL-discovery median latency **3,690 ms**, range **2,730–5,827 ms**. This measures only the model request; page fetching and browser fallbacks add time. Usage: **284,310 input tokens, 5,707 output tokens**; see API billing for actual charges.
- Parking: **10/10 independently scorable fee/type returns matched**; numeric coverage **10/30 = 33.3%**; resolved coverage including two no-managed-parking policies **12/30 = 40%**. **Quality gate FAILED** because numeric coverage is below 70%; the gate was not relaxed. A 10-result conditional match rate is not proof of citywide accuracy. [Full audit](openai-parking-30.json).
- **Installed extension + real updated backend on local mock page passed**: six cards captured; three actual provider blocks rendered; sort assigned ranks; card/banner replacement recovery passed. This was a mock search page, not a new live Booking search. [Report](openai-extension.json).
- **Final rating lookup exercised the real API**: a sourced Tripadvisor link was retained as unverified; Google was omitted. This verifies integration and guards, not score accuracy. [Report](openai-ratings.json). The earlier smoke's rating payload predates these final guards and is explicitly superseded.

The earlier 6/30 source-access run and 16/21 original baseline remain historical reports. Coverage varies with website access and source URLs; these are not controlled A/B trials proving that changing models alone improves retrieval. Hilton/Marriott/OTA access failures remain the main parking release blocker. A supported parking-data source or readable traveler-session facilities terms are still needed before claiming overall acceptance.

Official documentation used: [GPT-5.4 mini model](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [Responses web search](https://developers.openai.com/api/docs/guides/tools-web-search). Model availability was also verified against the supplied account and real API requests.
