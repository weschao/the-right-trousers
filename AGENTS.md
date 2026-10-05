# The Right Trousers

Ultimate frisbee stat tracker. Static web app in `web/` (no framework, minified one-line style), wrapped by Capacitor for iOS/Android.

## Running and verifying

- Wes runs the app with `npm start` (serves `web/` on port 4173) in his own terminal. **Never `pkill` serve.mjs or stop that server.** If you need your own server, use another port (`PORT=4174 node scripts/serve.mjs`); note a different port is a different origin with an empty IndexedDB.
- The service worker is network-first with a cache fallback: if the server is down, the browser silently serves stale cached files. Stale code was mistaken for bugs several times (2026-10-03).
- The sidebar shows `Build dev` when served from `web/`, or a hash and timestamp in built copies, so the running version can be checked at a glance.
- After changes: `npm test`, then `npm run native:sync` (builds `dist/` and copies into `ios/` and `android/`). The native apps still need a rebuild in Xcode / Android Studio.
- Drive the UI in the in-app browser: the pitch accepts synthetic `MouseEvent('click',{clientX,clientY})` on `#pitch`; saved data is readable from IndexedDB `right-trousers-local` / store `data` / key `library`.

## Data model notes

- Events are ordered in `game.events`; `pointsOf` groups them and applies substitutions to *copies* of the lines, so `point_start.line` stays the starting line. Before 2026-10-03 it mutated the stored array, so older saved games have post-substitution starting lines. Point `events` arrays share event references with `game.events`.
- Our-side defender fields are `opponentMarkerId` / `opponentReceiverDefenderId`; opponent-side are `markerId` / `receiverDefenderId`.
- `game.defenderPairings` is a symmetric one-to-one list of [player, player] pairs; every recorded matchup updates it, so pairings survive turnovers.
- `force` events carry the defending side; each pass stores the force in effect and a derived `break` flag (`isBreak` in core.js).
- The pull is the first `possession_start` of a point; `pullerId` lives on it and distances are derived by `pullMetrics`.
