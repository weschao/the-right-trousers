# Release notes

Built from the `main` git history, grouped by week (Monday to Sunday). Latest week first.

## Week of October 5, 2026 (Oct 5 to 7, so far)

### Opponents, teams and tournaments
- **Tournaments.** A game can belong to a tournament. You enter it when starting a game and can change it from the game view. The game library and the game picker are grouped by tournament.
- **Opponent rating.** A rating field on new games, shown as "(1311)" after the opponent's name in the game view. It can be looked up from the ratings page and is stored per team. Game selection can filter to opponents rated above or below a value.

### Recording games
- **Unguarded and Unknown defenders** in the pitch tracker and matchup editor, plus a "Highlight unknown" checkbox. Older games: the first throw of a possession with no marker is set to Unguarded; other blank defenders stay Unknown. Statto imports are unchanged.
- **Goal and Turnover buttons without a player.** These record a score or turnover when you don't know who was involved. Points with an unattributed goal are left out of throws per possession and EDGE per point.
- **Unknown offense.** Games still work when the offense roster is empty. The bottom bar shows "Unknown has the disc, marked by X".
- **Filling gaps.** "Insert point" and "Add play" on the play-by-play screen for points that were missed.

### Stats
- **Player matchup breakdowns.** Click a player in game stats to see who they guarded and who guarded them: points matched up, yards gained, throwaways, breaks, and EDGE. This works for opponent players too. It is also split by opponent team.
- **Throws per possession** cards for both teams, split by possessions ending in a goal or a turnover. They expand in place. All six rate cards now fit on one row.
- **New player-stats columns:** D opp (defensive points), EDGE allowed per point, and Opp scored % (all, D-start and O-start points). Points with an unattributed goal are included in Opp scored %.
- **Expandable possessions.** In the summary view, clicking a possession shows all its events and draws only that possession on the field.

### Players and UI
- Create, edit and delete player groups from the Players page.
- A top-bar button hides or shows the sidebar. Each device remembers the setting.
- Escape goes back to the library. The game picker has a "Select all" option.
- Wording changes: "All recorded games", and "huck rate" is now "huck completion". The Games header and sidebar taglines were removed.

### Fixes
- Opponent numbers and genders now always follow the linked team's roster.
- Matchups can now be set at the start of a point.
- When the opponent is another team in your library, the game also shows up in that team's library and stats, seen from its side. All-team rates still count each game once.
- A throw with an Unguarded marker never counts as a break. Saved break flags on those throws were cleared.
- A pass's outcome (catch, goal, drop, throwaway, block, hand block or stall) and the player credited with a block can be corrected after the fact.


> **Not on `main` yet:** on/off hold rates for groups of 6, 5 or 4 players, and hold-rate +/- columns. These were merged and then reverted on Oct 7, as results are unreliable even for a full season of data. Work is saved on the `matched-on-off-hold-rate` branch. 

## Week of September 28, 2026 (Sep 28 to Oct 4)

### First release
- **Pitch tracker.** Tap where the disc went, then tap the receiver, and the app records a catch (or a goal in the end zone). Undo takes effect immediately, games can end in the middle of a point, and games can be deleted.
- **Rosters and player groups** (for example O-line and D-line). Another saved team can be the opponent, with up to seven known players per side and Unknown for the rest.
- **Statto import** of `.statto` archives.

### Stats
- **Advanced player stats:** Throw, Receive, Secondary throwing and Total EDGE (total, per point and per touch), +/-, and huck completion rate.
- **Highlight outliers** colours each stats cell by how many standard deviations it is from the column average.
- Team rate cards (hold, clean hold, turn, break and huck), a **possession heatmap**, a huck-rate-by-distance chart, and **rate trends by point number**.
- **Both teams in game stats.** The opponent table is worked out from the game seen from their side.
- New player stats: Breaks thrown, Breaks allowed, Pulls, Pulls out of bounds, Pull depth, Pull side offset.
- **Defender tracking and EDGE allowed**: Pitch tracker supports selecting a defender on every pass, or Unguarded. Automatically calculates Throw EDGE allowed (charged to the marker), Receive EDGE allowed (charged to the receiver's defender), and total EDGE allowed. Yards only count on completed passes. Throwaways, blocks and stalls cost the thrower, and drops cost the receiver.

### Defense, force and pulls
- **Defender pairing by dragging.** Speed up defender selection by dragging a defender onto a receiver, the disc holder or the player picking up; future selections of that receiver automatically label the same defender. Works with mouse and touch. Pairings carry over through turnovers (i.e., the person you're marking is assumed to mark you) and can be modified on any pass.
- **Force buttons** (Forehand, Backhand, Middle). Every pass stores the force in effect and whether it was a **break**.
- **Pulls.** The first pickup of a point asks who pulled. The app records pull depth and side offset, and a pickup within 3 yards of the brick counts as out of bounds.
- **Hand blocks** are credited to the marker. Blocks on our throws now record who made them.
- All turnovers can optionally record the intended receiver.

### Play-by-play review and editing
- **Summary view:** group events into possessions, with green and red icons for good and bad outcomes.
- You can edit starting lines, possession starts (holder, marker, location, puller), and the force or puller at the start of a point. Substitutions and force changes can be deleted. Breaks are recalculated after edits.
- **Resizable field** with a drag handle; each device remembers its width. Field stripes are drawn every 5 yards. 

### Fixes
- Substitutions were overwriting the saved starting line with the line at the end of the point. Games saved before Oct 3 may have wrong starting lines; fix them with "Edit starting lines".
- Players added to a linked opponent team after a game was created can now be picked everywhere.
- "Update calculations" on game stats now saves.
- Sorting or recalculating a stats table no longer resets the scroll position.
- A block or drop thrown into the end zone was being saved as a drop.

### Build
- The sidebar shows a build stamp. The service worker's cache version is now a hash of the build.
