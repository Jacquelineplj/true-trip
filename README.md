# TrueTrip

A Chrome extension for Booking.com that shows the **true cost of a trip** under each hotel: room + tax + parking (or rides) + the value of your commute time to the places you need to go.

## Quick start

Requirements: [Node.js](https://nodejs.org) 20.12+ and an OpenAI API key.

```bash
git clone https://github.com/Jacquelineplj/true-trip.git
cd true-trip
cp .env.example .env        # then put your key after OPENAI_API_KEY=
npm run server              # starts the local service at http://localhost:8787
```

Keep this terminal open while you use the extension.

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension/` folder in this repo.
4. Click the TrueTrip icon in the toolbar → **Settings**: add 1–3 places you need to go, choose car or no car, and set the value of your time. Save.
5. Search for hotels on Booking.com (e.g. Boston, one night). TrueTrip adds a block under each hotel; click **Sort by true trip cost** to reorder.

After pulling updates, click the reload button on TrueTrip in `chrome://extensions` and refresh the Booking.com tab.
