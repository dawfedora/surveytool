"use strict";

// --- GLOBAL STATE ---
const APP_STATE = {
  BOOT: "BOOT",
  EMPTY: "EMPTY",
  ACTIVE: "ACTIVE",
  LIMITED: "LIMITED"
};
let appState = APP_STATE.BOOT;

const SURVEY_PHASE = {
  START: "start",
  FIELD: "field",
  END: "end",
  DONE: "done"
};

const VIEW = {
  LOG: "log",
  NOTES: "notes",
  ROUTE: "route"
};
let currentView = VIEW.LOG;

const ui = {
  header: {},
  message: {},
  log: {},
  notes: {},
  route: {}
};

let  STORAGE_TAG = null;


let version = null;
let species = [];
let trails = [];
let trailNetwork = {};
let participants = [];
let survey = null;
let currentTrail = null;
let messageTimeoutId = null;
let headerInitialized = false;
let logViewInitialized = false;
let notesViewInitialized = false;
let pendingStores = [];
let activeChoiceOverlay = null;

const UPDATE_CHECK_TIMEOUT_MS = 5000;

const storeNotesLater = flushableDebounce(storeNotes, 1500, pendingStores);
const storeTrailLogsLater = flushableDebounce(storeTrailLogs, 1500, pendingStores);

document.addEventListener("DOMContentLoaded", init);

// --- APP STARTUP ---
async function init() {

  appState = APP_STATE.BOOT;

  initUI();

  // Validate DOM
  const missing = validateUI(ui);
  if (missing.length) {
    console.error("Missing DOM elements:\n" + missing.join("\n"));
    return;
  }

  // wire the buttons, especially refresh
  initHeader();

  renderControls();
  ui.bootFallback.hidden = true;
  ui.header.panel.hidden = false;

  // Version
  try {
    version = await loadVersion()
    showVersion();
  } catch(e) {
    console.error("Version load failed", e);
    showMessage("Version and config data not available\n");
    setAppState(APP_STATE.LIMITED);
    return;
  }

  STORAGE_TAG = version.storageTag;

  // Update Check before going into the field
  const latest = await checkForUpdate();
  if (latest) {
    const doUpdate = await chooseAction(
      `Newer version ${latest.version} is available.\n\nRefresh now?`, [
        { value: true, label: "Refresh Now" },
        { value: false, label: "Use current" }
    ]);
    if (doUpdate) {
      refreshApp();
      return;
    }
  }

  if (version.branch !== "main") {
    document.title += ` [${version.branch.toUpperCase()}]`;
  }

  // Load datasets
  const ok = await loadLocalData();
  if (!ok) {
    setAppState(APP_STATE.LIMITED);
    return;
  }

  survey = loadSurvey();

  if (!survey) {
    setCurrentTrail(null);
    setAppState(APP_STATE.EMPTY);
    return;
  }

  initializeCurrentTrail();

  setAppState(APP_STATE.ACTIVE);
}

function showVersion() {
  let displayVersion = '';

  if (version.branch == "main")
    displayVersion = version.version.replace(/^main:/,"V");
  else
    displayVersion = version.version.replace(/:/,"");

  ui.header.version.textContent = displayVersion;
}

function setStatus(text) {
  ui.header.status.textContent = text;
}

async function checkForUpdate() {

  if (!navigator.onLine)
    return null;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    UPDATE_CHECK_TIMEOUT_MS
  );

  try {
    const latest = await loadVersion(true, controller.signal);

    if (!version)
      return latest

    if (latest.version === version.version)
      return null;

    return latest;

  } catch (e) {
    if (e.name === "AbortError")
      console.warn(`Update check timed out after ${UPDATE_CHECK_TIMEOUT_MS / 1000} seconds`);
    else
      console.warn("Update check failed", e);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function setAppState(state) {
  const previousState = appState;
  appState = state;

  if (previousState !== state)
    console.log(`App state changed: ${previousState} -> ${state}`);

  switch (state) {
    case APP_STATE.LIMITED:
      renderLimitedState();
      break;
    case APP_STATE.EMPTY:
      renderEmptyState();
      break;
    case APP_STATE.ACTIVE:
      renderActiveState();
      break;
  }
}

// Future state/debug hook.
// eslint-disable-next-line no-unused-vars
function getAppState() {
  return appState;
}

function renderEmptyState() {
  ui.log.panel.hidden = true;
  ui.notes.panel.hidden = true;

  renderControls();

  setStatus("No Survey");
  setStateMessage("No current survey. Press New Survey to start one.");
}

function renderLimitedState() {

  ui.log.panel.hidden = true;
  ui.notes.panel.hidden = true;

  renderControls();

  setStateMessage("Survey tool is not complete. Connect to the net and press Refresh.");
  setStatus("Refresh required");

  return; // STOP HERE
}

function renderActiveState() {
  initLogView();
  initNotesView();

  initializeSurveyPhase();

//  if (survey.phase === SURVEY_PHASE.START)
//    currentNotePanel = NOTE_PANEL.START;
//  else if (survey.phase === SURVEY_PHASE.END)
//    currentNotePanel = NOTE_PANEL.CLOSE;
//  else
//    currentNotePanel = NOTE_PANEL.TRAIL;

  syncTrailSelectors();
  renderControls();
  renderView();

  clearStateMessage();
  setStatus("Active Survey");
}

function renderControls() {
  const active = appState === APP_STATE.ACTIVE;

  ui.header.refreshBtn.hidden = false;

  ui.header.newBtn.hidden = !(appState === APP_STATE.EMPTY || active);
  ui.header.viewSelect.hidden = !active;

  ui.header.endBtn.hidden = !(active && survey.phase === SURVEY_PHASE.FIELD);
  ui.header.saveBtn.hidden = !(active && survey.phase === SURVEY_PHASE.END);

  ui.log.search.disabled = !(active && survey.phase !== SURVEY_PHASE.START);
  ui.log.trailSelect.disabled = !active;
}

// --- UI Wiring ---
function initUI() {

  ui.bootFallback = document.getElementById("bootFallback");

  ui.header = {
    panel: document.getElementById("globalHeader"),
    viewSelect: document.getElementById("viewSelect"),
    newBtn: document.getElementById("newBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    endBtn: document.getElementById("endBtn"),
    saveBtn: document.getElementById('saveBtn'),
    importBtn: document.getElementById("importBtn"),
    importInput: document.getElementById("importInput"),
    version: document.getElementById('version'),
    status: document.getElementById('status')
  };

  ui.message = {
    panel: document.getElementById("messagePanel"),
    text: document.getElementById("messageText"),
    dismissBtn: document.getElementById("dismissMessageBtn"),
    statePanel: document.getElementById("stateMessagePanel")
  };

  ui.log ={
    panel: document.getElementById('logView'),
    trailSelect: document.getElementById('logTrailSelect'),
    search: document.getElementById('search'),
    clearSearch: document.getElementById('clearSearch'),
    results: document.getElementById('results'),
    log:  document.getElementById('log'),
  };

  ui.notes = {
    panel: document.getElementById('notesView'),
    date: document.getElementById('date'),
    participants: document.getElementById('participants'),
    startTime: document.getElementById('startTime'),
    startWeather: document.getElementById('startWeather'),
    endTime: document.getElementById('endTime'),
    endWeather: document.getElementById('endWeather'),
    notes: document.getElementById('notes')
  };
}

function validateUI(obj, path = 'ui') {
  const missing = [];

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = `${path}.${key}`;
    if (value && typeof value === 'object' &&
        !(value instanceof HTMLElement)) {
      missing.push(
        ...validateUI(value, currentPath)
      );
    } else if (!value) {
      missing.push(currentPath);
    }
  }
  return missing;
}

function initHeader() {
  if (headerInitialized)
    return;
  headerInitialized = true;

  // Hook up buttons
  ui.header.viewSelect.addEventListener('change', event => {
    currentView = event.target.value;
    renderView();
  });
  ui.header.newBtn.addEventListener('click', newSurvey);
  ui.header.refreshBtn.addEventListener('click', refreshApp);
  ui.header.saveBtn.addEventListener('click', saveSurvey);
  ui.header.endBtn.addEventListener('click', endSurvey);
  ui.header.importBtn.addEventListener('click', () => {
    ui.header.importInput.click();
  });
  ui.header.importInput.addEventListener('change', importSurveyFile);
  ui.message.dismissBtn.addEventListener("click", clearMessage);
}

function initLogView() {
  if (logViewInitialized)
    return;
  logViewInitialized = true;

  ui.log.search.addEventListener("beforeinput", validateSearchInput);

  let searchTimer;

  ui.log.search.addEventListener("input", e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const results = search(e.target.value);
        renderResults(results);
      }, 100);
    }
  );
  ui.log.clearSearch.addEventListener("click", () => {
      ui.log.search.value = "";
      ui.log.search.dispatchEvent(new Event("input"));
      ui.log.search.focus();
    }
  );

  window.addEventListener("resize", debounce(positionResults, 50));
  window.visualViewport?.addEventListener( "resize",debounce(positionResults, 50)
  );

  populateTrailSelector(ui.log.trailSelect);
}

function initNotesView() {
  if (notesViewInitialized)
    return;
  notesViewInitialized = true;


  const n = ui.notes;

  n.date.addEventListener("input", makeInputHdlr(() => survey?.notes, "date", storeNotesLater));
  n.date.addEventListener("blur", finishFieldOnBlur(focusNextNotesField));
  n.date.addEventListener("keydown", finishFieldOnEnter);
  n.time.addEventListener("input", makeInputHdlr(() => survey?.notes, "startTime", storeNotesLater));
  n.startTime.addEventListener("blur", finishFieldOnBlur(focusNextNotesField));
  n.startTime.addEventListener("keydown", finishFieldOnEnter);
  n.startWeather.addEventListener( "input", makeInputHdlr(() => survey?.notes, "startWeather", storeNotesLater));
  n.startWeather.addEventListener("blur", finishFieldOnBlur(focusNextNotesField));
  n.startWeather.addEventListener("keydown", finishFieldOnEnter);
  n.notes.addEventListener("input", makeInputHdlr(() => survey?.notes, "notes", storeNotesLater));

  n.participants.addEventListener("input", makeInputHdlr(() => survey?.startNote, "participants", storeNotesLater));
  n.participants.addEventListener("beforeinput", validateParticipantInput);
  n.participants.addEventListener("input", debounce(handleParticipantInput, 50));
  document.addEventListener("click", hideParticipantResults);
}

function makeInputHdlr(getTarget, key, persist) {
  return (event) => {
    const target = getTarget();
    if (!target)
      return;

    target[key] = event.target.value;
    persist();
  };
}

// --- DATA LOADING and NORMALIZATION ---
async function loadVersion(useFresh = false, signal = undefined) {

  const response = await fetch("./version.json",
    {
      cache: useFresh ? "reload" : "default",
      signal
    }
  );

  if (!response.ok)
    throw new Error("Failed to load version");

  const data = await response.json();

  if (!data.branch || !data.version || !data.storageTag)
    throw new Error("Invalid version.json");

  return data;
}

async function loadLocalData() {
  try {
    const dataFiles = [
      ['plants', './data/plants.json'],
      ['trails', './data/trails.json'],
      ['participants', './data/participants.json']
    ];

    const loaded = Object.fromEntries(
      await Promise.all(
        dataFiles.map(([name, path]) => loadJsonFile(name, path))
      )
    );

    species = processSpecies(
      requireArray(loaded.plants, 'species', 'data/plants.json')
    );

    trailNetwork = processTrailNetwork(loaded.trails);
    trails = trailNetwork.trails;

    participants = processParticipants(
      requireArray(loaded.participants, 'participants', 'data/participants.json')
    );

    console.log(
      `Loaded ${trails.length} trails, ${species.length} species, ${participants.length} participants`
    );

    return true;
  } catch (e) {
    console.error(`Failed to load local data: ${e.message}`);

    if (e instanceof DataValidationError) {
      for (const detail of e.details)
        console.error(detail);
    } else {
      console.error(e);
    }

    showMessage(`Failed to load local data:\n${e.message}`);
    return false;
  }
}

async function loadJsonFile(name, path) {
  let response;

  try {
    response = await fetch(path);
  } catch (e) {
    throw new Error(`${path}: fetch failed: ${e.message}`);
  }

  if (!response.ok)
    throw new Error(`${path}: HTTP ${response.status} ${response.statusText}`);

  try {
    return [name, await response.json()];
  } catch (e) {
    throw new Error(`${path}: invalid JSON: ${e.message}`);
  }
}

function processSpecies(species) {
  let dropped = 0;
  let missingCommon = 0;
  let missingScientific = 0;

  // Normalize once at load
  species = species.filter(s => {

    if (!s || typeof s !== 'object') {
      dropped++;
      console.warn('processSpecies: invalid record', s);
      return false;
    }

    let field = 'common name';
    let common = cleanData(s.commonName, field);
    if (common === null) {
      // already eliminated
    } else if (common.split(' ').some(t => t.length < 2)) {
        console.warn(`processSpecies: ${field} short token`, common);
        common = null;
    } else if (!/^[a-zA-Z '()\-/]+$/.test(common)) {
        console.warn(`processSpecies: invalid characters in ${field}`, common);
        common = null;
    }

    field = 'scientific name';
    let scientific = cleanData(s.scientificName, field);
    if (scientific === null) {
      // already eliminated
    } else if (scientific.split(' ').some(t => t !== "x" && t.length < 2)) {
      console.warn(`processSpecies: ${field} short token`, scientific);
      scientific = null;
    } else if (!/^[a-zA-Z \-.]+$/.test(scientific)) {
      console.warn(`processSpecies: invalid characters in ${field}`,
        scientific);
      scientific = null;
    }

    field = "status";
    let suffix = cleanData(s.status, field);
    if (suffix === null)
      suffix = "";
    if (suffix !== '' &&  suffix !== '*' && suffix !== '#' && suffix !== '[#]') {
      console.warn(`processSpecies: invalid value in ${field}`, suffix);
      suffix = "";
    }

    // Remove completely broken entries
    if (common === null && scientific === null) {
      dropped++;
      console.warn(`processSpecies: Dropped species record`, s);
      return false;
    }

    // Repair partial entries
    if (common === null) {
      missingCommon++;
      common = "[no common name]";
    }
    if (scientific === null) {
      missingScientific++;
      scientific = "[no scientific name]";
    }
    // Normalize back into object
    s.status = suffix;
    s.scientificName = scientific;
    s.scientificNorm = normalizeScientific(scientific);
    s.scientificWords = s.scientificNorm.split(" ");
    s.commonName = common;
    s.displayCommon = common + suffix;
    s.commonNorm = normalizeCommon(common);
    s.commonWords = s.commonNorm.split(" ");
    s.commonJoined = s.commonWords.join("");

    return true;
  });

  if (dropped) console.warn(`Dropped ${dropped} invalid species`);

  if (missingCommon || missingScientific) {
    let msg = "Plant data warning: ";
    if (missingCommon)
      msg += `${missingCommon} missing common names`;
    if (missingCommon && missingScientific)
      msg += ", ";
    if (missingScientific)
      msg += `${missingScientific} missing scientific names`;

    console.warn(msg);

    showMessage(msg);
  }

  return species;
}

function processParticipants(pIn) {

  let pOut = [];

  for (let person of pIn) {
    person = cleanData(person, "name");
    if (person == null)
      continue;
    if (!/^[A-Za-z .,'-]+$/.test(person))
      console.warn(`processParticipants: Unexpected character`, person);

    pOut.push(person);
  }
  return pOut;
}

function processTrailNetwork(data) {
  if (!isPlainObject(data)) {
    throw new DataValidationError(
      'Trail data is invalid', ['data/trails.json:expected a top-level object']
    );
  }
  const errors = [];

  if (!Array.isArray(data.trails) || data.trails.length === 0)
    errors.push('trails: expected a nonempty array');

  if (!Array.isArray(data.posts) || data.posts.length === 0)
    errors.push('posts: expected a nonempty array');

  if (!Array.isArray(data.segments) || data.segments.length === 0)
    errors.push('segments: expected a nonempty array');

  if ( !Array.isArray(data.startingPoints) || data.startingPoints.length === 0)
    errors.push('startingPoints: expected a nonempty array');

  if (errors.length)
    throw new DataValidationError('Trail data is incomplete', errors);

  const trails = validateTrails(data.trails, errors);
  const trailIds = new Set(trails.map(trail => trail.id));

  const posts = validatePosts(data.posts, errors);
  const postIds = new Set(posts.map(post => post.id));

  const directedSegments = processSegments(
    data.segments,
    trailIds,
    postIds,
    errors
  );

  const segmentsByPost = indexSegmentsByPost(directedSegments);

  validatePostCoverage(posts, segmentsByPost, errors);

  validateTrailCoverage(trails, directedSegments, errors);

  const startingPoints = validateStartingPoints(
    data.startingPoints,
    trailIds,
    postIds,
    segmentsByPost,
    errors
  );

  if (errors.length)
    throw new DataValidationError("Trail data is invalid", errors);

  return {
    trails,
    posts,
    startingPoints,
    directedSegments,
    segmentsByPost
  };
}

const TRAILID_PAT = /^[a-z]+$/;
const TRAILNAME_PAT = /^[A-Za-z]+(?:[ /][A-Za-z]+)*$/;
const TRAIL_KEYS = new Set(['id', 'name']);

function validateTrails(rawTrails, errors) {
  const trails = [];
  const ids = new Set();
  const names = new Set();

  rawTrails.forEach((rawTrail, index) => {
    const path = `trails[${index}]`;

    if (!isPlainObject(rawTrail)) {
      errors.push(`${path}: expected an object`);
      return;
    }
    let valid = true;

    const id = rawTrail.id;
    if (typeof id !== 'string') {
      errors.push(`${path}.id: expected a string`);
      valid = false;
    } else if (!TRAILID_PAT.test(id)) {
      errors.push(`${path}.id: expected all lowercase letters`);
      valid = false;
    } else if (ids.has(id)) {
      errors.push(`${path}.id: duplicate trail ID "${id}"`);
      valid = false;
    } else {
      // reserve the trailId
      ids.add(id);
    }

    const name = rawTrail.name;
    if (typeof name !== 'string') {
      errors.push(`${path}.name: expected a string`);
      valid = false;
    } else if (!TRAILNAME_PAT.test(rawTrail.name)) {
      errors.push(`${path}.name: illegal characters`);
      valid = false;
    } else if (names.has(name)) {
      errors.push(`${path}.name: duplicate trail name "${rawTrail.name}"`);
      valid = false;
    } else {
      // reserve the trailName
      names.add(name);
    }

    for (const key of Object.keys(rawTrail)) {
      if (!TRAIL_KEYS.has(key)) {
        errors.push(`${path}.${key}: unexpected field`);
        valid = false;
      }
    }

    if (valid) {
      trails.push({
        id: id,
        name: name
      });
    }
  });

  return trails;
}

const POSTID_PAT = /^(?:P[1-9][0-9]?|[A-Z]{2,})$/;
const POSTNAME_PAT = /^[A-Za-z]+(?:[ /][A-Za-z]+)*$/;
const POST_KEYS = new Set(['id', 'name']);

function validatePosts(rawPosts, errors) {
  const posts = [];
  const ids = new Set();
  const names = new Set();

  rawPosts.forEach((rawPost, index) => {
    const path = `posts[${index}]`;

    if (!isPlainObject(rawPost)) {
      errors.push(`${path}: expected an object`);
      return;
    }

    let valid = true;

    const id = rawPost.id;
    if (typeof id !== 'string') {
      errors.push(`${path}.id: expected a string`);
      valid = false;
    } else if (!POSTID_PAT.test(id)) {
      errors.push(`${path}.id: illegal id`);
      valid = false;
    } else if (ids.has(id)) {
      errors.push(`${path}.id: duplicate post ID "${id}"`);
      valid = false;
    } else {
      ids.add(id);
    }
    const idValid = valid;

    let name = rawPost.name;
    if (name === undefined) {
      if (idValid) {
         // id was good
        name = id;
        if (names.has(name)) {
          errors.push(`${path}.name: duplicate post name "${name}"`);
          valid = false;
        } else {
          names.add(name);
        }
      }
    } else if (typeof name !== 'string') {
      errors.push(`${path}.name: expected a string`);
      valid = false;
    } else if (!POSTNAME_PAT.test(name)) {
      errors.push(`${path}.name: illegal characters`);
      valid = false;
    } else if (names.has(name)) {
      errors.push(`${path}.name: duplicate post name "${name}"`);
      valid = false;
    } else {
      names.add(name);
    }

    for (const key of Object.keys(rawPost)) {
      if (!POST_KEYS.has(key)) {
        errors.push(`${path}.${key}: unexpected field`);
        valid = false;
      }
    }

    if (valid) {
      posts.push({
        id: id,
        name: name
      });
    }
  });

  return posts;
}

function processSegments(rawSegments, trailIds, postIds, errors) {
  const directedSegments = [];
  const connections = new Set();

  rawSegments.forEach((rawSegment, index) => {
    const segment = validateSegment(
      rawSegment,
      index,
      trailIds,
      postIds,
      errors
    );

    if (!segment)
      return;

    const connectionKey = makeConnectionKey(segment);

    if (connections.has(connectionKey)) {
      errors.push(
        `segments[${index}]: duplicate segment`
      );
      return;
    }

    connections.add(connectionKey);

    directedSegments.push({
      sourceIndex: index,
      trailId: segment.trailId,
      fromPost: segment.startPost,
      toPost: segment.endPost,
      length: segment.length
    });

    if (segment.startPost !== segment.endPost) {
      directedSegments.push({
        sourceIndex: index,
        trailId: segment.trailId,
        fromPost: segment.endPost,
        toPost: segment.startPost,
        length: segment.length
      });
    }
  });

  return directedSegments;
}

function validateSegment( rawSegment, index, trailIds, postIds, errors) {
  const path = `segments[${index}]`;

  if (!isPlainObject(rawSegment)) {
      errors.push(`${path}: expected an object`);
      return null;
  }

  let valid = true;

  let startPostValid = false;

  const startPost = rawSegment.startPost;
  if (typeof startPost !== "string") {
    errors.push(`${path}.startPost: expected a string`);
    valid = false;
  } else if (!postIds.has(startPost)) {
    errors.push(`${path}.startPost: unknown post "${startPost}"`);
    valid = false;
  } else {
    startPostValid = true;
  }

  const trailId = rawSegment.trailId;
  if (typeof trailId !== "string") {
    errors.push(`${path}.trailId: expected a string`);
    valid = false;
  } else if (!trailIds.has(trailId)) {
    errors.push(`${path}.trailId: unknown trail "${trailId}"`);
    valid = false;
  }

  let endPostValid = false;
  const endPost = rawSegment.endPost;
  if (typeof endPost !== "string") {
    errors.push(`${path}.endPost: expected a string`);
    valid = false;
  } else if (!postIds.has(endPost)) {
    errors.push(`${path}.endPost: unknown post "${endPost}"`);
    valid = false;
  } else {
    endPostValid = true;
  }

  let lengthValid = false;
  const length = rawSegment.length;
  if (typeof length !== "number" || !Number.isFinite(length)) {
    errors.push(`${path}.length: expected a finite number`);
    valid = false;
  } else if (length < 0) {
    errors.push(`${path}.length: must not be negative`);
    valid = false;
  } else {
    lengthValid = true;
  }

  if (startPostValid && endPostValid && lengthValid) {
    if (startPost === endPost && length !== 0) {
      errors.push(`${path}: a self-loop must have zero length`);
      valid = false;
    } else if (startPost !== endPost && length === 0) {
      errors.push(`${path}: a zero-length segment must be a self-loop`);
      valid = false;
    }
  }

  for (const field of Object.keys(rawSegment)) {
    if (
      field !== 'startPost' &&
      field !== 'trailId' &&
      field !== 'endPost' &&
      field !== 'length'
    ) {
      errors.push(`${path}.${field}: unexpected field`);
      valid = false;
    }
  }
  if (!valid)
     return null;

  return {
    startPost,
    trailId,
    endPost,
    length
  };
}

function makeConnectionKey(segment) {
  const first =
    segment.startPost < segment.endPost
      ? segment.startPost
      : segment.endPost;

  const second =
    segment.startPost < segment.endPost
      ? segment.endPost
      : segment.startPost;

  return `${segment.trailId}:${first}:${second}`;
}

function indexSegmentsByPost(directedSegments) {
  const segmentsByPost = new Map();

  for (const segment of directedSegments) {
    let segments = segmentsByPost.get(segment.fromPost);

    if (!segments) {
      segments = [];
      segmentsByPost.set(segment.fromPost, segments);
    }

    segments.push(segment);
  }

  return segmentsByPost;
}

function validatePostCoverage(posts, segmentsByPost, errors) {
  for (const post of posts) {
    if (!segmentsByPost.has(post.id)) {
      errors.push(
        `posts: post "${post.id}" is not used by any segment`
      );
    }
  }
}

function validateTrailCoverage(
  trails,
  directedSegments,
  errors
) {
  const usedTrailIds = new Set(
    directedSegments.map(segment => segment.trailId)
  );

  for (const trail of trails) {
    if (!usedTrailIds.has(trail.id)) {
      errors.push(
        `trails: trail "${trail.id}" is not used by any segment`
      );
    }
  }
}

function validateStartingPoints(
  rawStartingPoints,
  trailIds,
  postIds,
  segmentsByPost,
  errors
) {
  const startingPoints = [];
  const startingPointKeys = new Set();

  rawStartingPoints.forEach((rawStart, index) => {
    const path = `startingPoints[${index}]`;

    if (!isPlainObject(rawStart)) {
      errors.push(`${path}: expected an object`);
      return null;
    }

    let valid = true;

    const postId = rawStart.postId;
    if (typeof postId !== "string") {
      errors.push(`${path}.postId: expected a string`);
      valid = false;
    } else if (!postIds.has(postId)) {
      errors.push(`${path}.postId: unknown post "${postId}"`);
      valid = false;
    }

    const trailId = rawStart.trailId;
    if (typeof trailId !== "string") {
      errors.push(`${path}.trailId: expected a string`);
      valid = false;
    } else if (!trailIds.has(trailId)) {
      errors.push(`${path}.trailId: unknown trail "${trailId}"`);
      valid = false;
    }

    for (const field of Object.keys(rawStart)) {
      if (field !== 'postId' && field !== 'trailId') {
        errors.push(`${path}.${field}: unexpected field`);
        valid = false;
      }
    }

    if (!valid)
      return;

    const edges = segmentsByPost.get(postId);
    if (!edges || !edges.some(edge => edge.trailId === trailId)) {
      errors.push(`${path}: trail "${trailId}" does not meet post "${postId}"`);
      return;
    }

    const key = `${postId}:${trailId}`;
    if (startingPointKeys.has(key)) {
      errors.push(`${path}: duplicate starting point ${key}`);
      return;
    }
    startingPointKeys.add(key);
    startingPoints.push({ postId, trailId });
  });

  return startingPoints;
}

function validateParticipantInput(event) {
  validateTextInput(event, /^[a-zA-Z\s,.\-/'’]+$/);
}

function validateTextInput(event, allowed) {
  // deletes/backspace
  if (event.inputType?.startsWith("delete"))
    return;

  // IME/autocomplete
  if (!event.data)
    return;

  // what input field?
  const input = event.target;

  // normalize punctuation
  const c = normalizeInputChar(event.data);

  if (c !== event.data) {
    event.preventDefault();
    input.setRangeText(c, input.selectionStart, input.selectionEnd, "end");
  }

  // validate normalized char against allowed regex
  if (!allowed.test(c)) {
    event.preventDefault();
    flashInvalidTextInput(input);
  }
}

function assertString(value, name) {
  if (typeof value !== "string")
    throw new Error(`Invalid ${name}`);
}

function requireArray(obj, key, filename) {
  if (!obj) {
    throw new Error(`Missing data object: ${filename}`);
  }

  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    throw new Error(`Missing key "${key}" in ${filename}`);
  }

  if (!Array.isArray(obj[key])) {
    throw new Error(`Expected array at "${key}" in ${filename}`);
  }

  return obj[key];
}

function cleanData(s,fieldName = "field") {
  if (typeof s !== "string") {
    console.warn(`cleanData: expected string for ${fieldName}`, s);
    return null;
  }

  if (/[\n\r\v\f\u00A0]/.test(s))
    console.warn(`cleanData: illegal whitespace in ${fieldName}`, s);

  const cleaned = s
    .replace(/[\s\u00A0]+/g, " ")
    .trim();
  if (cleaned !== s)
    console.warn(`cleanData: normalized whitespace in ${fieldName}`, s);
  return cleaned;
}

function normalizeCommon(str) {
  return (str)
    .toLowerCase()
    .replace(/(\w+)-(\w+)/g, "$1 $2")
    .replace(/(\w+)\/(\w+)/, "$1 $2")
    .replace(/(\w+)'s/, "$1s")
    .replace(/(\w+)s'/, "$1s");
}

function normalizeScientific(str) {
  return (str || null)
    .toLowerCase()
    .trim()
    .replace(/ssp\./, "ssp")
    .replace(/var\./, "var");
}

function normalizeQuery(str) {
  return (str || "")
    .toLowerCase()
    .trim()
    // remove punctuation that commonly breaks plant names
    .replace(/-/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/(\w+)'s/, '$1s')
    .replace(/(\w+)s'/, '$1s')
    // collapse all whitespace (including trailing spaces inside query)
    .replace(/\s+/g, ' ');
}

// --- INPUT VALIDATION and FOCUS
function validateSearchInput(event) {

  validateTextInput(event, /^[a-zA-Z\s,.\-/'’]+$/);
}

function normalizeInputChar(c) {
  switch (c) {
    case "‘":
    case "’":
      return "'";

    case "‐": // hyphen
    case "-": // non-breaking hyphen
    case "–": // en dash
    case "—": // em dash
      return "-";

    default:
      return c;
  }
}

class DataValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "DataValidationError";
    this.details = details;
  }
}

function flashInvalidTextInput(input) {
  input.classList.add("inputRejected");
  setTimeout(() => {input.classList.remove("inputRejected");}, 120);
}

function focusField(field) {
  requestAnimationFrame(() => {
    field?.focus();
  });
}

function focusFirstEmpty(fields) {
  const field = fields.find(f => !f.value.trim());
  if (field) {
    focusField(field);
    return true;
  }
  return false;
}

function focusNextNotesField() {
  focusFirstEmpty([
    ui.notes.date,
    ui.notes.participants,
    ui.notes.startTime,
    ui.notes.startWeather,
    ui.notes.endTime,
    ui.notes.endWeather,
    ui.notes.notes
  ]);
}

function refocusAfterSelection(input, afterFocus = null, delay = 150) {
  input.blur();

  setTimeout(() => {
    input.focus();
    afterFocus?.();
  }, delay);
}

function finishFieldOnBlur(advance) {
  return () => {
    flushPendingStores();

    setTimeout(() => {
      if (document.activeElement === document.body)
        advance();
    }, 0);
  };
}

function finishFieldOnEnter(event) {
  if (event.key !== "Enter")
    return;

  event.preventDefault();
  flushPendingStores();
  event.target.blur();
}

// --- Survey Phase ---
function initializeSurveyPhase() {
  const stored = survey.phase;

  if (currentTrail === null) {
    setSurveyPhase(SURVEY_PHASE.START);
  } else if (isValidSurveyPhase(stored)) {
    setSurveyPhase(stored);
  } else {
    setSurveyPhase(SURVEY_PHASE.FIELD);
  }
}

function setSurveyPhase(phase) {
  if (!survey)
    throw new Error("Cannot set surveyPhase without an active survey");

  survey.phase = phase;
  storePhase();

  renderControls();
}

function isValidSurveyPhase(phase) {
  return Object.values(SURVEY_PHASE).includes(phase);
}

// --- MODE, TRAIL, and VIEW RENDERING
function renderView() {
  if (currentView === VIEW.LOG) {
    ui.log.panel.hidden = false;
    ui.notes.panel.hidden = true;
    ui.review.panel.hidden = true;
    renderLogView();
  } else if (currentView === VIEW.Notes) {
    ui.log.panel.hidden = true;
    ui.notes.panel.hidden = false;
    ui.review.panel.hidden = true;
    renderNotesView();
  } else if (currentView === VIEW.REVIEW) {
    ui.log.panel.hidden = true;
    ui.notes.panel.hidden = true;
    ui.review.panel.hidden = false;
    renderRouteView();
  }
}

function switchTrail(id) {
 const enteringField =
    survey.phase === SURVEY_PHASE.START &&
    currentTrail === null &&
    id !== null;

  setCurrentTrail(id);

  if (enteringField) {
    setSurveyPhase(SURVEY_PHASE.FIELD);
  }

  syncTrailSelectors();
  renderLogView();
}

function setCurrentTrail(id) {

  if (id === null) {
    currentTrail = id;
    localStorage.removeItem(storageKey('currentTrail'));
  } else if (trails.some(t => t.id === id)) {
    currentTrail = id;
    localStorage.setItem(storageKey('currentTrail'), id);
  } else {
    throw new Error(`Invalid currentTrail: ${id}`);
  }
}

function initializeCurrentTrail() {
  const stored = localStorage.getItem(storageKey("currentTrail"));

  if (stored === null) {
    setCurrentTrail(null);
  } else if (trails.some(t => t.id === stored)) {
    setCurrentTrail(stored);
  } else {
    console.warn("Ignoring stored invalid currentTrail", stored);
    setCurrentTrail(null);
  }
}

function syncTrailSelectors() {
  const value = currentTrail ?? "";

  if (ui.log.trailSelect)
    ui.log.trailSelect.value = value;

  if (ui.notes.trail.trailSelect)
    ui.notes.trail.trailSelect.value = value;
}

function populateTrailSelector(select) {
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select Starting Location";
  select.appendChild(placeholder);

  trails.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    select.appendChild(opt);
  });

  select.value = currentTrail ?? "";

  select.addEventListener('change', (e) => {
    if (!e.target.value) {
      syncTrailSelectors();
      return;
    }
    switchTrail(e.target.value);
  });
}

function renderLogView() {
  if (!survey) {
    ui.log.log.innerHTML = '';
    return;
  }

  // render sightings list
  renderLog();

  // clear search UI state (optional but clean)
  ui.log.results.innerHTML = '';

  // position results overlay
  requestAnimationFrame(positionResults);
  focusField(ui.log.search);
}

function renderNotesView() {
  if (!survey)
    return;

  const n = ui.notes;
  const data = survey.notes || {};

  n.date.value = data.date || '';
  n.startTime.value = data.startTime || '';
  n.startWeather.value = data.startWeather || '';
  n.participants.value = data.participants || '';
  n.endTime.value = data.endTime || '';
  n.endWeather.value = data.endWeather || '';
  n.notes.value = data.notes || '';
  focusNextNotesField();
}

function renderRouteView() {
}

//function showNotesPanel(panel) {
//  currentNotePanel = panel;
//  renderNotesView();
//}

// --- MESSAGES and DIALOGS
function showMessage(text, duration = 30000) {
  if (messageTimeoutId)
    clearTimeout(messageTimeoutId);

  ui.message.text.textContent = text;
  ui.message.panel.hidden = false;

  if (duration > 0)
    messageTimeoutId = setTimeout(() => { clearMessage(); },duration);
}

function clearMessage() {
  if (messageTimeoutId) {
    clearTimeout(messageTimeoutId);
    messageTimeoutId = null;
  }
  ui.message.panel.hidden = true;
  ui.message.text.textContent = "";
}

function setStateMessage(text) {
  ui.message.statePanel.textContent = text;
  ui.message.statePanel.hidden = false;
}

function clearStateMessage() {
  ui.message.statePanel.hidden = true;
  ui.message.statePanel.textContent = "";
}

function chooseAction(question, actions) {
  if (activeChoiceOverlay)
    return Promise.resolve(null);

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    activeChoiceOverlay = overlay;

    function finish(value) {
      overlay.remove();
      activeChoiceOverlay = null;
      resolve(value);
    }

    overlay.className = 'choiceOverlay';
    overlay.appendChild(makeChoicePanel(question, actions, finish));
    document.body.appendChild(overlay);
    overlay.querySelector('button')?.focus();
  });
}

function makeChoicePanel(question, actions, finish) {
  const panel = document.createElement('div');
  panel.className = 'choicePanel';

  const text = document.createElement('div');
  text.className = 'choiceQuestion';
  text.textContent = question;

  const buttons = document.createElement('div');
  buttons.className = 'choiceButtons';

  for (const action of actions) {
    const button = document.createElement('button');
    button.textContent = action.label;

    button.addEventListener('click', () => {
      finish(action.value);
    });
    buttons.appendChild(button);
  }
  panel.appendChild(text);
  panel.appendChild(buttons);
  return panel;
}

// --- REFRESH and SERVICE WORKER ACTIVATION
async function refreshApp() {
  flushPendingStores();
  showMessage("Refreshing...");

  const oldCacheName = getCurrentCacheName();
  let stagingName = null;

  try {
    if (!navigator.onLine) throw new Error("Offline");

    const freshVersion = await loadVersion(true);

    // Stage saves into a temporary cache first
    // Use a branch-specific temporary staging name.
    stagingName = `FoE:survey:${freshVersion.branch}:staging:${Date.now()}`;
    const staging = await caches.open(stagingName);

    const shellReq = new Request('./shell-config.js');
    const freshShellReq = new Request('./shell-config.js', { cache: "reload" });

    let shellRes = await fetch(freshShellReq);
    if (!shellRes.ok)
      throw new Error("Failed to fetch shell-config.js");
    await staging.put(shellReq, shellRes.clone());

    shellRes = await staging.match(shellReq);
    if (!shellRes)
      throw new Error('shell-config.js missing in staging');
    // Evaluate in isolated function scope and return only the two expected values
    const shellText = await shellRes.text();
    const cfg = (new Function(shellText + '\nreturn { CACHE_NAME, APP_SHELL };'))();
    const cacheName = cfg.CACHE_NAME;
    const newAppShell = cfg.APP_SHELL;
    console.log('Extracted cacheName from shell-config.js:', cacheName);

    for (const file of newAppShell) {
      const req = new Request(file);

      if (await staging.match(req))
        continue;

      const freshReq = new Request(file, { cache: "reload" });
      const res = await fetch(freshReq);

      if (!res.ok)
        throw new Error(`Failed to refresh ${file}`);

      await staging.put(req, res.clone());

      if (!await staging.match(req))
        throw new Error(`Staging missing ${file}`);
    }

    // Verify staged version.json matches the fresh version
    const vRes = await staging.match('./version.json');
    if (!vRes) throw new Error('version.json missing in staging');
    const vData = await vRes.json();
    if (vData.version !== freshVersion.version) throw new Error('Staging version mismatch');

    // Commit only after staging is complete and verified. If the target cache
    // is the currently active cache, preserve a backup so refresh failure can
    // restore the old shell.
    await commitStagedCache(staging, cacheName, newAppShell, oldCacheName);

    const activated = await activateMatchingWaitingWorker(cacheName);
    if (!activated && oldCacheName !== cacheName) {
      throw new Error(
        "Refresh downloaded a new app, but no matching SW is waiting");
    }
    showMessage("Refresh complete", 5000);
    location.reload();
  } catch (e) {
    console.error("REFRESH FAILED:", e);
    alert("Refresh failed:\n" + e.message);
    showMessage("Refresh failed");
  } finally {
    if (stagingName) {
      try {
        await caches.delete(stagingName);
      } catch (e) {
        console.warn('Could not delete staging cache', stagingName, e);
      }
    }
  }
}

async function activateMatchingWaitingWorker(expectedCacheName) {
  if (!('serviceWorker' in navigator))
    return false;

  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg)
    return false;

  try {
    await reg.update();
  } catch (e) {
    throw new Error(`Service worker update failed: ${e.message}`);
  }

  reg = await navigator.serviceWorker.getRegistration();
  if (!reg.waiting)
    return false;

  const info = await getServiceWorkerCacheInfo(reg.waiting, 3000);

  if (info.cacheName !== expectedCacheName) {
    throw new Error(
      `Waiting service worker cache mismatch: expected ${expectedCacheName}, got ${info.cacheName || 'unknown'}`
    );
  }

  const controllerChange = waitForControllerChange(5000);
  reg.waiting.postMessage({ type: 'SKIP_WAITING' });

  if (!await controllerChange)
    console.warn('Timed out waiting for service worker controllerchange; reloading anyway');

  return true;
}

function getServiceWorkerCacheInfo(worker, timeoutMs) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();

    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(new Error('Timed out waiting for service worker cache info'));
    }, timeoutMs);

    channel.port1.onmessage = event => {
      clearTimeout(timeout);
      channel.port1.close();

      const msg = event.data;
      if (!msg || msg.type !== 'CACHE_INFO') {
        reject(new Error('Unexpected service worker cache info response'));
        return;
      }

      resolve(msg);
    };

    worker.postMessage({ type: 'GET_CACHE_INFO' }, [channel.port2]);
  });
}

function waitForControllerChange(timeoutMs) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      clearTimeout(timeout);
      resolve(true);
    }, { once: true });
  });
}

function getCurrentCacheName() {
  if (typeof CACHE_NAME === "string")
    return CACHE_NAME;
  return null;
}

async function commitStagedCache(staging, cacheName, appShell, oldCacheName) {
  if (oldCacheName === cacheName) {
    await replaceCurrentCacheFromStaging(staging, cacheName, appShell);
    return;
  }

  // The normal path uses a new timestamped cache name. The old cache remains
  // untouched until the new one has been fully populated and verified.
  await copyStagingToCache(staging, cacheName, appShell);
}

async function replaceCurrentCacheFromStaging(staging, cacheName, appShell) {
  const backupName = `${cacheName}:backup:${Date.now()}`;
  const hadCurrentCache = await caches.has(cacheName);

  try {
    if (hadCurrentCache) {
      await copyCache(cacheName, backupName);
    }

    await caches.delete(cacheName);
    await copyStagingToCache(staging, cacheName, appShell);
  } catch (e) {
    if (hadCurrentCache) {
      try {
        await caches.delete(cacheName);
        await copyCache(backupName, cacheName);
      } catch (restoreError) {
        console.error('Could not restore cache backup', backupName, restoreError);
      }
    }

    throw e;
  } finally {
    if (hadCurrentCache) {
      try {
        await caches.delete(backupName);
      } catch (cleanupError) {
        console.warn('Could not delete cache backup', backupName, cleanupError);
      }
    }
  }
}

async function copyStagingToCache(staging, cacheName, appShell) {
  const target = await caches.open(cacheName);

  for (const file of appShell) {
    const req = new Request(file);
    const res = await staging.match(req);
    if (!res)
      throw new Error(`Staging missing ${file}`);

    await target.put(req, res.clone());
  }

  await verifyCacheContains(target, appShell);
}

async function copyCache(sourceName, targetName) {
  const source = await caches.open(sourceName);
  const target = await caches.open(targetName);

  for (const req of await source.keys()) {
    const res = await source.match(req);
    if (res)
      await target.put(req, res.clone());
  }
}

async function verifyCacheContains(cache, appShell) {
  for (const file of appShell) {
    const req = new Request(file);
    const res = await cache.match(req);
    if (!res)
      throw new Error(`Cache missing ${file}`);
  }
}

// --- SURVEY LIFECYCLE and PERSISTENCE ---
function createSurvey() {
  const now = new Date();

  return {
    phase: SURVEY_PHASE.START,
    notes: {
      date: formatDate(now),
      participants: "",
      startTime: formatTime(now),
      startWeather: "",
      endTime: "",
      endWeather: "",
      notes: ""
    },
    route: {
      currentLeg: {},
      Legs: []
    },
    trailLogs: {}
  };
}

function newSurvey() {
  if (survey) {
    // Existing Survey - ask first
    const ok = confirm("Delete current survey and start a new one?");
    if (!ok)
      return;
  }

  // Create new survey and store it

  cancelPendingStores();

  localStorage.removeItem(storageKey("surveyExists"));
  clearStoredSurvey();

  survey = createSurvey();
  setCurrentTrail(null);

  currentView = VIEW.NOTES;

  storeSurvey();
  localStorage.setItem(storageKey("surveyExists"), "true");

  // now we're in active state
  setAppState(APP_STATE.ACTIVE);
}

function endSurvey() {
  if (!survey)
    throw new Error("endSurvey called with no active survey!");

  const now = new Date();

  survey.note.endTime = formatTime(now);

  setSurveyPhase(SURVEY_PHASE.END);
  currentView = VIEW.NOTES;
//  currentNotePanel = NOTE_PANEL.CLOSE;
  renderView();
}

function storeSurvey() {
  if (!survey)
    return;

  storePhase();
  storeNotes();
  storeRoute();
  storeTrailLogs();
}

function loadSurvey() {

  const surveyExists = localStorage.getItem(storageKey("surveyExists"));
  if (!surveyExists)
    return null;

  const survey = {};

  // These should all have been created and stored in newSurvey()
  try {
    survey.phase = loadPhase();
    survey.notes = loadNotes();
    survey.route = loadRoute();
    survey.trailLogs = loadTrailLogs();

    return survey;

  } catch(e) {
    showMessage("Survey data appears corrupted. Please save/reset.");
    console.error('Bad survey data', e);
    return null;
  }
}

function clearStoredSurvey() {
  localStorage.removeItem(storageKey("phase"));
  localStorage.removeItem(storageKey("notes"));
  localStorage.removeItem(storageKey("route"));
  localStorage.removeItem(storageKey("trailLogs"));
}

function loadSection(key) {
  const raw = localStorage.getItem(key);
  // never stored
  if (raw === null)
    return null;

  try {
    const data = JSON.parse(raw);

    // explicit null
    if (data === null)
      throw new Error(`Null data in ${key}`);

    return data;

  } catch (e) {
    console.error(`Invalid ${key}`, e);
    throw new Error(`Corrupt survey data: ${key}`);
  }
}

function loadPhase() {
  const phase = loadSection(storageKey("phase"));

  if (!isValidSurveyPhase(phase))
    throw new Error("Bad survey phase");

  return phase;
}

function storePhase() {
  localStorage.setItem(storageKey('phase'), JSON.stringify(survey.phase));
}

function loadNotes() {

  const notes = loadSection(storageKey("notes"));

  if (notes === null)
    throw new Error("Missing notes");

  if (typeof notes !== "object" || Array.isArray(notes))
    throw new Error("Bad format for notes");

  assertString(notes.date, "notes.date");
  assertString(notes.participants, "notes.participants");
  assertString(notes.startTime, "notes.startTime");
  assertString(notes.startWeather, "notes.startWeather");
  assertString(notes.endTime, "notes.endTime");
  assertString(notes.endWeather, "notes.endWeather");
  assertString(notes.notes, "notes.notes");

  return notes;
}

function loadRoute() {

  const route = loadSection(storageKey("route"));

  if (!isPlainObject(route))
    throw new Error("Bad stored route");
  
  if (!isPlainObject(route.currentLeg))
    throw new Error("Bad route.currentLeg");

  if (!Array.isArray(route.Legs))
     throw new Error("Invalid route.legs");

  // should check the legs to make sure they're all appropriate object

  return route;
}

function loadTrailLogs() {
  const trailLogs = loadSection(storageKey("trailLogs"));

  if (trailLogs === null)
    throw new Error("Missing trail logs");

  if (typeof trailLogs !== "object" || Array.isArray(trailLogs))
    throw new Error ("Bad format for trails log");

  for (const trailId in trailLogs) {
    const trailLog = trailLogs[trailId];

    if (trailLog === null || typeof trailLog !== "object" || Array.isArray(trailLog))
      throw new Error(`Bad trail: ${trailId}`);

    assertString(trailLog.firstEntered, `trail ${trailId} .firstEntered`);

    if (!Array.isArray(trailLog.entries))
      throw new Error(`Bad entries: ${trailId}`);
  }

  return trailLogs;
}

function storeNotes() {
  localStorage.setItem(storageKey('notes'), JSON.stringify(survey.notes));
}

function storeRoute() {
  localStorage.setItem(storageKey('route'). JSON.stringify(survey.route));
}

function storageKey(key) {
  return `${STORAGE_TAG}:${key}`;
}

function storeTrailLog(trailId) {
  void trailId;
  // Right now we store all the trails at once
  // later we may store trails individually
  storeTrailLogs();
}

function storeTrailLogs() {
  localStorage.setItem(
    storageKey('trailLogs'), JSON.stringify(survey.trailLogs)
  );
}

function storeTrailLogLater(trailId) {
  void trailId;
  storeTrailLogsLater();
}

function debounce(fn, delay = 2500) {
  let timer = null;

  return function (...args) {
    clearTimeout(timer);

    timer = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

function flushableDebounce(fn, delay = 1500, registry = null) {
  let timer = null;
  let lastThis = null;
  let lastArgs = null;

  function run() {
    timer = null;
    fn.apply(lastThis, lastArgs);
    lastThis = null;
    lastArgs = null;
  }

  function debounced(...args) {
    lastThis = this;
    lastArgs = args;

    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  debounced.flush = () => {
    if (!timer) return;

    clearTimeout(timer);
    run();
  };

  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
    lastThis = null;
    lastArgs = null;
  };

  registry?.push(debounced);

  return debounced;
}

function cancelPendingStores() {
  pendingStores.forEach(fn => fn.cancel());
}

function flushPendingStores() {
  pendingStores.forEach(fn => fn.flush());
}

// --- SEARCH and AUTOCOMPLETE ---
function search(q) {
  q = normalizeQuery(q);

  if (q.length < 2)
    return [];

  const qWord = " " + q;
  const qJoined = q.replace(/\s+/g, "");

  const starts = [];
  const wordStarts = [];
  const joined = [];
  const contains = [];

  for (const item of species) {
    const common = item.commonNorm;
    const scientific = item.scientificNorm;
    const commonJoined = item.commonJoined;

    if (common.startsWith(q) || scientific.startsWith(q)) {
      starts.push(item);
    } else if (common.includes(qWord) || scientific.includes(qWord)) {
      wordStarts.push(item);
    } else if (commonJoined.includes(qJoined)) {
      joined.push(item);
    } else if (common.includes(q) || scientific.includes(q)) {
      contains.push(item);
    }
  }

  return [
    ...starts,
    ...wordStarts,
    ...joined,
    ...contains
  ].slice(0, 30);
}

function renderResults(list) {
  const container = ui.log.results;
  container.innerHTML = '';
  container.scrollTop = 0;

  const input = ui.log.search;

  if (input.value.length < 2) {
    container.innerHTML = '';
    container.style.display = "none";
    return;
  }

  container.style.display = 'block';

  if (list.length === 0) {
    container.innerHTML = '<div class="item">No matches</div>';
    return;
  }

  if (!Array.isArray(list)) return;

  list.forEach(item => {
    const div = document.createElement('div');
    div.className = 'resultItem';

    appendPlantLabel(div, item.commonName, item.scientificName);

    div.onclick = () => {
      addSighting(item);

      const input = ui.log.search;
      input.value = '';
      renderResults([]);

      refocusAfterSelection(input);
    };

    container.appendChild(div);
  });
}

function positionResults() {

  if (!ui.log.search || !ui.log.results)
    return;

  const searchRect = ui.log.search.getBoundingClientRect();

  const panelRect = ui.log.panel.getBoundingClientRect();

  // distance from top of logView
  const top = searchRect.bottom - panelRect.top;

  ui.log.results.style.top = `${top}px`;

  // make it cover everything below search
  ui.log.results.style.height = `${panelRect.bottom - searchRect.bottom}px`;
}

function handleParticipantInput(e) {
  const input = e.target;
  // only autocomplete at end
  if (
    input.selectionStart !== input.value.length ||
    input.selectionEnd !== input.value.length
   ) {
    hideParticipantResults();
    return;
   }

  const current =
    input.value
      .split(/\s*,\s*/)
      .at(-1)
      .trim();

  const matches = matchParticipants(current);

  renderParticipantResults(matches);
}

function matchParticipants(input) {

  const current =
    input
      .trim()
      .toLowerCase();

  if (current.length < 1)
    return [];

  return participants
    .filter(person =>
      person
        .toLowerCase()
        .startsWith(current)
    )
    .slice(0, 6);
}

function renderParticipantResults(list) {

  const box = ui.notes.start.participants.parentElement.querySelector("#participantResults");

  box.innerHTML = "";

  if (!list.length) {
    box.style.display = "none";
    return;
  }

  box.style.display = "block";

  for (const name of list) {

    const div = document.createElement("div");

    div.textContent = name;
    div.className = "resultItem";

    div.onclick = () => {
      insertParticipant(name);
    };

    box.appendChild(div);
  }
}

function insertParticipant(name) {

  const input = ui.notes.participants;

  const pieces =
    input.value
      .split(",")
      .map(s => s.trim());

  // replace current token
  pieces[pieces.length - 1] = name;

  input.value = pieces.join(", ") + ", ";

  survey.note.participants = input.value;
  storeNotes();

  input.focus();

  // move caret to end (important on mobile)
  input.setSelectionRange(input.value.length, input.value.length);

  hideParticipantResults();
}

function hideParticipantResults(e) {
  const box = document.getElementById("participantResults");
  const input = ui.notes.participants;
  if (!box)
    return;

  if (e && (box.contains(e.target) || input.contains(e.target))) return;
  box.innerHTML = "";
  box.style.display = "none";
}

// --- LOG ENTRIES ---
function getTrailLog(trailId) {
  return survey?.trailLogs?.[trailId] || null;
}

function ensureTrailLog(trailId) {
  survey.trailLogs[trailId] ??= {
    firstEntered: formatTimestamp(),
    entries: []
  };

  return survey.trailLogs[trailId];
}

function addSighting(item) {

  if (!survey) {
    alert('No active survey');
    return;
  }
  if (!currentTrail)
    throw new Error("Cannot add sighting with no current trail");

  const trailId = currentTrail;
  const trailLog = ensureTrailLog(trailId);
  const entries = trailLog.entries;

  const duplicate = entries.some(e => e.commonName === item.displayCommon);
  if (duplicate) {
    if (!confirm('Already recorded on this trail. Add again?')) {
      return;
    }
  }

  // Add to END (most recent last)
  const entry = {
    speciesId: item.speciesId,
    commonName: item.displayCommon,
    scientificName: item.scientificName,
    note: '',
    time: formatTimestamp()
  }
  entries.push(entry);

  storeTrailLog(trailId);

  const row = createLogRow(entry, trailId);
  ui.log.log.prepend(row);
  highlightLogRow(row);
}

function highlightLogRow(row) {
  row.style.background = '#e6ffe6';
  setTimeout(() => row.style.background = '', 400);
}

function renderLog() {
  const container = ui.log.log;
  container.innerHTML = '';

  if (!survey || !currentTrail) return;

  const trailId = currentTrail;
  const trailLog = getTrailLog(trailId);
  if (!trailLog) return;

  trailLog.entries.slice().reverse().forEach((entry) => {
    const div = createLogRow(entry, trailId);
    container.appendChild(div);
  });
}

function createLogRow(entry, trailId) {
  const div = document.createElement('div');
  div.className = 'item';

  const row = document.createElement('div');
  row.className = 'logRow';

  // Left side (names)
  const label = document.createElement('div');
  label.style.flex = '1';

  appendPlantLabel(label, entry.commonName, entry.scientificName);

  // Right side (note)
  const note = document.createElement('textarea');
  note.className = 'logNote'
  note.value = entry.note || '';
  note.placeholder = 'note';
  note.rows = 1;

  // initial size AFTER attachment/layout
  requestAnimationFrame(() => resizeNote(note));

  // auto-grow + store
  note.addEventListener('input', () => {
    resizeNote(note, true);
    entry.note = note.value;
    storeTrailLogLater(trailId);
  });

  note.addEventListener('focus', () => {
    resizeNote(note, true);
  });

  note.addEventListener('blur', () => {
    resizeNote(note, false);
  });

  row.appendChild(label);
  row.appendChild(note);

  const del = document.createElement('button');
  del.textContent = '×';
  del.className = 'deleteBtn';

  del.onclick = () => {
    if (!confirm( `Delete "${entry.commonName}"?`))
      return;
    deleteLogEntry(entry, trailId);
    div.remove();
  };

  row.appendChild(del);
  div.appendChild(row);
  return div;
}

function appendPlantLabel(parent, commonName, scientificName) {
  const common = document.createElement('span');
  common.className = 'common';
  common.textContent = commonName;

  const scientific = document.createElement('span');
  scientific.className = 'scientific';
  scientific.textContent = scientificName;

  parent.appendChild(common);
  parent.appendChild(scientific);
}

function deleteLogEntry(entry, trailId) {
  const trailLog = getTrailLog(trailId);
  if (!trailLog) return;

  const entries = trailLog.entries;

  const i = entries.indexOf(entry);
  if (i >= 0) {
    entries.splice(i, 1);
  }

  storeTrailLog(trailId);
}

function resizeNote(note, expanded = false) {

  // width
  const minCh = note.placeholder.length + 1;
  if (expanded) {
    note.style.width = '24ch';
    note.style.whiteSpace = 'pre-wrap';
  } else {
    note.style.whiteSpace = 'pre';
    const len = note.value.trim().length;
    note.style.width = `${Math.min(Math.max(len + 2, minCh), 20)}ch`;
  }
  // height
  note.style.height = 'auto';
  note.style.height = note.scrollHeight + 'px';
}

// --- DOWNLOAD / EXPORT ---
async function saveSurvey() {
  if (!survey)
    return;

  try {
    flushPendingStores();

    const choice = await chooseAction("Save survey", [
      { label: "JSON", value: "json" },
      { label: "TSV", value: "tsv" },
      { label: "Cancel", value: null }
    ]);

    if (choice === null)
      return;

    const basename = `edgewood-survey-${surveyDateForFilename(survey)}`;

    if (choice === "json") {
      const jsonData = JSON.stringify(survey, null, 2);
      saveTextFile(`${basename}.json`, jsonData, 'application/json');
    } else if (choice === "tsv") {
      saveTextFile(`${basename}.tsv`, buildSurveyTsv(survey), 'text/tab-separated-values');
    }
  } catch (e) {
    console.error("Save failed", e);
    alert("Save failed:\n" + e.message);
  }
}
  
function surveyDateForFilename(data) {
  const date = (data?.note?.date || '').trim();

  const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, month, day, year] = match;
    return [
      year,
      month.padStart(2, '0'),
      day.padStart(2, '0')
    ].join('-');
  }

  return date
    .replace(/[^0-9A-Za-z]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'undated';
}

function saveTextFile(filename, data, type) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;

  document.body.appendChild(a);
  a.click();
  a.remove();

  // Delay revoke slightly to ensure save started in all browsers
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function buildSurveyTsv(survey) {
  const rows = [
    ...buildSurveyHeaderRows(survey),
    ...blankRows(4),
    ...buildSurveyLogRows(survey)
  ];

  return rows
    .map(row => row.map(formatTsvCell).join('\t'))
    .join('\n') + '\n';
}

function buildSurveyHeaderRows(survey) {
  const notes = survey.notes || {};
  const participantLines = splitParticipants(notes.participants || '');
  const rows = [];

  rows.push([
    `Date: ${notes.date || ''}`,
    `Participants: ${participantLines[0]}`
  ]);

  rows.push([
    'Hike:',
    participantLines[1]
  ]);

  rows.push([
    `Weather: ${formatSurveyWeather(notes)}`
  ]);

  const observedNotes = notes.notes
    .map(note => (note || '').trim())
    .filter(Boolean);

  if (observedNotes.length) {
    rows.push([
      `Also observed: ${observedNotes.join(' ')}`
    ]);
  }

  const trailNoteRows = buildTrailNoteRows(survey);
  if (trailNoteRows.length) {
    rows.push(...blankRows(3));
    rows.push(['Trail notes:', '', '', '', '']);
    rows.push(...trailNoteRows);
  }

  return rows;
}

function blankRows(count) {
  return Array.from({ length: count }, () => []);
}

function splitParticipants(participantsText) {
  const FIRST_PARTICIPANT_LINE_LIMIT = 60;
  const SECOND_PARTICIPANT_LINE_LIMIT = 74;
  const shortLine = participantsText
    .trim()
    .replace(/(?:,\s*)+$/, '');

  if (shortLine.length <= FIRST_PARTICIPANT_LINE_LIMIT)
    return [shortLine, ''];

  const participants = participantsText
    .split(',')
    .map(name => name.trim())
    .filter(Boolean);

  let bestSplit = 1;
  let bestOverflow = Infinity;
  let bestBalance = Infinity;

  for (let i = 1; i < participants.length; i++) {
    const first = participants.slice(0, i).join(', ');
    const second = participants.slice(i).join(', ');
    const overflow = Math.max(
      first.length - FIRST_PARTICIPANT_LINE_LIMIT,
      second.length - SECOND_PARTICIPANT_LINE_LIMIT,
      0
    );
    const balance = Math.abs(first.length - second.length);

    if (overflow < bestOverflow ||
        (overflow === bestOverflow && balance < bestBalance)) {
      bestSplit = i;
      bestOverflow = overflow;
      bestBalance = balance;
    }
  }

  return [
    participants.slice(0, bestSplit).join(', ') + ',',
    participants.slice(bestSplit).join(', ')
  ];
}

function formatSurveyWeather(notes) {
  const startWeather = [notes.startTime, notes.startWeather]
    .map(value => (value || '').trim())
    .filter(Boolean)
    .join(', ');

  const endWeather = [notes.endTime, notes.endWeather]
    .map(value => (value || '').trim())
    .filter(Boolean)
    .join(', ');

  return [startWeather, endWeather]
    .filter(Boolean)
    .join(' - ');
}

function buildTrailNoteRows(data) {
  const trailNotes = data.trailNotes || {};
  const rows = [];

  for (const trail of getOrderedSurveyTrails(data)) {
    const note = (trailNotes[trail.id] || '').trim();
    if (!note)
      continue;

    rows.push([`${trail.name}: ${note}`, '', '', '', '']);
  }

  return rows;
}

function buildSurveyLogRows(data) {
  const trailLogs = data.trailLogs || {};
  const columns = getOrderedSurveyTrails(data).map(trail => {
    const entries = trailLogs[trail.id]?.entries || [];

    return {
      name: trail.name,
      items: entries.map(entry => entry.commonName || '')
    };
  }).filter(column => column.items.length);

  const maxRows = columns.reduce(
    (max, column) => Math.max(max, column.items.length),
    0
  );

  const rows = [
    columns.map(column => column.name)
  ];

  for (let i = 0; i < maxRows; i++) {
    rows.push(columns.map(column => column.items[i] || ''));
  }

  return rows;
}

function getOrderedSurveyTrails(data) {
  return getSurveyTrailIds(data)
    .map(trailId => getTrailById(trailId))
    .filter(Boolean);
}

function getSurveyTrailIds(data) {
  const trailLogs = data.trailLogs || {};
  const trailNotes = data.trailNotes || {};
  const trailIds = [];
  const seen = new Set();

  for (const trailId of Object.keys(trailLogs)) {
    if (seen.has(trailId))
      continue;

    trailIds.push(trailId);
    seen.add(trailId);
  }

  for (const trailId of Object.keys(trailNotes)) {
    if (seen.has(trailId))
      continue;

    trailIds.push(trailId);
    seen.add(trailId);
  }

  return trailIds;
}

function getTrailById(trailId) {
  return trails.find(trail => trail.id === trailId) || {
    id: trailId,
    name: trailId
  };
}

function formatTsvCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- IMPORT SURVEY !! NOT READY FOR PRIME-TIME !! ---
async function importSurveyFile(event) {
  const input = event.target;
  const file = input.files?.[0];

  try {
    if (!file)
      return;

    if (survey) {
      const ok = confirm("Replace current survey with imported JSON?");
      if (!ok)
        return;
    }
    cancelPendingStores();

    const text = await file.text();
    console.log("Import file:", {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      start: text.slice(0, 200)
    });

    const imported = normalizeImportedSurvey(JSON.parse(text));

    console.log("Imported survey:", imported);

    localStorage.removeItem(storageKey("surveyExists"));
    clearStoredSurvey();

    survey = imported;

    const firstTrail = firstImportedTrail(imported) || null;
    setCurrentTrail(firstTrail);

    storeSurvey();
    localStorage.setItem(storageKey("surveyExists"), "true");

//    currentView = VIEW.NOTES;
//    currentNotePanel = NOTE_PANEL.START;

    setAppState(APP_STATE.ACTIVE);
    renderView();
    showMessage(`Imported ${file.name}`, 5000);

  } catch(e) {
    console.error("Import failed", e);
    alert("Import failed:\n" + e.message);
    showMessage("Import failed");
  } finally {
    input.value = "";
  }
}

function normalizeImportedSurvey(data) {
  const imported = requirePlainObject(data, "survey");

  return {
    startNote: normalizeImportedStartNote(imported.startNote),
    trailNotes: normalizeImportedTrailNotes(imported.trailNotes),
    closeNote: normalizeImportedCloseNote(imported.closeNote),
    trailLogs: normalizeImportedTrailLogs(imported.trailLogs || imported.trails)
  };
}

function normalizeImportedStartNote(startNote) {
  const start = requirePlainObject(startNote, "startNote");

  return {
    date: requireStringField(start, "date", "startNote"),
    time: requireStringField(start, "time", "startNote"),
    weather: requireStringField(start, "weather", "startNote"),
    participants: requireStringField(start, "participants", "startNote"),
    notes: requireStringField(start, "notes", "startNote")
  };
}

function normalizeImportedCloseNote(closeNote) {
  const close = requirePlainObject(closeNote, "closeNote");

  return {
    time: requireStringField(close, "time", "closeNote"),
    weather: requireStringField(close, "weather", "closeNote"),
    notes: requireStringField(close, "notes", "closeNote")
  };
}

function normalizeImportedTrailNotes(trailNotes) {
  const notes = requirePlainObject(trailNotes || {}, "trailNotes");
  const normalized = {};

  for (const trailId in notes) {
    if (typeof notes[trailId] !== "string")
      throw new Error(`Invalid trailNotes`);

    normalized[trailId] = notes[trailId];
  }

  return normalized;
}

function normalizeImportedTrailLogs(trailLogs) {
  const logs = requirePlainObject(trailLogs || {}, "trailLogs");
  const normalized = {};

  for (const trailId in logs) {
    const log = requirePlainObject(logs[trailId], `trailLogs.${trailId}`);
    const entries = log.entries;

    if (!Array.isArray(entries))
      throw new Error(`Invalid trailLogs.${trailId}.entries`);

    normalized[trailId] = {
      firstEntered: requireStringField(log, "firstEntered", `trailLogs.${trailId}`),
      entries: entries.map((entry, index) =>
        normalizeImportedLogEntry(entry, `trailLogs.${trailId}.entries.${index}`)
      )
    };
  }

  return normalized;
}

function normalizeImportedLogEntry(entry, path) {
  const item = requirePlainObject(entry, path);

  return {
    speciesId: item.speciesId,
    commonName: requireStringField(item, "commonName", path),
    scientificName: requireStringField(item, "scientificName", path),
    note: typeof item.note === "string" ? item.note : "",
    time: requireStringField(item, "time", path)
  };
}

function isPlainObject(value) {
  return (value !== null && typeof value === 'object' && !Array.isArray(value));
}

function requirePlainObject(value, name) {
  if (!isPlainObject(value))
    throw new Error(`Invalid ${name}`);

  return value;
}

function requireStringField(obj, key, path) {
  if (typeof obj[key] !== "string")
    throw new Error(`Invalid ${path}.${key}`);

  return obj[key];
}

function firstImportedTrail(imported) {
  for (const trailId of Object.keys(imported.trailLogs || {})) {
    if (imported.trailLogs[trailId]?.entries?.length)
      return trailId;
  }

  for (const trailId of Object.keys(imported.trailLogs || {})) {
    if (imported.trailLogs[trailId])
      return trailId;
  }

  return null;
}

// --- Time and Date ---
  // Timestamp: YYYY-MM-DD HH:MM:SS
function formatTimestamp(date = new Date()) {

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');

  return (`${yyyy}-${mm}-${dd} ` + `${hh}:${min}:${ss}`);
}

  // Date:      M/D/YYYY
function formatDate(date) {
  return date.toLocaleDateString(
    "en-US", { month: "numeric", day: "numeric", year: "numeric" }
  );
}

  // Time:      H:MM am/pm
function formatTime(date) {
  return date.toLocaleTimeString(
    "en-US", { hour: "numeric", minute: "2-digit" }
  ).toLowerCase();
}
