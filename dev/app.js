"use strict";

// push

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
let messageTimeoutId = null;
let pendingStores = [];
let activeChoiceOverlay = null;

const UPDATE_CHECK_TIMEOUT_MS = 5000;

const storeNotesLater = flushableDebounce(storeNotes, 1500, pendingStores);
const storeCompletedLogsLater = flushableDebounce(storeCompletedLogs, 1500, pendingStores);

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
  initLogView();
  initNotesView();

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
    setAppState(APP_STATE.EMPTY);
    return;
  }

  setAppState(APP_STATE.ACTIVE);
}

function showVersion() {
  let displayVersion = '';

  if (version.branch === "main")
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
  ui.log.view.hidden = true;
  ui.notes.view.hidden = true;

  clearSurveyUI();

  renderControls();

  setStatus("No Survey");
  setStateMessage("No current survey. Press New Survey to start one.");
}

function clearSurveyUI() {
  cancelPendingStores();

  ui.log.search.value = "";
  ui.log.results.innerHTML = "";
  ui.log.log.innerHTML = "";
  ui.log.trailSelect.innerHTML = "";

  ui.notes.date.value = "";
  ui.notes.participants.value = "";
  ui.notes.startTime.value = "";
  ui.notes.startWeather.value = "";
  ui.notes.endTime.value = "";
  ui.notes.endWeather.value = "";
  ui.notes.notes.value = "";

  hideParticipantResults();
}

function renderLimitedState() {

  ui.log.view.hidden = true;
  ui.notes.view.hidden = true;

  renderControls();

  setStateMessage("Survey tool is not complete. Connect to the net and press Refresh.");
  setStatus("Refresh required");

  return; // STOP HERE
}

function renderActiveState() {
  configureSurveyViews();

  renderControls();
  renderView();

  clearStateMessage();
  setStatus("Active Survey");
}

function configureSurveyViews() {
  chooseInitialView();
  populateLogTrailSelector();
}

function chooseInitialView() {
  switch (survey.phase) {
    case SURVEY_PHASE.START:
      currentView = VIEW.NOTES;
      break;

    case SURVEY_PHASE.FIELD:
      currentView = VIEW.LOG;
      break;

    case SURVEY_PHASE.END:
      currentView = VIEW.NOTES;
      break;

    default:
      throw new Error(
        `Cannot choose view for phase "${survey.phase}"`
      );
  }
}

function renderControls() {
  const active = appState === APP_STATE.ACTIVE;

  const starting = active && survey.phase === SURVEY_PHASE.START;
  const choosingStartingTrail = starting && currentView === VIEW.LOG;
  const field = active && survey.phase === SURVEY_PHASE.FIELD;
  const ended = active && survey.phase === SURVEY_PHASE.END;
  const options = ui.header.viewOptions;


  // view selector
    
  ui.header.viewSelect.hidden = !active;
  options.notes.disabled = !active || choosingStartingTrail;
  options.log.disabled = !(field || choosingStartingTrail);

  ui.header.startBtn.hidden = !starting || choosingStartingTrail;
  ui.header.startBtn.disabled = !startInfoComplete();

  ui.header.NextBtn.hidden = !(choosingStartingTrail || field);
  ui.header.NextBtn.disabled = !field;

  ui.header.endBtn.hidden = !(choosingStartingTrail || field);
  ui.header.endBtn.disabled = !field;

  ui.header.saveBtn.hidden = !ended;
  ui.header.saveBtn.disabled = !saveInfoComplete();

  // new survey button
  ui.header.newBtn.hidden = !(appState === APP_STATE.EMPTY || active);

  // app refresh button
  ui.header.refreshBtn.hidden = false;
 
  // notes end fields
  ui.notes.endTime.disabled = !ended;
  ui.notes.endWeather.disabled = !ended;

  // log search and trail select fields
  ui.log.search.disabled = !field;
  ui.log.trailSelect.disabled = !(choosingStartingTrail || field);
}

function startInfoComplete() {
  const notes = survey?.notes;

  return Boolean(
    notes &&
    notes.date.trim() &&
    notes.participants.trim() &&
    notes.startTime.trim() &&
    notes.startWeather.trim()
  );
}

function endInfoComplete() {
  const notes = survey?.notes;

  return Boolean(
    notes &&
    notes.endTime.trim() &&
    notes.endWeather.trim()
  );
}

// --- UI Wiring ---
function initUI() {

  ui.bootFallback = document.getElementById("bootFallback");
  const viewSelect = document.getElementById("viewSelect");

  ui.header = {
    panel: document.getElementById("globalHeader"),
    version: document.getElementById('version'),
    status: document.getElementById('status'),
    viewSelect: viewSelect,
    viewOptions: {
      log: viewSelect.querySelector(`option[value="log"]`),
      notes: viewSelect.querySelector(`option[value="notes"]`),
      route: viewSelect.querySelector(`option[value="route"]`)
    },
    startBtn: document.getElementById("startBtn"),
    endBtn: document.getElementById("endBtn"),
    saveBtn: document.getElementById('saveBtn'),
    newBtn: document.getElementById("newBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    importBtn: document.getElementById("importBtn"),
    importInput: document.getElementById("importInput")
  };

  ui.message = {
    panel: document.getElementById("messagePanel"),
    text: document.getElementById("messageText"),
    dismissBtn: document.getElementById("dismissMessageBtn"),
    statePanel: document.getElementById("stateMessagePanel")
  };

  ui.log ={
    view: document.getElementById('logView'),
    trailSelect: document.getElementById('logTrailSelect'),
    search: document.getElementById('search'),
    clearSearch: document.getElementById('clearSearch'),
    results: document.getElementById('results'),
    log:  document.getElementById('log'),
  };

  ui.notes = {
    view: document.getElementById('notesView'),
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

  // Hook up buttons
  ui.header.viewSelect.addEventListener('change', event => {
    currentView = event.target.value;
    renderView();
  });
  ui.header.startBtn.addEventListener('click', startSurvey);
  ui.header.nextBtn.addEventListener('click', populateTrailSelector);
  ui.header.endBtn.addEventListener('click', endSurvey);
  ui.header.saveBtn.addEventListener('click', saveSurvey);
  ui.header.newBtn.addEventListener('click', newSurvey);
  ui.header.refreshBtn.addEventListener('click', refreshApp);
  ui.header.importBtn.addEventListener('click', () => {
    ui.header.importInput.click();
  });
  ui.header.importInput.addEventListener('change', importSurveyFile);
  ui.message.dismissBtn.addEventListener("click", clearMessage);
}

function initLogView() {
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
  window.visualViewport?.addEventListener( "resize",
    debounce(positionResults, 50)
  );

  ui.log.trailSelect.addEventListener("change", handleTrailChange);
}

function initNotesView() {
  const n = ui.notes;

  n.date.addEventListener("input", makeInputHdlr(
    () => survey?.notes, "date", storeNotesLater));
  n.date.addEventListener("blur", finishFieldOnBlur(focusNextNotesField));
  n.date.addEventListener("keydown", finishFieldOnEnter);
  n.date.addEventListener("input", updateNoteReadiness);

  n.participants.addEventListener("input", makeInputHdlr(
    () => survey?.notes, "participants", storeNotesLater));
  n.participants.addEventListener("beforeinput", validateParticipantInput);
  n.participants.addEventListener("input", debounce(handleParticipantInput, 50));
  n.participants.addEventListener("input", updateNoteReadiness);

  n.startTime.addEventListener("input", makeInputHdlr(
    () => survey?.notes, "startTime", storeNotesLater));
  n.startTime.addEventListener("blur", finishFieldOnBlur(focusNextNotesField));
  n.startTime.addEventListener("keydown", finishFieldOnEnter);
  n.startTime.addEventListener("input", updateNoteReadiness);

  n.startWeather.addEventListener( "input", makeInputHdlr(
    () => survey?.notes, "startWeather", storeNotesLater));
  n.startWeather.addEventListener("blur", finishFieldOnBlur(focusNextNotesField));
  n.startWeather.addEventListener("keydown", finishFieldOnEnter);
  n.startWeather.addEventListener("input", updateNoteReadiness);

  n.endTime.addEventListener("input", makeInputHdlr(() => survey?.notes, "endTime", storeNotesLater));
  n.endTime.addEventListener("blur", finishFieldOnBlur(focusNextNotesField));
  n.endTime.addEventListener("keydown", finishFieldOnEnter);
  n.endTime.addEventListener("input", updateNoteReadiness);

  n.endWeather.addEventListener( "input", makeInputHdlr(() => survey?.notes, "endWeather", storeNotesLater));
  n.endWeather.addEventListener("blur", finishFieldOnBlur(focusNextNotesField));
  n.endWeather.addEventListener("keydown", finishFieldOnEnter);
  n.endWeather.addEventListener("input", updateNoteReadiness);

  n.notes.addEventListener("input", makeInputHdlr(() => survey?.notes, "notes", storeNotesLater));

  document.addEventListener("click", hideParticipantResults);
}

function updateNoteReadiness() {
  if (survey?.phase === SURVEY_PHASE.START)
    updateStartReadiness();
  else if (survey?.phase === SURVEY_PHASE.END)
    updateSaveReadiness();
}

function updateStartReadiness() {
  if (survey?.phase !== SURVEY_PHASE.START)
    return;

  const disabled = !startInfoComplete();

  if (ui.header.startBtn.disabled !== disabled)
    ui.header.startBtn.disabled = disabled;
}
     
function updateSaveReadiness() {
  if (survey?.phase !== SURVEY_PHASE.END)
    return;

  const disabled = !saveInfoComplete();

  if (ui.header.saveBtn.disabled !== disabled)
    ui.header.saveBtn.disabled = disabled;
}

function saveInfoComplete () {
   return startInfoComplete() && endInfoComplete();
}


function populateLogTrailSelector() {
  if (
    survey.phase === SURVEY_PHASE.START &&
    survey.route.currentLeg === ""
  ) {
    populateStartingPointSelector(ui.log.trailSelect);
  } else {
    populateTrailSelector(ui.log.trailSelect);
  }
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

  const request = useFresh
    ? makeRefreshRequest("./version.json")
    : new Request("./version.json");

  const response = await fetch(request, { signal });

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
    if (person === null)
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

  const posts = validatePosts(data.posts, errors);

  const directedSegments = processSegments(
    data.segments,
    trails,
    posts,
    errors
  );

  const segmentsByPost = indexSegmentsByPost(directedSegments);

  validatePostCoverage(posts, segmentsByPost, errors);

  validateTrailCoverage(trails, directedSegments, errors);

  const startingSegments = validateStartingPoints(
    data.startingPoints,
    trails,
    posts,
    segmentsByPost,
    errors
  );

  if (errors.length)
    throw new DataValidationError("Trail data is invalid", errors);

  return {
    trails,
    posts,
    startingSegments,
    directedSegments,
    segmentsByPost
  };
}

const TRAILID_PAT = /^[a-z]+$/;
const TRAILNAME_PAT = /^[A-Za-z]+(?:[ /][A-Za-z]+)*$/;
const TRAIL_KEYS = new Set(['id', 'name']);

function validateTrails(rawTrails, errors) {
  const trails = {};
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

    if (valid)
      trails[id] = name;

  });

  return trails;
}

const POSTID_PAT = /^(?:P[1-9][0-9]?|[A-Z]{2,})$/;
const POSTNAME_PAT = /^[A-Za-z]+(?:[ /][A-Za-z]+)*$/;
const POST_KEYS = new Set(['id', 'name']);

function validatePosts(rawPosts, errors) {
  const posts = {};
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

    if (valid)
      posts[id] = name;
  });

  return posts;
}

function processSegments(rawSegments, trails, posts, errors) {
  const directedSegments = [];
  const connections = new Set();

  rawSegments.forEach((rawSegment, index) => {
    const segment = validateSegment(
      rawSegment,
      index,
      trails,
      posts,
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
      id: makeLegId(segment.trailId, segment.startPost, segment.endPost),
      trailId: segment.trailId,
      fromPost: segment.startPost,
      toPost: segment.endPost,
      length: segment.length
    });

    if (segment.startPost !== segment.endPost) {
      directedSegments.push({
        id: makeLegId(segment.trailId, segment.endPost, segment.startPost),
        trailId: segment.trailId,
        fromPost: segment.endPost,
        toPost: segment.startPost,
        length: segment.length
      });
    }
  });

  return directedSegments;
}

function makeLegId (trailId, startPost, endPost) {
  return `${trailId}.${startPost}.${endPost}`;
}

function validateSegment( rawSegment, index, trails, posts, errors) {
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
  } else if (!Object.hasOwn(posts, startPost)) {
    errors.push(`${path}.startPost: unknown post "${startPost}"`);
    valid = false;
  } else {
    startPostValid = true;
  }

  const trailId = rawSegment.trailId;
  if (typeof trailId !== "string") {
    errors.push(`${path}.trailId: expected a string`);
    valid = false;
  } else if (!Object.hasOwn(trails, trailId)) {
    errors.push(`${path}.trailId: unknown trail "${trailId}"`);
    valid = false;
  }

  let endPostValid = false;
  const endPost = rawSegment.endPost;
  if (typeof endPost !== "string") {
    errors.push(`${path}.endPost: expected a string`);
    valid = false;
  } else if (!posts.has(endPost)) {
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
  for (const postId of Object.keys(posts)) {
    if (!segmentsByPost.has(postId)) {
      errors.push(
        `posts: post "${postId}" is not used by any segment`
      );
    }
  }
}

function validateTrailCoverage(trails, directedSegments, errors) {
  const usedTrailIds =
    new Set(directedSegments.map(segment => segment.trailId));

  for (const trailId of Object.keys(trails)) {
    if (!usedTrailIds.has(trailId)) {
      errors.push(`trails: trail "${trailId}" is not used by any segment`);
    }
  }
}

function validateStartingPoints(rawStartingPoints, trails, posts,
  segmentsByPost, errors
) {
  const startingSegments = [];
  const startingPointKeys = new Set();

  rawStartingPoints.forEach((rawStart, index) => {
    const path = `startingPoints[${index}]`;

    if (!isPlainObject(rawStart)) {
      errors.push(`${path}: expected an object`);
      return;
    }

    let valid = true;

    const postId = rawStart.postId;
    if (typeof postId !== "string") {
      errors.push(`${path}.postId: expected a string`);
      valid = false;
    } else if (!Object.hasOwn(posts, postId)) {
      errors.push(`${path}.postId: unknown post "${postId}"`);
      valid = false;
    }

    const trailId = rawStart.trailId;
    if (typeof trailId !== "string") {
      errors.push(`${path}.trailId: expected a string`);
      valid = false;
    } else if (!Object.hasOwn(trails, trailId)) {
      errors.push(`${path}.trailId: unknown trail "${trailId}"`);
      valid = false;
    }

    for (const field of Object.keys(rawStart)) {
      if (field !== "postId" && field !== "trailId") {
        errors.push(`${path}.${field}: unexpected field`);
        valid = false;
      }
    }

    if (!valid)
      return;

    const key = `${postId}:${trailId}`;


    if (startingPointKeys.has(key)) {
      errors.push(`${path}: duplicate starting point "${key}"`);
      return;
    }

    startingPointKeys.add(key);

    const matchingSegments =
      segmentsByPost.get(postId).filter(segment => segment.trailId === trailId);

    if (matchingSegments.length === 0) {
      errors.push(`${path}: "${trailId}" does not leave post "${postId}"`);
      return;
    }

    if (matchingSegments.length > 1) {
      errors.push(`${path}: trail "${trailId}" has multiple directions` +
        `from post "${postId}"`
      );
      return;
    }

    startingSegments.push(matchingSegments[0]);
  });

  return startingSegments;
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

function focusNextNotesField() {
  const fields = [
    ui.notes.date,
    ui.notes.participants,
    ui.notes.startTime,
    ui.notes.startWeather,
    ui.notes.endTime,
    ui.notes.endWeather,
    ui.notes.notes
  ];
  
  const next = fields.find(field =>
    !field.disabled &&
    !field.readOnly &&
    field.value.trim() === ""
  )

  next?.focus();
}

function refocusAfterSelection(input, afterFocus = null, delay = 150) {
//  input.blur();
//
//  setTimeout(() => {
    input.focus();
//    afterFocus?.();
//  }, delay);
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

// --- SURVEY PHASE ---
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
  ui.header.viewSelect.value = currentView;

  if (currentView === VIEW.LOG) {
    ui.log.view.hidden = false;
    ui.notes.view.hidden = true;
    renderLogView();
  } else if (currentView === VIEW.NOTES) {
    ui.log.view.hidden = true;
    ui.notes.view.hidden = false;
    renderNotesView();
  }
}

let segmentChoices = [];

function populateStartingPointSelector() {
  segmentChoices = trailNetwork.startingSegments;

  populateSegmentOptions(
    ui.log.trailSelect,
    "Choose starting point",
    segmentChoices
  );
}

function populateTrailSelector() {
  if (!survey.route.currentLeg)
    throw new Error("Cannot choose the next segment without a current leg");

  segmentChoices = buildNextSegmentChoices(
    survey.route.currentLeg,
    trailNetwork.segmentsByPost
  );

  populateSegmentOptions(
    ui.log.trailSelect,
    "Choose next leg",
    segmentChoices
  );
}

function populateSegmentOptions(select, promptText, choices) {
  select.replaceChildren();

  const prompt = document.createElement("option");
  prompt.value = "";
  prompt.textContent = promptText;
  prompt.disabled = true;
  prompt.selected = true;
  select.appendChild(prompt);

  choices.forEach((choice, index) => {
    const option = document.createElement("option");

    option.value = String(index);
    option.textContent = formatSegmentChoice(choice);

    select.appendChild(option);
  });

  select.hidden = false;
  select.focus();
}

function buildNextSegmentChoices(currentLeg, segmentsByPost) {
  const choices = [];
  const legSegments = currentLeg.segments;

  if (legSegments.length === 0)
    throw new Error("Current leg has no segment");

  const currentRay = legSegments[legSegments.length - 1];

  /*
   * Everything before the current ray has already been established
   * as part of this leg.
   */
  const establishedPath = legSegments.slice(0, -1);

  let incoming = currentRay;
  let path = [...establishedPath];

  const visitedSegments = new Set(
    establishedPath.map(segment => segment.sourceIndex)
  );

  let length = 0;

  while (incoming) {

    length += incoming.length;

    if (visitedSegments.has(incoming.sourceIndex))
      break;

    visitedSegments.add(incoming.sourceIndex);
    path.push(incoming);

    const postId = incoming.toPost;
    const outgoing = segmentsByPost.get(postId);

    if (!outgoing)
      throw new Error(`No segments leave post "${postId}"`);

    /*
     * Exclude the physical segment just traversed. Its reverse is
     * represented by the U-turn choice added at the end.
     */
    const forward = outgoing.filter(segment =>
      segment.sourceIndex !== incoming.sourceIndex
    );


    /*
     * Different-trail segments start possible new legs. Because we
     * walk the current trail outward, nearby branches are added
     * before more distant branches.
     */
    for (const segment of forward) {
      if (segment.trailId !== currentRay.trailId) {
        choices.push({
          kind: "turn",
          atPost: postId,
          path: [...path],
          nextSegment: segment
        });
      }
    }

    const continuations =
      forward.filter(segment => segment.trailId === currentRay.trailId);

    if (continuations.length === 0)
      break;

    if (continuations.length > 1)
      throw new Error( `Trail "${currentRay.trailId}" has multiple forward ` +
        `continuations at post "${postId}"`
      );

    incoming = continuations[0];
  }

  const reverse = findReverseSegment(currentRay, segmentsByPost);

  if (reverse && currentRay.fromPost !== currentRay.toPost) {
    choices.push({
      kind: "uturn",
      atPost: currentRay.toPost,
      path: [...establishedPath, currentRay],
      nextSegment: reverse
    });
  }

  return choices;
}

function findReverseSegment(segment, segmentsByPost) {
  const outgoing = segmentsByPost.get(segment.toPost);

  return outgoing.find(candidate =>
    candidate.sourceIndex === segment.sourceIndex &&
    candidate.fromPost === segment.toPost &&
    candidate.toPost === segment.fromPost
  ) || null;
}

function formatSegmentChoice(choice) {
  const segment = choice.nextSegment;
  const trailName =
    trailNetwork.trailById[segment.trailId].name;
  const destination =
    trailNetwork.postById[segment.toPost].name;

  if (choice.kind === "start") {
    if (segment.fromPost === segment.toPost)
      return `${choice.atPost} — ${trailName}`;

    return `${choice.atPost} — ${trailName} toward ${destination}`;
  }

  if (choice.kind === "uturn")
    return `U-turn — ${trailName} toward ${destination}`;

  return `${choice.atPost} — ${trailName} toward ${destination}`;
}

function renderLogView() {
  if (!survey) {
    ui.log.log.innerHTML = '';
    return;
  }

  // render sightings list
  renderCompletedLog(ui.log.log, survey.route.currentLeg);

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

function handleTrailChange(event) {
  const select = event.currentTarget;
  const choice = select.value;

  if (choice === "")
    return;

  const selection = segmentChoices[Number(choice)];

  if (!selection)
    throw new Error(`Invalid segment choice "${select.value}"`);

  select.hidden = true;

  transitionLeg(selection, );

  storeSurveyProgress();
  renderLogView();
  renderControls();
}

function beginFirstLeg(choice) {
  if (survey.currentLeg)
    throw new Error("Survey already has a current leg");

  survey.currentLeg = {
    segments: [choice.nextSegment],
    entries: []
  };

  setSurveyPhase(SURVEY_PHASE.FIELD);
}

function completeCurrentLeg(choice) {
  const currentLeg = survey.currentLeg;

  if (!currentLeg)
    throw new Error("Cannot complete a missing current leg");

  currentLeg.segments = choice.path;

  survey.log.push(currentLeg);

  survey.currentLeg = {
    segments: [choice.nextSegment],
    entries: []
  };
}

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

    // first get shell-config to see what files we need

    const shellReq = new Request("./shell-config.js");
    const freshShellReq = makeRefreshRequest("./shell-config.js");

    let shellRes = await fetch(freshShellReq);
    if (!shellRes.ok)
      throw new Error("Failed to fetch shell-config.js");
    await staging.put(shellReq, shellRes.clone());

    shellRes = await staging.match(shellReq);
    if (!shellRes)
      throw new Error('shell-config.js missing in staging');

    // Evaluate in isolated function scope; return only the two expected values

    const shellText = await shellRes.text();
    const cfg = (new Function(shellText + '\nreturn { CACHE_NAME, APP_SHELL };'))();
    const cacheName = cfg.CACHE_NAME;
    const newAppShell = cfg.APP_SHELL;
    console.log('Extracted cacheName from shell-config.js:', cacheName);

    // Now get the files

    for (const file of newAppShell) {
      const req = new Request(file);

      if (await staging.match(req))
        continue;

      const freshReq = makeRefreshRequest(file);
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
    if (vData.version !== freshVersion.version)
      throw new Error('Staging version mismatch');

    // Commit only after staging is complete and verified. If the target cache
    // is the currently active cache, preserve a backup so refresh failure can
    // restore the old shell.
    await commitStagedCache(staging, cacheName, newAppShell, oldCacheName);

    // Now fire off the new Service Worker

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

function makeRefreshRequest(url) {
  return new Request(url, {
    cache: "reload",
    headers: {
      "X-Survey-Refresh": "true"
    }
  });
}

async function waitForWorkerInstallation(worker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    if ( worker.state === "installed" || worker.state === "activated")
      return worker;

    if (worker.state === "redundant")
      throw new Error( "New service worker installation failed");

    const remaining = deadline - Date.now();

    if (remaining <= 0)
      throw new Error("Timed out waiting for new service worker to install");

    const stateChange = await waitForEvent(worker, "statechange", remaining);

    if (!stateChange)
      throw new Error( "Timed out waiting for new service worker to install");
  }
}

async function activateMatchingWaitingWorker(expectedCacheName) {
  if (!('serviceWorker' in navigator))
    return false;

  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg)
    return false;

  reg = await reg.update();

  let worker = reg.installing || reg.waiting;

  if (!worker)
    return false;

  worker = await waitForWorkerInstallation(worker, 15000);

  const info = await getServiceWorkerCacheInfo(worker, 3000);

  if (info.cacheName !== expectedCacheName)
    throw new Error(
      `Waiting service worker cache mismatch: expected ${expectedCacheName}, ` +
      `got ${info.cacheName || 'unknown'}`
    );

  if (navigator.serviceWorker.controller !== worker) {
    const controllerChange =
      waitForEvent(navigator.serviceWorker, "controllerchange", 5000);

    if (worker.state !== "activated")
      worker.postMessage({ type: 'SKIP_WAITING' });

    if (!await controllerChange)
      throw new Error(
       "Timed out waiting for new service worker to take control"
      );
  }

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

function waitForEvent(target, eventName, timeoutMs) {
  let resolveResult;
  let timeout;
  let finished = false;

  function finishWait(event) {
    if (finished)
      return;

    finished = true;

    clearTimeout(timeout);
    target.removeEventListener(eventName, finishWait);

    resolveResult(event || null);
  }

  const result = new Promise(resolve => {
    resolveResult = resolve;
  });

  target.addEventListener(eventName, finishWait);

  timeout = setTimeout(
    finishWait,
    timeoutMs
  );

  return result;
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
  const date = formatDate(now);
  let startTime = formatTime(now);

  // for now
  startTime = "8:00 am";

  return {
    phase: SURVEY_PHASE.START,
    notes: {
      date: date,
      participants: "",
      startTime: startTime,
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
}

function newSurvey() {
  if (survey) {
    // Existing Survey - ask first
    const ok = confirm("Delete current survey and start a new one?");
    if (!ok)
      return;
  }

  // remove old survey state

  cancelPendingStores();

  // clearStoredSurvey also removes surveyExists
  clearStoredSurvey();

  clearSurveyUI();


  // Create new survey and store it

  survey = createSurvey();

  currentView = VIEW.NOTES;

  storeSurvey();
  localStorage.setItem(storageKey("surveyExists"), "true");

  // now we're in active state
  setAppState(APP_STATE.ACTIVE);
}

function startSurvey() {
  
  // verify starting fields: date, time, weather, paricipants
  if (!startInfoComplete()) {
    showMessage("Fill in the starting information first");
    focusNextNotesField();
    return;
  }

  flushPendingStores();

  currentView = VIEW.LOG;
  renderControls();
  renderView();
  
  // focus selector
  ui.log.trailSelect.focus();
}

function endSurvey() {
  if (!survey)
    throw new Error("endSurvey called with no active survey!");

  if (survey.phase !== SURVEY_PHASE.FIELD ||
    survey.route.currentLeg === "") {
    throw new Error("Cannot end a survey without a current leg");
  }
  // Confirm end button

  flushPendingStores();

  completeCurrentLeg("");

  // set endTime
  survey.notes.endTime = formatTime(new Date);
  storeNotes();

  setSurveyPhase(SURVEY_PHASE.END);

  currentView = VIEW.NOTES;
  renderView();
  focusField(ui.notes.endWeather);
}

function storeSurvey() {
  if (!survey)
    return;

  storePhase();
  storeNotes();
  storeRoute();
  storeCurrentLog();
  // completedLogs get stored as they are completed
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
    survey.currentLog = loadCurrentLog();
    survey.completedLogs = loadCompletedLogs(survey.route);

    return survey;

  } catch(e) {
    showMessage("Survey data appears corrupted. Please save/reset.");
    console.error('Bad survey data', e);
    return null;
  }
}

function clearStoredSurvey() {
  clearAppStorage();
}

function clearAppStorage() {
  const prefix = `${STORAGE_TAG}:`;

  const keys = [];

  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);

    if (key?.startsWith(prefix))
      keys.push(key);
  }

  for (const key of keys)
    localStorage.removeItem(key);
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
  
  if (route.currentLeg !== null && !isPlainObject(route.currentLeg))
    throw new Error("Bad route.currentLeg");

  if (!Array.isArray(route.legs))
     throw new Error("Invalid route.legs");

// make sure the legs are all appropriate object

  return route;
}

function loadCurrentLog() {
  const currentLog = loadSection(storageKey("logs.current"));

  if (currentLog !== null && !Array.isArray(currentLog))
    throw new Error("Invalid survey.currentLog");

  return currentLog
}

function loadCompletedLogs(route) {

  // how much do we have to validate route before using it?  It should be pretty validated.  Maybe just make sure it exists so we don't blow up?

  const completedLogs = {};

  for (const leg of route.legs) {

    if (!Object.hasOwn(completedLogs, leg.id))
      completedLogs[leg.id] = loadCompletedLog(leg.id);
  }

  return completedLogs;
}

function loadCompletedLog(legId) {
  const data = loadSection(storageKey(`logs.${legId}`));

  if (data === null)
    throw new Error(`Missing log for leg "${legId}"`);

  if (!Array.isArray(data))
    throw new Error(`Invalid log for leg "${legId}"`);

  return data;
}

function storeNotes() {
  localStorage.setItem(storageKey('notes'), JSON.stringify(survey.notes));
}

function storeRoute() {
  localStorage.setItem(storageKey('route'), JSON.stringify(survey.route));
}

function storageKey(key) {
  return `${STORAGE_TAG}:${key}`;
}

function storeCurrentLog() {
  localStorage.setItem(storageKey('logs.current'),
    JSON.stringify(survey.logs.current));
}

function storeCompletedLog(legId) {
  localStorage.setItem(storageKey(`logs.${legId}`),
    JSON.stringify(survey.completedLogs[legId]));
}

function storeCompletedLogLater(trailId) {
  void trailId;
  storeCompletedLogsLater();
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

  const box = ui.notes.participants.parentElement.querySelector("#participantResults");

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

  survey.notes.participants = input.value;
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
function getCompletedLog(trailId) {
  return survey?.completedLogs?.[trailId] || null;
}

function ensureCompletedLog(trailId) {
  survey.completedLogs[trailId] ??= {
    firstEntered: formatTimestamp(),
    entries: []
  };

  return survey.completedLogs[trailId];
}

function addSighting(item) {

  if (!survey) {
    alert('No active survey');
    return;
  }

  const entries = survey.currentLog;

  const duplicate = entries.some(e => e.commonName === item.displayCommon);

  if (duplicate && !confirm('Already recorded on this trail. Add again?'))
    return;

  // Add to END (most recent last)
  const entry = {
    speciesId: item.speciesId,
    commonName: item.displayCommon,
    scientificName: item.scientificName,
    note: "",
    time: formatTimestamp()
  };
  entries.push(entry);

  storeCurrentLog();

  const row = createLogRow(entry, null);
  ui.log.log.prepend(row);
  highlightLogRow(row);
}

function highlightLogRow(row) {
  row.style.background = '#e6ffe6';
  setTimeout(() => row.style.background = '', 400);
}

function renderCompletedLog(container, trailId) {
  container.innerHTML = '';

  if (!survey || !trailId)
    return;

  const completedLog = getCompletedLog(trailId);
  if (!completedLog)
    return;

  completedLog.entries.slice().reverse().forEach((entry) => {
    const row = createLogRow(entry, trailId);
    container.appendChild(row);
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
  note.autocapitalize = "none";

  // initial size AFTER attachment/layout
  requestAnimationFrame(() => resizeNote(note));

  // auto-grow + store
  note.addEventListener('input', () => {
    resizeNote(note, true);
    entry.note = note.value;
    storeCompletedLogLater(trailId);
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
  const completedLog = getCompletedLog(trailId);
  if (!completedLog) return;

  const entries = completedLog.entries;

  const i = entries.indexOf(entry);
  if (i >= 0) {
    entries.splice(i, 1);
  }

  storeCompletedLog(trailId);
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
  const date = (data?.notes?.date || '').trim();

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

  const observedNotes = (notes.notes || "")
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)
    .join(", ");

  if (observedNotes) {
    rows.push(...blankRows(3));
    rows.push([
      `Also Observed: ${observedNotes}`
    ]);
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

function buildSurveyLogRows(data) {
  const completedLogs = data.completedLogs || {};
  const columns = getOrderedSurveyTrails(data).map(trail => {
    const entries = completedLogs[trail.id]?.entries || [];

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
  const completedLogs = data.completedLogs || {};
  const trailNotes = data.trailNotes || {};
  const trailIds = [];
  const seen = new Set();

  for (const trailId of Object.keys(completedLogs)) {
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

    // clearStoredSurvey also clears surveyExists
    clearStoredSurvey();

    survey = imported;

    const firstTrail = firstImportedTrail(imported) || null;
    setCurrentTrail(firstTrail);

    storeSurvey();
    localStorage.setItem(storageKey("surveyExists"), "true");

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
    completedLogs: normalizeImportedCompletedLogs(imported.completedLogs || imported.trails)
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

function normalizeImportedCompletedLogs(completedLogs) {
  const logs = requirePlainObject(completedLogs || {}, "completedLogs");
  const normalized = {};

  for (const trailId in logs) {
    const log = requirePlainObject(logs[trailId], `completedLogs.${trailId}`);
    const entries = log.entries;

    if (!Array.isArray(entries))
      throw new Error(`Invalid completedLogs.${trailId}.entries`);

    normalized[trailId] = {
      firstEntered: requireStringField(log, "firstEntered", `completedLogs.${trailId}`),
      entries: entries.map((entry, index) =>
        normalizeImportedLogEntry(entry, `completedLogs.${trailId}.entries.${index}`)
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
  for (const trailId of Object.keys(imported.completedLogs || {})) {
    if (imported.completedLogs[trailId]?.entries?.length)
      return trailId;
  }

  for (const trailId of Object.keys(imported.completedLogs || {})) {
    if (imported.completedLogs[trailId])
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
