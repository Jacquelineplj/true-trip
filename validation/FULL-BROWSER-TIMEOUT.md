# Full browser timeout investigation

2026-11-16 (America/Los_Angeles), extension 0.3.1.

The normal live test **did not reproduce a timeout**. The user-specific failure therefore remains
unattributed. A separate deliberately blocked connection test reproduced a connection-timeout message;
it is a controlled failure, not proof that the user's actual service was down.

## Normal real run

Used visible Chrome for Testing with the actual unpacked extension and a separate fresh browser profile.
Opened real Booking.com Boston results for Dec 10–11, 2026, USD, two adults, one room. Unlike earlier
three-card tests with ratings disabled, this run used the normal **12-card limit with ratings enabled**.
Model/route caches were partly warm. It is not a cold-cache performance guarantee.

- 30 actual cards captured; **12/12 enriched**.
- All enrichments rendered after **16.657 s** from test start (includes navigation/setup).
- All tax tasks complete by **16.672 s**; **12/12 cheapest-room tax lines** present.
- **24/24 anchor durations** displayed (MIT Media Lab and the Boston convention center).
- Total **18.861 s**, including sorting, original-order restore, simulated card/banner replacement,
  screenshots and verification. No duplicate panels, no unknown/unavailable/time-out text in these blocks.
- **Zero additional tabs** in the extension browser. All twelve tax reads used background HTTP;
  the local headless fallback was not needed in this run.
- No request errors recorded. No page errors. Ratings enabled does not imply every platform score was found.

| Browser background request | Count | Slowest |
| --- | ---: | ---: |
| Local service health | 2 | 92 ms |
| Hotel background HTML fetch | 12 | 2,251 ms |
| Hotel enrichment | 12 | 5,170 ms |
| Notes/parking average | 13 | 28 ms |
| Late tax repricing | 12 | 8 ms |

An independent three-request local health probe returned HTTP 200 in 48, 1 and 1 ms before the browser run.
That probe was live diagnostic output; the request-level evidence above is saved in the browser report.

Evidence: [full report](full-12-browser.json), [compact timings](full-12-summary.json).
Screenshots: `out/validation/booking-extension.png` and `booking-enrichment.png`.

## Controlled connection failure

Installed the real extension in a separate Chrome profile on the local demo. Intercepted its actual
background-worker health request without responding. No AI request was started. After **5.428 s** the
page showed:

```
TrueTrip request failed: signal timed out. Local server: http://localhost:8787
— run npm run server in the truetrip folder, then reload.
```

The assertion passed: one health request intercepted, explicit timeout error visible, no endless starting
status. This specific banner message identifies the local service connection check, not GPT execution.
A hotel-specific lookup error can have a different cause; the live user's exact error was not captured.
Evidence: [connection control](full-connection-timeout-control.json).

## Reproduce

Run the bridge, then:

```sh
TRUETRIP_TEST_MAX_CARDS=12 TRUETRIP_TEST_RATINGS=1 npm run test:browser -- --live --taxes
npm run test:startup-browser -- --extension
```

Set `TRUETRIP_PLAYWRIGHT`/`TRUETRIP_BROWSER` for the installed module and Chrome for Testing executable
when needed. The first command uses actual Booking/OpenAI/maps and can incur API charges. The second
is an artificial connection failure with no model calls. Both save reports under `out/validation/`.
Request diagnostics contain endpoint names/timing/status/property names, with no headers or URL queries.
The browser harness now saves five-second progress snapshots in `out/validation/browser-progress.json`.
