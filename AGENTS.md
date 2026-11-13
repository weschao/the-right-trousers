# The Right Trousers

Ultimate frisbee stat tracker. Static web app in `web/` (no framework, minified one-line style), wrapped by Capacitor for iOS/Android.

## Running and verifying

- Wes runs the app with `npm start` (serves `web/` on port 4173) in his own terminal. **Never `pkill` serve.mjs or stop that server.** If you need your own server, use another port (`PORT=4174 node scripts/serve.mjs`); note a different port is a different origin with an empty IndexedDB.
- The service worker is network-first with a cache fallback: if the server is down, the browser silently serves stale cached files. Stale code was mistaken for bugs several times (2026-10-03).
- The sidebar shows `Build dev` when served from `web/`, or a hash and timestamp in built copies, so the running version can be checked at a glance.
- After changes: `npm test`, then `npm run native:sync` (builds `dist/` and copies into `ios/` and `android/`). The native apps still need a rebuild in Xcode / Android Studio.
- `web/initial-data.json` (startup seed, loaded only when the library is empty) is gitignored and not copied into `dist/`, so native apps never seed. It must use `"format": "righttrousers"`; the startup check rejects anything else silently.
- Drive the UI in the in-app browser: the pitch accepts synthetic `MouseEvent('click',{clientX,clientY})` on `#pitch`; saved data is readable from IndexedDB `right-trousers-local` / store `data` / key `library`.

## Performance

- `gameOse` (season OSE for Mischief 2026), `cachedMatchupBreakdown` (all players of a game in one `matchupBreakdowns` pass) and `pointAdvancedRows` (per-point EDGE/opportunities from `pointEdgeRows`, summed for the EAPpm baselines) are cached until the next `render()` or `persist()`. Any code that edits data and then computes stats without one of those in between reads stale values. Cached breakdown rows are shared: copy before changing them.
- Time the UI in headless Chrome over CDP, not the in-app browser pane: when the pane is hidden its timings ran 3-5× slower and swung run to run (2026-11-12). Compare old against new on the same seeded data and check the HTML is identical. Style and layout of the all-teams table (~8k cells) cost ~55 ms, so `statsTable` paints the first `FIRST_PAINT_ROWS` (40) rows and leaves the rest in a `hidden` tbody that `bind` shows after the first paint. Columns did not shift on reveal for any team. Code reading the stats table must not assume one tbody or that every row is shown right after render.
- EAPpm baselines used to rerun `advancedStatsFor` on each game minus the guarded points, per player × opponent × game: 1.4 s for all teams on the 2026-11-11 library (35 games). They now sum per-point rows, which works because throwing/receiving/secondary EDGE and opportunities are point-local; `pointEdgeRows`, `advancedStatsFor` and `statsFor` share `creditPointEdges` and `pointHasOpportunity`, so keep any new point-spanning state out of those. Spreading a template into each `statsFor` row was slower than the literal (tried twice).

## Data model notes

- Events are ordered in `game.events`; `pointsOf` groups them and applies substitutions to *copies* of the lines, so `point_start.line` stays the starting line. Before 2026-10-03 it mutated the stored array, so older saved games have post-substitution starting lines. Point `events` arrays share event references with `game.events`.
- Play-by-play edit dialogs list players via `onFieldPlayers` (app.js): the line just before that event (`lineAtEvent`, core.js, subs applied in order), plus the event's stored ids so saving never drops them. With no starting line recorded (every opponent line in the 2026-11-11 library, 30 of our points) it lists the whole roster.
- Our-side defender fields are `opponentMarkerId` / `opponentReceiverDefenderId`; opponent-side are `markerId` / `receiverDefenderId`.
- `game.defenderMatchupHistory` retains symmetric [player, player] pairs, oldest to newest; recording a pair moves it to the end without discarding other matchups. Legacy games recover history from point matchups, recorded markers/defenders, and `defenderPairings`. Point assignments live in `point_start.matchups` and survive turnovers; new points assign each offensive player their most recent available defender, one-to-one. Selecting lines does not create matchups.
- `force` events carry the defending side; each pass stores the force in effect and a derived `break` flag (`isBreak` in core.js).
- Locations are copied, not linked: a pass's `from` (and a stall's `to`, a turnover's `location`) is a copy of the previous catch or pickup spot. `moveEventLocation` (play-by-play dot drag) moves the later events in the point that sit exactly on the old spot, stopping at the next possession start or the first pass that leaves it, and recomputes `break`.
- The pull is the first `possession_start` of a point; `pullerId` lives on it and distances are derived by `pullMetrics`.
- Some Statto exports write a missing player as `{}`. The converter stores `null`, and `clearBlankPlayerIds` turns any `{}` in an event's `*Id` field into `null` on startup and on JSON import (58 ids across 9 games in the 2026-11-11 library). Before that, `statsFor` built 41 empty "Unknown player" rows for them, because `{}` is truthy and each one is its own Map key.
- Heatmaps (`teamHeatmaps`): the goal-rate and touch maps replace the attacking end zone with an "End zone" label; the turnover and assist maps must show those cells, since many turnovers target the end zone (8 of 14 in one game). Turnovers count our failed passes at `to` plus our `turnover` events at `location`.

## Stats terminology

- EAPpm means Edge Allowed/point +/-.
