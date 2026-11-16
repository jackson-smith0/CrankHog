# Multisport for CrankHog: design and plan

## Context

CrankHog is cycling-only. The rider (a multisport athlete) wants it to work like TrainerRoad's calendar: runs, swims and other sessions (squash) planned and logged next to rides, weekly volume split into **Ride / Run / Swim / Other**, completed activities picked up automatically after they reach Garmin, and run and swim workouts imported the way bike workouts are.

This builds on the training calendar, merged into Ray's `main` as raytfitzgerald/CrankHog#53 (from the fork's PR #4) and released in **1.0.0**. The calendar gives us:
- the Calendar page, `schedule` / `plans` / `activities` / `dayMarks` tables (Dexie v4 and v5);
- `OtherActivity` (`src/renderer/src/db/db.ts`), filled by FIT import of non-ride files (`src/renderer/src/db/fit-import.ts`, `importOtherActivity` in `src/core/fit/import.ts`), scored with hrTSS (`src/core/metrics/hr-load.ts`);
- `volumeBetween` (`src/core/workout/volume.ts`), which sums planned against done with **no sport breakdown**;
- `projectPmc` (`src/core/metrics/pmc.ts`), fed **from rides only** in `use-calendar-data.ts`;
- `IntervalsClient.plannedWorkouts` (`src/main/integrations/intervals.ts`) plus `fromIntervalsEvent` (`src/core/workout/schedule.ts`), which **skip runs and swims**.

### Appraisal: what changed between PR #4 and Ray's `main` (1.0.0)
Eight merges landed: #51 countdown beeps, #52 spin-down calibration, #53 training calendar, #54 ride clock waits for the first pedal stroke, #55 what's-new notes, #56 coasting on routes, #57 custom ride descriptions, #58 the 1.0.0 release.

- **No change to the parts this plan touches most.** `volume.ts`, `schedule.ts`, `pmc.ts`, `hr-load.ts`, `use-calendar-data.ts`, `VolumePane.tsx` and `intervals.ts` are as reviewed. CLAUDE.md and ROADMAP are unchanged. The AI still never reads `activities`.
- **Triathlon files.** FIT import now splits multisport files into legs (`splitMultisport`, `src/core/fit/import.ts`). The swim and run legs go to `activities`; the bike leg goes to `rides` with full streams. Transitions are dropped. Nothing to build here, but the sport grouping must cover these legs, and tests should include a triathlon.
- **Database.** v5 now has an `.upgrade()` that adopts the old Training plan folder (`src/renderer/src/db/legacy-plan.ts`). v6 is still the next version.
- **Backups.** `BACKUP_VERSION` is 2, and an older app refuses a newer backup. Adding `sessionWorkouts` and the new activity fields means bumping it to 3 and adding a v2 to v3 round-trip test.
- **Plans react to calendar edits.** `PlanItem` gained `movedTo` and `removed`. `moveScheduled` and `removeScheduled` (`src/renderer/src/plan/schedule-repo.ts`) write those back through `plans-repo.ts`. The plan re-lay (`plans-repo.ts`) keeps entries already done, judged by `completions()` against rides only. Plan items are bike-only (`workoutId` required). This is the main new constraint: putting runs in a plan has to fit this model.
- **Removing an activity** now asks for confirmation, with the text "Importing its file again brings it back" (`ActivityDialog.tsx`). That is wrong for activities synced from intervals.icu or entered by hand, so the text must depend on the source.
- **IPC.** `contract.ts` has a `LocalDay` schema that checks the date is a real day. Use it for every new channel that takes a date.
- **Release notes.** Each release must add an entry to `src/core/whats-new/notes.ts` (a test enforces this) and a `docs/releases/vX.Y.Z.md`. That matters only when this ships.
- **Unrelated to multisport:** the ride clock, coasting, beeps, spin-down and ride descriptions. Ride descriptions (`RideDescriptionFields.tsx`) and the new settings fields only change where new settings and copy go.
- **The fork is behind.** The fork's `main` is still 0.6.4 plus a merge commit; it doesn't have 1.0.0 yet.

### Decisions already made with the rider
- **Auto-detection comes from intervals.icu.** Garmin has no API for individuals. CrankHog keeps its public promise never to read Strava.
- **The rider must connect Garmin to intervals.icu directly.** Activities that reached intervals.icu from Strava are not returned by its API.
- **Load from every sport counts in fitness, fatigue and form.** FTP, eFTP, power curve, bests and achievements stay bike-only.

### Calls made in this plan (rider can override)
- **Separate tables.** Non-bike sessions stay in `activities`, never `rides`, so bike-only maths never sees them. Outdoor Garmin rides synced from intervals.icu also go in `activities`, grouped as Ride: they count in volume and load but have no streams or power curve.
- **AI stays rides-only.** Its context keeps reading `rides` only, never `activities`. That honours "AI gets only locally recorded data", and nothing from intervals.icu reaches it.
- **Workout format.** Run and swim workouts are written in **intervals.icu's text format**, with an optional `sport:` header. The existing text parser already recognises the tokens, intervals.icu understands the format, and it can push it to a Garmin watch. The text is the stored form, so it round-trips exactly.
- **No builder for run and swim in v1.** Import, paste, view and send only.
- **External ids** use `freegaz-plan-<entryId>`, matching the existing `freegaz-<rideId>` pattern. One `freegaz-` prefix filter then catches everything CrankHog itself sent out.

## Step 0: get onto 1.0.0
1. **Sync the fork's `main` with Ray's `main`.** Either the rider presses "Sync fork" on GitHub, or the rider tells me to push Ray's `main` to the fork's `main`. Then a PR from this branch shows only the multisport work.
2. **Rebuild `claude/quirky-johnson-72qh5k` on Ray's `main`.** It holds no commits of its own yet, so this is a plain reset.
3. **Install dependencies (`npm ci`) and run `npm run check`** so there is a green baseline.
4. **Commit this design** as `docs/superpowers/specs/2026-11-15-multisport-design.md`.

`npm run check` must stay green at every commit.

## Phase 1: sport groups, per-sport volume, combined load
- **New `src/core/sport/group.ts`:**
  - `type SportGroup = 'ride' | 'run' | 'swim' | 'other'`
  - `groupOfFitSport(sport, subSport)`: cycling → ride; running, walking, hiking → run; swimming → swim; everything else, including racket sports, → other.
  - `groupOfIntervalsType(type)`: Ride, VirtualRide, GravelRide, MountainBikeRide, EBikeRide → ride; Run, TrailRun, VirtualRun → run; Swim, OpenWaterSwim → swim; else other.
  - `SPORT_GROUP_LABEL`.
  - Tests next to it, including the legs of a triathlon file split by `splitMultisport` (swim → swim, run → run; the bike leg is already in `rides`, so it is never grouped).
- **Extend `src/core/fit/sport.ts`** labels (racket/squash, tennis and similar) so squash reads as "Squash", not "Racket".
- **New `src/core/sport/load.ts`:**
  - `activityLoad(a)` = `hrLoad ?? icuLoad ?? manualLoad ?? null`. Missing is not zero.
  - `effortLoad(durationS, effort)`: TSS per hour of 40 / 60 / 80 / 100 for easy / moderate / hard / max, for manual entries.
- **`volume.ts`:**
  - `VolumeSide` gains `bySport: Record<SportGroup, { sessions, durationS, distanceM, load }>`.
  - Inputs carry `sport: SportGroup`. Rides are always `'ride'`; activities use their group.
  - Planned entries carry the group too. Existing totals are unchanged.
- **`VolumePane.tsx`:** under Planned and Done, one compact row per sport that has volume (icon, time, distance, load). The month header gets the same breakdown. Use theme tokens only. Sport icons come from the calendar's `sport.ts`; add a racquet-style icon for Other if lucide has one.
- **Combined fitness:**
  - Add a core helper `dailyLoad(rides, activities)` → `PmcDay[]`.
  - Use it in `use-calendar-data.ts` (history), `src/renderer/src/db/fitness.ts` `pmcSeries` (Fitness page), and Home's form card and `suggestNextWorkout`.
  - Keep `realRides()` and the AI paths (`src/renderer/src/ai/client.ts`) on rides only, and add a test that pins this.
  - Update the Fitness page copy that says "rides".

## Phase 2: manual activities and planned sessions for any sport
- **Dexie v6 (`db.ts`), additive only:**
  - `activities: 'id, startedAt, sport, source, externalId'`.
  - `OtherActivity` gains `source: 'fit' | 'intervals' | 'manual'`, `group: SportGroup`, `label?` (for example "Squash"), `icuLoad?`, `manualLoad?`, `effort?`, `notes?`, `externalId?`.
  - An `.upgrade()` sets `source: 'fit'` and `group` on existing rows.
  - Chain the v6 `.upgrade()` after v5's legacy-plan upgrade; don't touch v5.
  - `backup.ts`: bump `BACKUP_VERSION` to 3. Restoring a v2 backup fills in `source` and `group` the same way the upgrade does. Add a v5 to v6 upgrade test next to `db-v5.test.ts`, and a v2 to v3 backup round-trip test.
- **`ScheduledWorkout` (`schedule.ts`) gains:**
  - `sport?: SportGroup` (missing means ride);
  - `session?: { label?, durationS?, distanceM?, effort?, load?, notes?, sessionWorkoutId?, text? }` for non-bike entries;
  - `pushedExternalId?`.
- **`completions()`** also takes activities. A non-bike entry is done when an activity of the same group starts on its day. One activity completes one entry, earliest planned first. Bike matching is unchanged. Extend `schedule.test.ts`.
  - Update every caller to pass activities: `use-calendar-data.ts`, Home's `todaysWorkout`, and the plan re-lay in `plans-repo.ts`. The re-lay keeps done entries, so it must load activities too, or a run you did would be laid out again.
- **DayDialog:**
  - **Add activity** (past and today): sport group, label, duration, distance, effort or load, notes. Saved to `activities` with `source: 'manual'`.
  - **Plan a session** (any day): the same fields, saved as a schedule entry with `sport`.
- **`ActivityDialog`:**
  - Lets you edit manual activities and shows where each activity came from.
  - The remove confirmation depends on the source. FIT: "Importing its file again brings it back" (as now). Manual: "This can't be undone." intervals.icu: "It won't come back from intervals.icu" (it goes on the hidden list from Phase 3).
- **MonthCalendar cards:** non-bike planned and done items show sport icon, label, time or distance, and load. Done, missed and planned colours behave as for rides.
- **Places that assume every planned entry is a bike workout:**
  - `PlannedWorkoutDialog.tsx`: no "Ride it" for non-bike entries; Move and Remove stay.
  - `preview.ts` and `plannedStats` in `use-calendar-data.ts`: non-bike entries get no power shape. Their time and load come from `session` (or the session workout's estimate in Phase 4).
  - `HomePage.tsx`: today's planned session may be a run. Show it with its sport icon and no ride button.

## Phase 3: auto-detect completed activities from intervals.icu
- **Main (`intervals.ts`):** `activities(oldest, newest)` → GET `/athlete/{id}/activities?oldest&newest`.
  - Trim each item to: id, start_date_local, start_date, type, name, moving_time, distance, average_heartrate, max_heartrate, icu_training_load, source, external_id.
  - Bound the item count and string lengths like `toPlanned`.
  - Mark Strava-sourced stubs (`source === 'STRAVA'`, or no moving time) as `fromStrava` instead of returning their data.
- **IPC:** add `intervals.activities` to `contract.ts` (zod) and `channels.ts`, plus a web-shim stub.
- **New renderer module `src/renderer/src/plan/intervals-activities.ts`:** `syncIntervalsActivities(now)`.
  - The first sync covers 90 days (enough for fitness to settle). Later syncs cover 14 days.
  - Skip items whose `external_id` starts with `freegaz-` (CrankHog's own uploads).
  - Skip any item within 90 s of a ride in `rides`.
  - If a FIT-imported activity sits within 90 s, attach `externalId` to it and keep its hrTSS.
  - Otherwise upsert `icu-<id>` with `source: 'intervals'`, its group, and `icuLoad`.
  - Inside the window, remove intervals-sourced rows that intervals.icu no longer has.
  - A row the rider removed locally is stored as hidden in kv (`intervals.activities.hidden`) so it doesn't come back.
  - Result: `{ added, updated, removed, fromStrava }`. Pure mapping and dedupe live in core (`src/core/sport/intervals-activity.ts`), with tests.
- **When it runs:** at app start, when the window regains focus if the last sync was more than 30 minutes ago, every 2 h while open, and from a **Refresh** button on the Calendar. The last sync time is kept in kv.
- **Settings:** a toggle in `IntegrationsSection.tsx`, "Bring in completed activities from intervals.icu" (`settings.intervalsSync.activities` in `src/shared/settings.ts`). It is off until the rider turns it on.
  - When `fromStrava > 0`, show: "N activities came from Strava, which intervals.icu can't share. Connect Garmin to intervals.icu directly."
  - Update README and Settings copy: it reads intervals.icu, it still never reads Strava, and synced activities never go to the AI.

## Phase 4: run, swim and other sessions: the import format, the guide, and where files go

The rider asked for import with very clear rules on formatting, so a file lands on the calendar the way its author expects. Bike files (`.zwo`, `.erg`, `.mrc`, `.txt` with no `sport:` line) are unchanged.

### 4.1 The format (the rules the guide states)
**One session per file.** Plain text, `.txt`, UTF-8. The file has two parts: header lines, a blank line, then the steps. The steps are intervals.icu's workout text, so the same text can be pasted into intervals.icu. The header is CrankHog's own and is removed before anything is sent to intervals.icu.

**File name.** `YYYY-MM-DD_Name.txt` puts the session on that day (for example `2026-12-02_Threshold 4x8.txt`). Without a date, the session goes to the library (or, imported into a plan, takes the next plan day). A `date:` header line overrides the date in the file name.

**Header lines** (`key: value`, one per line, any order):

| Key | Required | Values | What it does on the calendar |
|---|---|---|---|
| `sport` | yes, for anything that isn't a bike workout | `run`, `swim`, `other` | Card icon, and which weekly volume row it counts in (Run, Swim, Other) |
| `name` | no | text | Card title. Defaults to the file name without its date |
| `date` | no | `YYYY-MM-DD` | The day it goes on. Overrides the file name |
| `pool` | no, swims only | `25m`, `50m`, `25y` | Shown with the session. A distance that isn't a whole number of lengths gets a warning |
| `duration` | for a session with no steps | `45m`, `1h`, `1h15m` | Planned time |
| `distance` | no, sessions with no steps | `8km`, `5mi`, `2000mtr`, `1650y` | Planned distance |
| `effort` | no, sessions with no steps | `easy`, `moderate`, `hard`, `max` | Planned load (40 / 60 / 80 / 100 TSS an hour) |
| `notes` | no | one line of text | Shown when you open the session |

**Steps** (after the blank line):
1. A step is a line starting with `- `, then a length, then at most one target, then optional words.
2. **Lengths:** time is `30s`, `10m`, `1h`, `1h20m`, `5m30s`. **`m` always means minutes.** Distance is `400mtr` (metres), `1km`, `1.5km`, `1mi`, `100y` (yards).
3. **Targets:**
   - pace: `4:30/km Pace`, `7:15/mi Pace`, `1:45/100m Pace`, `1:35/100y Pace`, or a range `4:20-4:40/km Pace`;
   - percent of threshold pace: `95% Pace`, `90-95% Pace`;
   - pace zone: `Z3 Pace`;
   - heart rate: `Z2 HR`, `75% LTHR`, `140-150bpm`;
   - none: the step is easy. Words such as `easy`, `drill`, `kick`, `pull` or `fins` are kept as the step's note.
4. **Rest:** `- 20s rest`.
5. **Repeats:** a line ending in a count such as `Main set 4x` or just `4x` repeats the `- ` lines under it, up to the next blank line. **One level only.** To repeat a set inside a set, write it out.
6. **Section titles:** any other line (`Warmup`, `Cooldown`) is a title, shown in the step list.
7. A file with no steps is a planned session (a squash game, an easy run). It needs `duration` or `distance`.

**Examples** (shipped as files, and used as test fixtures, so the guide and the parser can't drift apart):

`2026-12-02_Threshold 4x8.txt`
```
sport: run
name: Threshold 4x8

Warmup
- 15m Z2 HR

Main set 4x
- 8m 4:10-4:20/km Pace
- 2m Z1 HR

Cooldown
- 10m Z1 HR
```

`2026-12-03_CSS 10x100.txt`
```
sport: swim
name: CSS 10x100
pool: 25m

Warmup
- 400mtr easy

Drills 4x
- 50mtr drill
- 15s rest

Main set 10x
- 100mtr 1:40/100m Pace
- 15s rest

Cooldown
- 200mtr easy
```

`2026-12-04_Squash.txt`
```
sport: other
name: Squash
duration: 60m
effort: hard
```

`Easy 8k.txt` (no date: goes to the library)
```
sport: run
name: Easy 8k
distance: 8km
effort: easy
```

**How the calendar numbers are worked out** (stated in the guide so nobody is surprised):
- **Time:** time steps add up as written. Distance steps are converted with the threshold run pace or swim threshold pace (CSS) from Settings, Athlete. Steps with no target use an easy pace (75 % of threshold pace for runs, 80 % for swims; constants in `estimate.ts`). Without the threshold, distance-only sessions show their distance and no time. Missing is not zero.
- **Load:** pace steps score by pace against threshold; HR steps score by %LTHR; zone steps by the zone's midpoint; sessions with no steps by `effort`. Without the threshold the load is blank, not 0.

**Before any of this is built:** paste each example into intervals.icu's workout editor and confirm it parses into steps, especially the `Pace` keyword, `mtr` and `y`, `rest`, and a pace range. Adjust the format to match intervals.icu where it differs, so files work in both places.

### 4.2 Core module `src/core/multisport/`
  - `model.ts`: `SessionWorkout { id, sport, name, description, text, tags, source }` and a step tree.
  - `header.ts`: reads the header lines and the dated file name (reuse `parseDatedFileName` from `src/core/workout/plan.ts`). Unknown keys are a warning, not an error.
  - `text.ts`: parses the steps with line-numbered errors and warnings, never throwing, and serialises back. Lift the shared token code from `io/text-tokens.ts` rather than duplicating it.
  - `examples/`: the four guide examples as files. Tests parse each one and check its steps, time and load, so a format change that breaks the guide fails `npm run check`.
  - `estimate.ts`:
    - Estimated duration: distance steps use threshold pace or CSS; time steps are as written. Null when a threshold is missing.
    - Estimated load: rTSS-style (pace ratio squared) for runs, sTSS-style (ratio cubed) for swims, %LTHR squared for HR targets, zone midpoints for zone targets.
  - `validate.ts`, plus tests and fixtures, including a real intervals.icu swim set.
- **Profile:** `ProfileEntry` and `AthleteSnapshot` gain optional `runThresholdPaceSPerKm` and `swimCssSPer100m`. Edit them in Settings, Athlete. Display uses the rider's units (min/km or min/mi; per 100 m or 100 yd).
- **Storage:** Dexie v6 also adds `sessionWorkouts: 'id, sport, name, updatedAt'`, included in `backup.ts`. Bike `workouts` is left alone, so `loadLibrary`, `describeWorkout` and ERG never see run or swim rows.
### 4.3 Where you import, and what happens to each file
- **Calendar page, new "Import sessions" button** (and drag and drop onto the calendar):
  - Each dated file goes straight onto its day as a planned session.
  - An undated file is not guessed at. It is listed as "No date: name it `YYYY-MM-DD_Name.txt` or add a `date:` line, or import it on the Workouts page".
  - Bike files with a date work here too, so a mixed week of rides and runs imports in one go.
- **Workouts page:**
  - `parseWorkoutFile` (`src/renderer/src/workouts/library.ts`) sends `.txt` files with a non-bike `sport:` line to the new parser. Other files are unchanged.
  - A new **Run & swim** tab holds these sessions. Cards show sport, time and distance, load, and the step list instead of a power profile.
  - "Ride it" is not offered. **Plan on day** puts the session on a chosen day.
- **Training plan tab:** files import into the plan in file-name order, dated ones on their day (Phase 4b).
- **Paste:** a "Paste a session" box on the Run & swim tab shows the parsed steps, the calendar numbers, and any errors **as you type**, before anything is saved.

### 4.4 The import report and its messages
After every import, a report lists **every file** with one line saying where it went: "on Tue 2 Dec", "in the library", "in plan Base 1", or "skipped" with the reason. Errors and warnings name the line:
- `line 6: "400m" is 400 minutes. For metres write 400mtr.` (a warning on any swim step written in minutes, and on a run step of 100 minutes or more; changed after review)
- `line 2: sport must be run, swim or other.`
- `line 9: a repeat inside a repeat isn't supported. Write the inner set out.`
- `line 4: one target per step. "Z2 HR 4:30/km Pace" has two.`
- `No steps, and no duration or distance: add "duration: 45m" or some steps.`
- `distance 160mtr isn't a whole number of 25m lengths.` (warning)
- `This is a run with distance steps, and no threshold run pace is set: it shows its distance but no time. Set it in Settings, Athlete.` (warning)

A file with errors is skipped as a whole, never half-imported. A file with only warnings is imported, and the warnings stay visible on the report.

### 4.5 The written guide
- **In the app:** a "Format guide" link next to every import button for these files (Calendar, Workouts, Training plan). It opens a dialog with the rules in 4.1, the four examples, and a "Save examples" button that writes the example files to a folder you pick, so you can copy and edit them.
- **In the repo:** `docs/WORKOUT-FORMAT.md` with the same content, linked from the README. The dialog and the doc both quote the example files from `src/core/multisport/examples/`, so they stay in step with the parser.
- Follow `docs/BRAND.md`: sentence case, no exclamation marks.

## Phase 4b: runs and swims in training plans
The rider asked for the training plan to put runs on the calendar. Plans now react to calendar edits (`movedTo` and `removed`), so this has to go through the plan model, not around it.
- **`PlanItem` (`src/core/workout/plan.ts`):**
  - Add `sessionWorkoutId?` as an alternative to `workoutId`. An item has exactly one of the two.
  - Add a helper `itemWorkoutRef(item)`, and use it in `layOutPlan`, which today only passes `workoutId` through to `Placement`.
  - Layout rules don't change. A run takes a plan day like a ride does.
  - Optional `sports?: Partial<Record<SportGroup, number[]>>` on `TrainingPlan` lets runs have their own weekdays. Without it, a run uses `rideDays`.
- **`plans-repo.ts`:**
  - The re-lay builds non-bike entries with `sport` and `session.sessionWorkoutId`, and names them from `sessionWorkouts`.
  - `refile`, `addToPlan` and `workoutNames` handle session workout ids.
  - `movePlanWorkout` and `removePlanWorkout` work unchanged, because they key on the plan item id.
- **Imports:** a dated `sport: run` file imported into a plan lands on its day, as bike files do. Undated files take the next plan day in file-name order. Every file appears in the import report described in 4.4.
- **UI:** `PlanEditor.tsx` lists run and swim items with sport icons. The workout page's **Add to plan** works for session workouts.
- **Plan builder:** the survey-based builder (`plan-builder.ts`, AI or not) stays bike-only in this work. Building a run plan automatically is out of scope.
- **Tests:** layout with mixed items; a re-lay that keeps a run you've done; moving and removing a planned run on the calendar.

## Phase 5: to the watch and back via intervals.icu
- **Main:** `upsertEvent({ externalId, date, type, name, description })` via intervals.icu's events API (bulk upsert keyed on `external_id`), and `deleteEvent(externalId)`.
  - Check the exact endpoint and fields against a real account first; the community docs disagree on details.
  - New IPC channels go in the contract, `channels.ts` and the web shim.
- **"Send to intervals.icu"** on a planned run or swim posts the text as the description, with `type` Run or Swim and `external_id` `freegaz-plan-<entryId>`. intervals.icu then pushes it to Garmin if the rider allows planned-workout upload there.
  - Moving or deleting the entry in CrankHog updates or removes the event. Hook this into `moveScheduled` and `removeScheduled` (`schedule-repo.ts`) after their plan handling, so plan runs are covered too.
  - The dialog says that a workout reaches the watch only if intervals.icu parsed it into steps.
- **Import:** extend `fromIntervalsEvent` and `importFromIntervals` to bring in run and swim events as non-bike entries carrying `session.text`, instead of skipping them. Skip events whose `external_id` starts with `freegaz-plan-` (CrankHog sent them).

## Out of scope (later)
- FIT workout file export for USB copy to a watch (already on the ROADMAP).
- A visual run and swim builder.
- Apple Health.
- The iPhone and web builds: intervals.icu needs main's secret store, so they get manual entries only.
- Strava reading (declined).

## Release
When this ships, add an entry to `src/core/whats-new/notes.ts` (a test enforces it) and write `docs/releases/vX.Y.Z.md`, as 1.0.0 did.

## Critical files
- **Core:** `src/core/sport/*` (new), `src/core/multisport/*` (new), `src/core/workout/volume.ts`, `src/core/workout/schedule.ts`, `src/core/workout/plan.ts`, `src/core/metrics/pmc.ts`, `src/core/fit/sport.ts`.
- **Main and IPC:** `src/main/integrations/intervals.ts`, `src/shared/ipc/contract.ts` (reuse `LocalDay`), `src/shared/ipc/channels.ts`, `src/shared/settings.ts`.
- **Renderer data:** `src/renderer/src/db/db.ts`, `backup.ts`, `fitness.ts`, `src/renderer/src/plan/{plans-repo,schedule-repo,intervals-import}.ts` plus new `intervals-activities.ts`, `src/renderer/src/platform/web-shim.ts`.
- **Docs:** `docs/WORKOUT-FORMAT.md` (new), README link.
- **Renderer UI:** `features/calendar/{CalendarPage,VolumePane,DayDialog,ActivityDialog,MonthCalendar,use-calendar-data,preview}` plus the new import report and format guide dialogs, `features/plan/{PlanEditor,PlannedWorkoutDialog}.tsx`, `features/home/HomePage.tsx`, `features/workouts/WorkoutsPage.tsx`, `features/settings/IntegrationsSection.tsx`, the athlete settings.

## Verification
- **`npm run check` green at every commit.** New unit tests cover: sport grouping, including triathlon legs; per-sport volume; combined daily load; AI context still rides-only; non-bike completion matching, including in the plan re-lay; plans with mixed bike and run items; source-aware remove text; v5 to v6 upgrade and v2 to v3 backup round trip; intervals activity mapping and dedupe (own uploads, FIT duplicates, Strava stubs, deletions, hidden rows); header and dated file name parsing; text parser and serialiser round trip; every guide example parses to the expected steps, time and load; every report message in 4.4 is produced by a file that should produce it; duration and load estimates, including blank (not 0) without thresholds.
- **`main/integrations/intervals.test.ts`:** fake-server tests for `activities`, `upsertEvent` and `deleteEvent`, including oversized or malformed payloads.
- **`npm run dev:web`:**
  - add a manual squash session and see it under Other in the week pane, with fitness moving;
  - import the four guide examples on the Calendar page: the three dated ones land on their days with the right icons and volume rows, and the undated one is listed as "No date";
  - import a file with `- 400m` in a run and see the line-numbered warning; import a file with two targets on one step and see it skipped with its reason;
  - type into the paste box and watch the steps, numbers and errors update;
  - open the Format guide and save the examples;
  - mark a run done by adding a run activity on that day;
  - put a plan with runs on the calendar, move one run, do another, edit the plan, and check the re-lay keeps both;
  - import a triathlon FIT file and see swim, ride and run on one day, each under its own sport.
  - Check light and dark themes and phone width.
- **E2E (`tests/e2e`):** a calendar spec for manual activity, per-sport volume and planning a run.
- **Rider, with a real account:**
  - connect Garmin directly in intervals.icu;
  - enable the sync, then record a run and a squash session and confirm they appear after Refresh;
  - send a planned run to intervals.icu and confirm it reaches Garmin Connect and the watch.

## As built (where the build differs from the plan above)
- **Plan items.** A run or swim in a plan is a `PlanItem` with `sport` set, and its `workoutId` names the session workout. That leaves `layOutPlan` untouched; there's no separate `sessionWorkoutId` field or `itemWorkoutRef` helper.
- **Per-sport weekdays** (`TrainingPlan.sports`) were not built. A run takes the plan's ride days.
- **Sending to intervals.icu** creates, updates and deletes the event by the id intervals.icu returns (`ScheduledWorkout.pushedEventId`), not by bulk upsert. The `freegaz-plan-<entryId>` external id is still sent, so an import skips sessions CrankHog sent. A 404 on update creates the event again; a 404 on delete counts as done.
- **Pool example.** The report message example uses 160 m, since 175 m is seven whole 25 m lengths.
- **Not yet tried with real services:** a real intervals.icu account (activities, sending, importing events) and the four format examples in intervals.icu's workout editor. The E2E spec `tests/e2e/multisport.spec.ts` was written but not run here.
