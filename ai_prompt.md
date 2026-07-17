# Project Context: Edgewood Survey Tool

You are reviewing and helping incrementally develop a long-lived field survey tool.

## Project Summary

This is an offline-first mobile web app (PWA-ish, intentionally simple) used during biological surveys in a nature preserve with unreliable connectivity.

Users launch it from a home-screen shortcut on phones while in the field.

Typical use case:

* Survey begins Wednesday morning around 8 AM.
* Survey lasts ~4 hours.
* Connectivity is intermittent or absent.
* Reliability matters more than features.

The tool is intentionally conservative and boring in architecture.

Avoid framework-style thinking.

## Environment

* Distributed via GitHub Pages
* Accessed from home-screen shortcut
* Must work well on:

  * iPhone Safari
  * Android Chrome
* Poor signal is expected
* Bright sunlight and wet conditions matter

## Core Design Constraints

### Network model

The app is intentionally cache-first and runtime-offline.

Requirements:

* App shell and datasets explicitly cached
* After refresh, app must run fully offline
* Normal runtime should require no network
* Minimal or no background fetches
* No stale-while-revalidate
* No surprise browser/network behavior
* Mutable state stored locally only

### Service worker model

Strict cache-first.

Requirements:

* Explicit refresh only
* No automatic background updates
* Versioned cache names
* Deploy-time placeholder replacement in `sw.js`
* Refresh intentionally reloads app

### Data model

Reference datasets are local JSON:

Examples:

* `plants.json`
* `trails.json`
* `participants.json`

Pattern:

1. Fetch dataset
2. Validate schema
3. Normalize once at load time
4. Build in-memory lookup structures
5. Never write datasets back to localStorage

Survey data is temporary and local only.

Important:

A “survey” is a single survey event (Wednesday morning session), not persistent long-term data.

At the end of the survey a JSON or .tsv is exported.

This tool is NOT the canonical datastore.

## Storage Philosophy

Survey persistence is local-only and temporary.

Purpose:

* survive refreshes
* survive reloads
* survive browser/app crashes during a field survey

This tool is NOT the canonical datastore.

Survey state is split into independently persisted pieces:

* `phase`
* `startNote`
* `closeNote`
* `trailNotes`
* `trailLogs`
* `currentTrail`
* `surveyExists`

`surveyExists` is a commit flag owned explicitly by lifecycle operations such as New Survey and Import.

Persist immediately:

* new log/sighting entries
* survey lifecycle/phase changes
* trail changes

Persist with debounce/flush support:

* start note text
* close note text
* trail notes
* log-entry notes

Avoid suggesting “save everything constantly.”

Conservative writes are preferred, but pending writes must be flushed before refresh/export.

## Current App State Model

App-level state is resource/readiness state, not workflow intent.

States:

### BOOT

Initial startup.

Meaning:

* DOM/UI validation and boot checks are still in progress.
* Header is initially hidden in HTML.
* Once DOM refs validate and header buttons are wired, the header is shown.
* Refresh may be visible during late BOOT because it is the recovery path.

### LIMITED

The app shell is alive, but boot could not complete.

Typical causes:

* version/config unavailable
* datasets unavailable
* local data validation failed

UI:

* Header visible
* Refresh visible
* New Survey hidden
* Log/Notes hidden
* State message explains that refresh/network is required

### EMPTY

Datasets loaded, but no current survey exists.

UI:

* Header visible
* Refresh visible
* New Survey visible
* Log/Notes hidden

### ACTIVE

Datasets loaded and a current survey exists.

ACTIVE has a separate workflow phase stored on the survey object:

```js
survey.phase
```

Current phases:

* `START`
* `FIELD`
* `END`

`DONE` may exist as a constant but is not currently central.

Survey phase is workflow intent. App state is app capability/readiness.

## Active Survey Workflow

### START phase

Entered by New Survey or by reload when there is a survey but no current trail.

Behavior:

* Default view is Notes / Start Note.
* Date and time are prefilled.
* Focus advances toward the first empty start-note field.
* Trail must be selected before plant search/logging is enabled.
* `currentTrail === null`.

Controls:

* Refresh visible
* New Survey visible
* Mode/View visible
* Trail selector enabled
* Search disabled
* End hidden
* Save hidden

### FIELD phase

Entered when the first trail is selected.

Behavior:

* `currentTrail` is set.
* Search/logging is enabled.
* Trail notes are enabled.
* Default note panel becomes Trail Notes on active-entry.
* User may still manually switch notes panels.

Controls:

* Refresh visible
* New Survey visible
* Mode/View visible
* Trail selector enabled
* Search enabled
* End visible
* Save hidden

### END phase

Entered by End button.

Behavior:

* Closing note panel is shown.
* Closing time is stamped.
* Search/trail notes remain available so the user can still continue if needed.

Controls:

* Refresh visible
* New Survey visible
* Mode/View visible
* Trail selector enabled
* Search enabled
* End hidden
* Save visible

## Notes Panels

`currentNotePanel` and `survey.phase` are related but separate.

`survey.phase` answers:

* Where is the survey workflow?

`currentNotePanel` answers:

* Which notes panel is the user currently viewing?

On active-entry after reload/refresh/import, the app chooses a default note panel from phase:

* START → Start Note
* FIELD → Trail Notes
* END → Closing Note

After that, manual panel switching should not be overridden by routine rendering.

## Trail Selection

`currentTrail` may be `null`.

Meaning:

* No trail has been selected yet.
* This is normal during START phase.

Important rules:

* No default starting trail.
* Search must remain disabled until a trail is selected.
* Trail notes must not be stored without a current trail.
* `currentTrail` is persisted only to recover reload/refresh state.
* Selector DOM value uses `""` as the placeholder value; app logic uses `null`.

Current trail data is still basically a list of trails. A graph/segment-based `trails.json` is being designed but is not yet the active app model.

## UI Lifecycle Decisions

### Persistent UI (initialize once)

These exist across all states and should generally be wired once:

* Header
* Header buttons
* Message panel

Controls are shown/hidden by state.

Do not overcomplicate listener lifecycle unless necessary.

### Dynamic UI (created only when needed)

These are ACTIVE-only and may be instantiated on entering ACTIVE:

* Log view
* Notes view
* Survey-specific workspace

We are intentionally conservative about creating unnecessary UI.

## Header Design

Current direction:

Header has two sections.

### Top row

Left:

* FoE logo
* “Survey Tool”

Logo intentionally enlarged for legibility of fine detail.

Current tuned size:

* `38px`
* `40px` caused layout expansion

Right:

Stacked metadata:

Top:

* Version
* Build tag (`[DEV]` only in version)

Bottom:

* Short status text

Examples:

* `Ready`
* `Survey active`
* `Refreshing…`
* `Refresh required`

Keep status short and glanceable.

No long instructional text in header.

### Button row

Below header top:

* Refresh
* New Survey
* Mode/View
* End
* Save
* Import/debug file input, normally hidden

Visibility is controlled centrally by `renderControls()` from app state and survey phase.

### Message Panel

Below buttons.

Purpose:

Transient warnings/errors/messages.

Characteristics:

* Temporary (~30 seconds)
* Dismissible (`×`)
* Non-modal
* Not toast-like
* Suitable for sunlight and field use

Examples:

* `Refresh failed`
* `Plant data incomplete`
* `Trail data invalid`
* `Data updated`

Messages replace previous messages (no queue).

## Refresh Architecture

Refresh is explicit and user-triggered.

Two valid user meanings:

1. Recovery from bad state
2. “Get latest version before heading onto trail”

Runtime model:

* Normal runtime is cache-only.
* App/data requests should be served from cache.
* Network use should occur during boot/update checks and explicit refresh.

Refresh flow:

1. Flush pending survey saves.
2. Fetch fresh `version.json`.
3. Fetch fresh `shell-config.js`.
4. Extract `CACHE_NAME` and `APP_SHELL`.
5. Stage all app-shell files into a temporary cache.
6. Verify staged cache.
7. Commit staged cache only after all files are present.
8. Ask the waiting service worker for its `CACHE_NAME` via `GET_CACHE_INFO`.
9. Only send `SKIP_WAITING` if the waiting SW cache name matches the staged cache.
10. Reload with `location.reload()` as the hard reset boundary.

Assume:

* JS state destroyed
* UI objects destroyed
* Event listeners destroyed
* App reboots cleanly

Important:

* Old cache deletion is handled by the service worker on activate.
* `sw.js.in` should not make UI decisions.
* Cache miss responses are diagnostic JSON/504 responses.
* Desktop Chrome may expose timing issues where an old waiting SW answers first; a short retry around the cache-info handshake may be appropriate.

Prefer incremental improvements, not rewrites.

## Coding Preferences

* Vanilla JS only
* Minimal dependencies
* Readability over abstraction
* Small explicit functions
* Deterministic behavior over magic
* Conservative browser compatibility
* Incremental refactors
* Reliability > cleverness
* Maintainability > abstraction
* Performance after correctness

## Review Priorities

When reviewing code:

1. Find bugs
2. Find inefficiencies
3. Suggest architectural improvements
4. Be conservative
5. Prefer incremental refactors over rewrites

Pay special attention to:

* offline/cache correctness
* service worker lifecycle races
* stale or mismatched cache names
* state/phase confusion
* writes to localStorage at the wrong time
* UI controls visible in the wrong state/phase
* accidental writes under `currentTrail === null`

Do not propose framework architecture.

Do not recommend aggressive abstraction unless strongly justified.

This is a long-lived field tool maintained incrementally.

Avoid rewrites unless explicitly requested.
