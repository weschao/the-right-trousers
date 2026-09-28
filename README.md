# Fieldbook

Fieldbook is an offline-first ultimate frisbee scorekeeping app for desktop browsers, iPad, and Android tablets. It records each game as ordered play-by-play events and derives player and team statistics from those events.

## Run locally

```sh
npm install
npm start
```

Open `http://localhost:4173`. The app stores its working library in IndexedDB and supports portable JSON import and export.

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

`web/core.js` defines the versioned Fieldbook JSON format, validation, game state reducer, and stat calculations. A game contains an ordered `events` array with point starts, possession starts, passes, turnovers, and point results. Field coordinates are stored in yards on a 110 × 40 field, including 20-yard end zones.

The app also imports `.statto` archives. These are ZIP files containing `data.json`; the importer converts their teams, rosters, games, points, possessions, and passes while retaining the original source records. Historical Statto exports do not include full opponent passing sequences or defender assignments, so defensive yardage is unavailable for those games.

The sample archive and its converted contents are deliberately excluded from Git by `.gitignore`.
