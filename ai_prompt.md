# Project Context: Edgewood Survey Tool

Read this before reviewing or changing the project. Distinguish settled design decisions from transitional code: `app.js` is presently partway through a substantial trail/log refactor and is not expected to be internally consistent everywhere yet.

## Project and Users

The Edgewood Survey Tool is a deliberately simple, offline-first mobile web app used during botanical surveys at Edgewood Park. A survey normally lasts three to six hours. Spring surveys can contain hundreds of sightings. Connectivity in the preserve is intermittent or absent.

The app is distributed through branch-specific GitHub Pages sites and is commonly launched from an iPhone home-screen shortcut. Android Chrome and desktop Chrome are also relevant. It must remain usable on screens as narrow as 320px, in bright sunlight, and under imperfect field conditions.

Reliability, clarity, and recoverability matter more than architectural fashion. Use vanilla JavaScript and conservative browser-compatible HTML/CSS. Do not introduce frameworks or elaborate subsystems without a concrete need.

Minimize external dependencies to reduce long-term maintenance and avoid coupling the application to third-party framework, package, and build-tool release cycles.

The survey tool is not the canonical datastore. Local survey data only needs to survive the current field session, browser reloads, and crashes until it is exported.

## How to Collaborate on This Project

- Do not edit files unless the user explicitly asks for an edit.
- When asked to review, diagnose and explain first.
- Prefer direct, readable code over numerous tiny helpers, deeply nested callbacks, or framework-style abstraction.
- Avoid speculative backward compatibility. There are no production legacy surveys that must be migrated; Import is a debugging aid for now.
- Prefer enforcing clear invariants over silently repairing owned reference data.
- Make incremental changes and identify stale bridge code instead of extending it.
- Do not build storage versioning, migrations, database machinery, or generalized infrastructure without a demonstrated requirement.

## Runtime and Offline Model

Reference data is shipped as local JSON:

- `data/plants.json`
- `data/trails.json`
- `data/participants.json`

The app validates and normalizes these files once during startup, then uses generated in-memory structures. Reference data is never written to `localStorage`.

The service worker is strictly cache-first during ordinary use:

- The complete app shell and datasets are explicitly cached.
- Normal runtime does not depend on the network.
- Missing cache entries return a diagnostic JSON `504`; there is no routine network fallback.
- Updates are explicit and user-triggered.
- The service worker does not automatically call `skipWaiting()`.

The refresh path fetches current version/configuration data, stages and verifies a complete new shell, coordinates with the matching installing/waiting worker, activates it, and reloads the page. Refresh requests are distinguished with the `X-Survey-Refresh` header so that only deliberate refresh traffic bypasses the cache. A reload is the clean boundary: all JavaScript state, DOM nodes, and listeners are recreated.

When debugging apparently stale HTML or inline CSS, remember that an old service worker may be serving the cached document. DevTools' ordinary “Disable cache” does not necessarily bypass Cache Storage.

## Application State and Survey Phase

Application state describes whether the application can operate:

- `BOOT`: initialization is underway.
- `LIMITED`: the shell is alive, but required version/configuration/reference data could not be loaded or validated. Refresh is the recovery control.
- `EMPTY`: reference data is ready, but there is no current survey.
- `ACTIVE`: reference data and a current survey are available.

An active survey separately records its workflow phase in `survey.phase`:

- `START`: survey created; starting information is being entered; there is no current leg.
- `FIELD`: a starting segment has been selected and sightings can be recorded.
- `END`: the current leg has been completed, ending time/weather are being finished, and saving/export is available when required information is complete.

Phase is explicit persisted state. User actions change it through `setSurveyPhase()`. Reload validation should reject inconsistent state rather than routinely synthesize phase from other fields.

There is one intentional cusp: clicking Start switches to the Log view to choose a starting segment, but phase remains `START` until that segment is chosen. If the app reloads during this cusp, returning to the START Notes view and requiring Start to be clicked again is harmless.

## Intended Survey Workflow

1. From EMPTY, New Survey creates and immediately persists a new survey.
2. Date and starting time are prefilled; Notes is shown.
3. Start remains disabled until date, participants, start time, and start weather are present.
4. Start switches to Log and opens the starting-segment choices.
5. Choosing a starting segment creates `route.currentLeg` and enters FIELD.
6. Search results add sightings to `currentLog`, most recent at the top.
7. Next opens predicted segment choices. Choosing one completes the current leg and starts another.
8. End normally occurs back at the starting location. Ending elsewhere is allowed only through exceptional confirmation.
9. End completes the current leg, records end time, enters END, switches to Notes, and focuses end weather.
10. Save/export becomes enabled when all required start and end information is complete. General notes remain optional. Saving does not automatically clear the displayed survey.

New Survey remains available for deliberate replacement of the current survey, with confirmation (and potentially stronger warning during FIELD). Refresh remains available in every application state.

## Interface Direction

The target header is compact:

```text
[Notes/Log] [Start/Next/End/Save]        [New Survey] [Refresh]
```

The phase actions are separate buttons occupying the same area through show/hide rules:

- START notes: Start
- START while choosing a starting segment: the starting selector; Next and End are not actionable
- FIELD: Next and End
- END: Save

Most controls are left-aligned. New Survey and Refresh are grouped at the right. Wrapping is acceptable on very narrow screens if it preserves operability.

There are two principal views:

- Notes: one combined survey-notes form.
- Log: search, current/past leg headers, and sightings.

The separate Route view is being removed. Route review will be integrated into the Log view.

The Notes view contains date; participants with name suggestions; start time and weather on one row; end time and weather on one row; and one general notes textarea. End fields remain disabled until END. The old per-trail notes and notes-side trail selector are gone.

The intended Log layout is:

```text
Search
Current leg header
Newest current-leg sightings
...
Previous leg header
Newest sightings from that leg
...
```

Sightings are stored chronologically but displayed newest first. Completed legs are stored chronologically but displayed newest leg first. Leg headings may become sticky as the user scrolls. Focusing the main search should return the log to the newest part of the current leg.

Each historical entry will eventually have a small Edit control offering Delete, Edit, and Insert below. Historical insertion/editing can reuse species-search behavior through a separate popup search field; the main search always adds to the current leg.

## Trail Network Terminology

- **Trail**: a named physical pathway, such as Edgewood or Clarkia.
- **Post**: a network node/intersection. Some posts have descriptive display names such as Four Corners.
- **Segment**: one physical portion of a trail between two posts.
- **Directed segment**: one traversable direction of a physical segment.
- **Ray/current leg**: current trail, starting post, and initial direction before its actual endpoint is known.
- **Completed leg**: the stretch of one trail traveled from the first selected post to the post where the user switches trails or ends. It may span several physical segments.

The user should not have to record every post passed. When Next is selected, the chosen option says at which post the user left the current trail; the stored path associated with that option supplies the intervening physical segments and distance.

Segments may be traversed repeatedly, including in reverse. Immediate backtracking is uncommon and should appear as an explicit U-turn choice, normally last. Do not globally suppress previously traversed segments.

Special network facts:

- `garden` is both a post/location and a zero-length self-loop segment.
- Other zero-length self-loops are not forbidden merely because garden is currently the known case.
- Inspiration Point and Lost Trail include dead ends.
- Two named trails can meet at more than one place (notably Clarkia and Sunset).
- A route may leave a trail and rejoin it later.
- Physical segments are bidirectional; directed copies are generated once at load time.
- Lengths in `trails.json` are miles and use the field name `length`.

## Trail Reference Data and Runtime Structures

`trails.json` has four required, nonempty arrays: `trails`, `posts`, `segments`, and `startingPoints`.

Because the project owns this small, stable network, validation is deliberately strict. Parse as much as possible, collect clear path-specific errors, and refuse to run until the file is clean. Validate unexpected fields and duplicates as well as required values and references.

Normalized trail and post tables are simple ID-to-display-name objects:

```js
trailNetwork.trails = {
  edgewood: "Edgewood",
  clarkia: "Clarkia"
};

trailNetwork.posts = {
  P4: "P4",
  P11: "Four Corners"
};
```

No reverse lookup by display name is currently needed. Membership is tested directly with `Object.hasOwn(object, id)`.

Every validated physical segment produces one or two directed segment objects at load time:

```js
{
  id: "edgewood.P4.P5",
  trailId: "edgewood",
  fromPost: "P4",
  toPost: "P5",
  length: 0.12
}
```

A non-self-loop produces its reverse as well. `sourceIndex` is being removed; directed segment identity and reverse lookup should use segment fields/IDs. Segment and completed-leg IDs use:

```js
function makeLegId(trailId, startPost, endPost) {
  return `${trailId}.${startPost}.${endPost}`;
}
```

`segmentsByPost` is a `Map` from `fromPost` to the outgoing directed segments. This is the principal traversal index.

JSON starting points identify a `{postId, trailId}` pair. Load-time processing resolves each pair to exactly one outgoing directed segment. The resulting `trailNetwork.startingSegments` is an array of those directed segment objects in JSON order. There are only a few starting choices; do not add a map merely to optimize four objects.

The intended `trailNetwork` is:

```js
{
  trails,             // { trailId: displayName }
  posts,              // { postId: displayName }
  directedSegments,   // directed segment objects
  segmentsByPost,     // Map<postId, directedSegment[]>
  startingSegments    // directed segment objects, JSON order
}
```

## Predictive Next-Segment Selector

Clicking Start or Next populates and displays the same segment selector. Its displayed options are kept temporarily in a script-level `segmentChoices` array; `<option>.value` contains the corresponding array index. This is derived UI state and is not persisted.

For a current ray, choices are ordered by walking forward along its trail:

1. Other trails leaving the first reachable post.
2. Other trails leaving the next post along the current trail.
3. Continue similarly while the current trail has an unambiguous continuation.
4. Add the immediate U-turn as the final choice.

Each menu choice carries enough derived information to complete the current leg without recalculating the traversal:

```js
{
  kind: "start" | "turn" | "uturn",
  atPost: "P5",
  path: [/* directed segments traversed before taking nextSegment */],
  nextSegment: { /* directed segment beginning the new leg */ }
}
```

Starting directed segments are wrapped in the same choice shape before display. The formatter must use the current lookup objects directly:

```js
trailNetwork.trails[segment.trailId]
trailNetwork.posts[segment.toPost]
```

It must not use obsolete `trailById`/`postById` objects or `.name` properties.

The native selector is hidden after a choice. Populating it should unhide it. `focus()` alone does not open a native `<select>`; `showPicker()` may be attempted synchronously during the Start/Next click, with focus as the fallback. Native iOS picker appearance and opening behavior remain partly controlled by WebKit. Use `color-scheme: light` where a dark native picker is undesirable.

## Survey and Log Model

The target in-memory survey shape is:

```js
survey = {
  phase: SURVEY_PHASE.START,
  notes: {
    date: "",
    participants: "",
    startTime: "",
    startWeather: "",
    endTime: "",
    endWeather: "",
    notes: ""
  },
  route: {
    currentLeg: null,
    legs: []
  },
  currentLog: [],
  completedLogs: {}
};
```

`route.currentLeg` is a ray/unfinished leg object during FIELD. `route.legs` contains completed leg objects in chronological order. Route objects hold location/path/distance/timing metadata; sightings are kept separately.

`currentLog` is the sighting array for the unfinished current leg. `completedLogs[legId]` is the sighting array for a completed directed leg. If the same directed leg ID is traversed more than once during one survey, its observations may be amalgamated: if a plant was observed on that stretch that morning, separate passes do not need separate sighting bins.

When changing trails or ending:

1. Convert the current ray into a completed leg by assigning its actual endpoint, total length, and final ID.
2. Merge/copy `currentLog` into `completedLogs[leg.id]`.
3. Append the completed leg object to `route.legs`.
4. Persist the completed log and route in an order chosen to minimize sighting loss.
5. Replace `survey.currentLog` with a new empty array and persist `logs.current`.
6. On Next, create the next current ray from the selected directed segment; on End, leave `currentLeg` null.

Replacing the current-log array is preferable to mutating its length because rendered handlers may still hold references. When a current leg becomes completed, initially favor re-rendering only that newly completed section so entry handlers acquire the correct completed `legId`. Do not re-render every historical row on every sighting or transition. A large leg can contain roughly 100–120 entries, which should still be inexpensive enough to render once at transition; measure before adding optimization machinery.

## Persistent Survey Storage

Storage is branch/release scoped by `STORAGE_TAG`. Logical keys are:

```text
phase
notes
route
logs.current
logs.<legId>
surveyExists
```

`surveyExists` is the explicit commit/presence flag created by survey lifecycle operations. New Survey creates every required section immediately, including an empty `logs.current`. Therefore, a missing required section during load is corruption, while a stored empty array is valid.

`route.legs` is the index for completed log records. Do not scan localStorage for key prefixes to reconstruct a route, and do not store redundant route identity inside each log merely to make such scanning possible.

Persistence timing:

- Store a new sighting immediately.
- Store deletion and substantive entry edits promptly; note typing may be debounced but must be flushable.
- Store phase and route transitions immediately.
- Flush pending notes before refresh, transitions, and export.
- Do not persist generated selector choices or other reconstructible UI state.

`clearStoredSurvey()` intentionally clears all keys for the current `STORAGE_TAG` through `clearAppStorage()`. Load/recovery policy belongs in `loadSurvey()`, not in the clearing routine. Developers can clear stale branch test data manually through browser site settings; no survey schema-version migration system is planned.

## Current Transitional State

The target structures above are not fully wired through `app.js`. When reviewing current code, expect and call out remnants rather than treating them as design commitments. Known transition areas include:

- Some trail-transition routines still use an obsolete `currentLeg.segments` wrapper or top-level `survey.currentLeg` instead of `survey.route.currentLeg`.
- Some traversal code still refers to removed `sourceIndex` identity.
- Some rendering and entry-edit routines still expect the former trail-log object shape (`{firstEntered, entries}`) instead of arrays keyed by `legId`.
- The current Log renderer is not yet the planned combined current/completed-leg stack.
- Starting-segment display is newly being integrated with Start, Next, `segmentChoices`, and the native selector.
- Export/TSV and Import deliberately lag behind the new storage model and should be repaired after core field workflow and persistence are coherent.
- `VIEW.ROUTE` or `ui.route` remnants may still exist in JavaScript even though the separate Route option/view is being removed from the interface.

Do not repair these areas by reintroducing `currentTrail` or trail-wide sighting bins. Move them toward the leg-based model.

## Review Priorities

When reviewing or proposing the next change, prioritize:

1. Bugs that can lose sightings or corrupt route/log persistence.
2. Invariants at survey phase and leg transitions.
3. Offline/cache coherence and service-worker lifecycle races.
4. Correct controls and fields for the current state/phase.
5. Clear separation of physical segments, completed legs, and sighting logs.
6. Readability and removal of stale bridge code.
7. Performance only where measurement shows a field-visible problem.

Keep the app understandable to a human maintainer. The network is small and stable, updates are infrequent, and most routines run on explicit user actions. A few straightforward loops and lookups are usually preferable to clever caching or generalized abstractions.
