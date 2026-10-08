# EchoLink — Your Voice. Live. Anywhere.
Real phone-to-phone live microphone using `getUserMedia` + WebRTC. A Cloudflare Worker + Durable Object handles **signaling only** (rooms, offer/answer, ICE). Audio flows directly browser-to-browser and is never uploaded or stored.

Created By Shiv Yogi

## Structure
```
echolink/
├── public/ (index.html, style.css, app.js)
├── src/worker.js        # Worker + Room Durable Object
├── wrangler.jsonc
└── package.json
```

## Install & Setup
1. Install Node.js 18+ and create a free Cloudflare account.
2. `npm install` (installs Wrangler).
3. `npx wrangler login`

## Durable Object configuration
Already set in `wrangler.jsonc`: binding `ROOMS` -> class `Room`, with a `new_sqlite_classes` migration (works on the free plan). No extra setup needed.

## Local development
`npm run dev` then open the printed URL. Microphone works on `localhost`. To test with a phone use an HTTPS tunnel (e.g. `cloudflared tunnel --url http://localhost:8787`) or deploy.

## Deploy
`npx wrangler deploy` — you get a `https://echolink.<you>.workers.dev` URL.

## HTTPS & microphone permissions
Browsers only allow microphone access on **HTTPS** (or localhost). workers.dev is HTTPS. If permission is denied, allow the mic in the browser's site settings and retry. iPhone: use Safari; iOS ignores the volume slider (use device volume).

## Test with two phones
Phone 1: open site -> Start Mic -> Allow Microphone -> Create Live Room -> code e.g. `482731`
Phone 2: open site -> Join Room -> enter `482731` -> Connect (tap "TAP TO START AUDIO" if shown)
Speak on Phone 1; you hear it live on Phone 2.

## Behaviour notes
- Room code: 6 random digits (crypto), 1 sender + 1 receiver; a third device sees "Room Full".
- Empty rooms are deleted after 60 s; rooms nobody joins expire after 10 min; "End Session" deletes immediately.
- Network drops: WebSocket auto-reconnects (backoff) and WebRTC does ICE restart; UI shows "Connection lost / restored".
- STUN only (Google, Cloudflare). Very strict NATs may need a TURN server: add it to `ICE` in `public/app.js`.
- Low-end devices / reduced-motion automatically get simplified animations.
