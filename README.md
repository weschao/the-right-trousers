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

`web/core.js` defines the versioned JSON format, validation, game state reducer, and stat calculations. A game contains an ordered `events` array with point starts, possession starts, passes, turnovers, and point results. Field coordinates are stored in yards on a 110 × 40 field, including 20-yard end zones.

The app also imports `.statto` archives. These are ZIP files containing `data.json`; the importer converts their teams, rosters, games, points, possessions, and passes while retaining the original source records. Historical Statto exports do not include full opponent passing sequences or defender assignments, so defensive yardage is unavailable for those games.

The sample archive and its converted contents are deliberately excluded from Git by `.gitignore`.

## Adjusted hold ratings

Player Stats uses separate Gaussian-prior logistic adjusted-plus-minus models for O-start holds and D-start opponent holds (`web/adjusted.js`). Positive hold ratings and negative opponent-hold ratings are favorable. The old 6/5/4 shared-teammate tables remain descriptive detail; their overlapping samples are not blended into the headline estimate. The former 10-point display gate does not apply to adjusted ratings.

Each completed point contributes one binary outcome. A point requires seven distinct, known roster players and no our-side substitution. Coverage reports excluded lines and substitutions. On each start, opponent player effects are included only for games with complete, unsubstituted opponent lineups on every eligible point. Otherwise only opponent-team and game context are adjusted. Opponent identity uses a linked team ID, falling back to the normalized opponent name; opponent player IDs are scoped to that opponent. Historical inaccurate line records cannot be repaired by this model.

For point i in game g, the log odds are an intercept, an opponent-team effect, a game effect, and the sum of player effects times their on-field indicators **minus their within-game average indicators**. Complete opponent lineups receive the same centering. This uses within-game lineup changes to identify player effects and avoids treating a player's attendance at easier games as evidence of their impact. It still assumes additive, stable effects and cannot control unrecorded opponent matchups, fatigue, selection decisions, or interactions.

Independent, zero-mean Gaussian priors have SD 2.5 for the intercept, 0.75 for opponent context, 1.0 for game context, and 0.35 for opponent players (log-odds units). Own-player SD is selected from 0.15, 0.35 and 0.7 using whole-game predictive log loss, with a provisional 0.35 default when fewer than two games are available. These are explicit modeling assumptions, not research-established ultimate constants. The detail view reports the estimate range under all three own-player priors.

The comparison pool consists of players with within-game on/off variation on the relevant start. For each game context, center their fitted effects on the pool mean and compute a reference hold probability for each player. The rating is that player's probability minus the average probability of the *other* pool members, averaged over the same game contexts for every player, weighted by included points, and multiplied by 100. This is a standardized replacement contrast, not a forecast for a particular legal seven-player lineup; roles and gender restrictions are not modeled. Players without within-game variation receive no numeric rating. A row-space diagnostic flags contrasts that are not fully identifiable, including players who always play together or are perfectly associated with an opponent lineup.

Fits use penalized Newton optimization. Approximate 95% credible intervals use 1,024 reproducible draws from the **joint Laplace posterior**, including player/context covariance, then transform each draw to percentage points. They are conditional on the selected prior and model, not full Bayesian sampling or game-cluster-robust confidence intervals. Variance reduction is `1 − posterior contrast variance / prior contrast variance`; it measures information supplied by the data, not the probability that the rating is correct. Residual within-game dependence and model/prior selection uncertainty can make intervals optimistic.

With at least three games, a nested, deterministic, grouped cross-validation compares player effects with a context-only baseline on the same eligible points. Outer folds hold out whole games (up to five folds); own-player prior selection occurs only inside the training games (up to four inner folds). Baseline and full models share opponent-player adjustment where available. Held-out game effects are integrated over their prior, as are unseen opponent effects; held-out outcomes are never used for fitting or tuning. Lineup centering uses the held-out game's observed lineup schedule, so this is a retrospective check with lineups known, not a pregame forecast. Results are point-weighted log loss and Brier scores; a small improvement is exploratory evidence, not a significance test or proof of individual causation. No improvement and insufficient games are explicitly reported.

A module worker keeps fitting and nested validation off the UI thread. The cache keys the complete point-level analysis snapshot, so changing outcomes, lineups, the roster or selected games invalidates the relevant result. New modules are included in the service-worker offline cache and native builds.

The methodological basis is regularized adjusted plus-minus and predictive validation ([Sill, 2010](https://www.sloansportsconference.com/research-papers/improved-nba-adjusted-using-regularization-and-out-of-sample-testing)), with logistic shrinkage for binary sporting outcomes ([Gramacy, Jensen and Taddy](https://arxiv.org/abs/1209.5026)). Those studies motivate the approach; they do not validate these priors or these ratings for ultimate.
