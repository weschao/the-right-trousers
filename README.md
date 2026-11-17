# The Right Trousers

The Right Trousers is a shared ultimate frisbee scorekeeping app for desktop browsers, iPad, and Android tablets. It records each game as ordered play-by-play events and derives player and team statistics from those events.

During point setup, scorekeepers can create and manage named player groups such as `O-line` or `D-line`, filter the roster to one group, and keep the full selected line visible while choosing the seven players.

Games can use another saved team as the opponent. Each point records up to seven known players for both teams and represents open slots as Unknown. On the field, a destination tap followed by a receiver tap records a catch automatically, or a goal when the destination is in the attacking end zone.

Undo acts immediately. Games can finish during an incomplete point, and completed or in-progress games can be deleted from their game screen. During review, selecting a pass highlights its field segment; holding its receiver name opens a quick receiver correction.

## Run locally

```sh
npm install
npm start
```

Open `http://localhost:4173` and sign in with Google. Local and production instances use the same hosted library; editing requires internet. JSON import and export remain available for migration and backups.

## Shared library (Supabase)

Shared storage is enabled in `web/cloud-config.js`. Local, Cloudflare, and Capacitor copies use the same Supabase project; the file contains public project coordinates only. Edits require internet; IndexedDB is retained for migrating the old device library. A failed save stays visibly unsaved and never overwrites a newer server revision. Connected clients check for changes every 15 seconds.

Roles are permission bundles assigned to a team or the whole library. Players receive the team roster and server-calculated PD responses; they never receive raw game libraries. Stats users can read/create/update games, including games recorded from a linked opponent's side, but cannot open PS, delete games, or change rosters. Leadership can use PS, edit rosters, delete games, and export their authorized library. Global admins can access all libraries and manage memberships. New users can sign in but have no data access until assigned a role. The verified Google identity `weschao@gmail.com` is designated as the initial global admin by the second migration.

Provision the existing project `okxdkvpglwhbncfzuauc` in this order:

1. Apply the SQL files in `supabase/migrations/` in filename order. They create only `trt_*` tables and functions. All tables have RLS enabled and deny direct access to browser roles. The authenticated Edge Function uses Supabase's server-only service key; mutations recheck permissions in PostgreSQL and use per-record revisions, tombstones, and an audit log.
2. Deploy `supabase/functions/trt-api/index.js` as `trt-api`, using `supabase functions deploy trt-api --project-ref okxdkvpglwhbncfzuauc`. The function verifies each bearer token against Supabase Auth; gateway JWT verification is disabled in `supabase/config.toml` to support publishable API keys. For dashboard deployment, `npm run cloud:build` creates the self-contained `artifacts/cloud/trt-api.js` bundle.
3. Create a **Web application** Google OAuth client. Add `https://the-right-trousers.wes-chao.workers.dev`, `http://localhost:4173`, and `http://localhost:4174` as authorized JavaScript origins. Its authorized redirect URI is `https://okxdkvpglwhbncfzuauc.supabase.co/auth/v1/callback`. Enable Google in Supabase Authentication → Sign In / Providers and enter the client ID and secret there. The client secret never belongs in this repository or in the browser. Configure an External audience and publish the Google app when ready for users beyond its test-user list; only basic identity scopes are needed.
4. In Supabase Authentication → URL Configuration, set Site URL to `https://the-right-trousers.wes-chao.workers.dev/` and allow the exact redirects `https://the-right-trousers.wes-chao.workers.dev/`, `http://localhost:4173/`, `http://localhost:4174/`, and `righttrousers://auth/callback`. Login uses PKCE; native apps open the system browser and handle the callback through the Capacitor App plugin.
5. Test sign-in and a save with two browser sessions before deploying changes. The existing GitHub → Cloudflare build/deployment remains unchanged. The additional `.github/workflows/supabase-functions.yml` workflow tests and deploys the Edge Function on relevant pushes to `main`. Set the repository Actions secret `SUPABASE_ACCESS_TOKEN` to enable it; without that secret it reports a notice and skips deployment. The Cloudflare deployment remains independent. Database migrations are applied separately.
6. As the initial admin, open **Import & export → Review local library** on the existing device to publish its games. The review identifies differing copies of existing games, rosters, and statistics settings; choose the shared or device copy before publishing. Newer recorded game updates are suggested, and roster merges preserve unique players from both copies. Other device libraries can be reviewed the same way; this migration is explicit and does not automatically upload the startup seed. Backups remain available through JSON export.

Users sign in once with Google, then an admin assigns their team role under **Import & export → Manage access**. A team membership does not grant access to unrelated teams. A game shared by two linked teams is stored once; edits from the opponent perspective are converted back to the original recording side before saving.

Database/ACL tests run against an in-memory PostgreSQL instance through PGlite and exercise the actual migrations and API. `npm run native:sync` copies the new web assets and registers the App/Browser plugins; the native applications must then be rebuilt in Xcode/Android Studio. Native Google sign-in needs a device/simulator smoke test after the provider is configured.

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

### Enhanced Veo tracking

When creating a game with an `app.veo.co` video link, **Use Enhanced Tracker** is checked by default. Uncheck it to use the existing pitch tracker.

The enhanced tracker includes a copy of `ultimate-tracker/Both/tools/veo_field_clicker.html` and its two geometry models. Load the panorama video and lens data using the clicker’s Veo bookmark (or choose local video and `.veo` files), then place at least four field cones. Once fitted, the viewer shows play/pause and the video timeline. **Video setup** reopens calibration controls.

Point lines appear beside the video with its current timestamp filled in. Click the video to record an event’s field coordinates and timestamp; closing the event dialog resumes playback. The existing pitch underneath displays the recorded plays. Calibration and streamed video links are saved with the game; local video files must be selected again after reopening the viewer.
