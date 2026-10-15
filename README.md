# The Right Trousers

The Right Trousers is an offline-first ultimate frisbee scorekeeping app for desktop browsers, iPad, and Android tablets. It records each game as ordered play-by-play events and derives player and team statistics from those events.

During point setup, scorekeepers can create and manage named player groups such as `O-line` or `D-line`, filter the roster to one group, and keep the full selected line visible while choosing the seven players.

Games can use another saved team as the opponent. Each point records up to seven known players for both teams and represents open slots as Unknown. On the field, a destination tap followed by a receiver tap records a catch automatically, or a goal when the destination is in the attacking end zone.

Undo acts immediately. Games can finish during an incomplete point, and completed or in-progress games can be deleted from their game screen. During review, selecting a pass highlights its field segment; holding its receiver name opens a quick receiver correction.

## Run locally

```sh
npm install
npm start
```

Open `http://localhost:4173`. The app stores its working library in IndexedDB and supports portable JSON import and export.

## Game videos

Set a Video Link when creating a game, or use Add/Edit Video Link on the game screen. YouTube descriptions are fetched on save and stored with the game for offline review. Point lines use `0:18 [0-0] receive` or `5:00 [1-1] pull`; scores are checked at point starts using both team orders. A mismatch shows a warning and hides timestamped point links. Finished games require one timestamp per point. Veo (`app.veo.co`) accepts one `M:SS` or `H:MM:SS` timestamp per line, in point order. The Point video link beside the play-by-play point selector follows the selected point.

Automatic YouTube loading uses the local server endpoint `/api/youtube-description` or Capacitor HTTP in native apps. Restart `npm start` after updating the server. Static-only hosting needs an equivalent endpoint; the video editor also accepts a pasted description if fetching is unavailable or YouTube blocks the request. Reload from YouTube refreshes the saved description when the game is saved.

## Test and build

```sh
npm test
npm run build
```

The static web app is written to `dist/`. To refresh the generated web assets in both native projects:

```sh
npm run native:sync
```

Open the native projects with `npx cap open ios` or `npx cap open android`. Building iOS requires Xcode; building Android requires Android Studio and a compatible JDK/SDK.

## Data model

`web/core.js` defines the versioned JSON format, validation, game state reducer, and stat calculations. Optional game fields `videoLink`, `videoDescription`, `videoTimestamps`, and `videoFetchError` are preserved in JSON exports. A game contains an ordered `events` array with point starts, possession starts, passes, turnovers, and point results. Field coordinates are stored in yards on a 110 × 40 field, including 20-yard end zones.

The app also imports `.statto` archives. These are ZIP files containing `data.json`; the importer converts their teams, rosters, games, points, possessions, and passes while retaining the original source records. Historical Statto exports do not include full opponent passing sequences or defender assignments, so defensive yardage is unavailable for those games.

The sample archive and its converted contents are deliberately excluded from Git by `.gitignore`.
