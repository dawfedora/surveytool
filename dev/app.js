"use strict";

// --- GLOBAL STATE ---
const APP_STATE = {
  BOOT: "BOOT",
  EMPTY: "EMPTY",
  ACTIVE: "ACTIVE",
  LIMITED: "LIMITED"
};

const MODE = {
  LOG: "log",
  NOTES: "notes"
};

const NOTE_PANEL = {
  START: "start",
  TRAIL: "trail",
  END: "end"
};

const ui = {
  header: {},
  message: {},
  log: {},
  notes: {
    start:{},
    trail: {},
    close: {}
  }
};

let  STORAGE_TAG = null;

let appState = APP_STATE.BOOT;

let DEFAULT_START_TRAIL = null;

let version = null;
let species = [];
let trails = [];
let participants = [];
let survey = null;
let currentTrail = null;
let currentMode = MODE.LOG;
let currentNotePanel = NOTE_PANEL.START;
let messageTimeoutId = null;
let headerInitialized = false;
let logViewInitialized = false;
let notesViewInitialized = false;
let pendingSaves = [];

const UPDATE_CHECK_TIMEOUT_MS = 5000;

const storeStartNoteLater = flushableDebounce(storeStartNote, 1500, pendingSaves);
const storeCloseNoteLater = flushableDebounce(storeCloseNote, 1500, pendingSaves);
const storeTrailNotesLater = flushableDebounce(storeTrailNotes, 1500, pendingSaves);
const storeTrailLogsLater = flushableDebounce(storeTrailLogs, 1500, pendingSaves);

document.addEventListener("DOMContentLoaded", init);

// --- INIT ---

async function init() {

  initUI();

  // Validate DOM
  const missing = validateUI(ui);
  if (missing.length) {
    console.error("Missing DOM elements:\n" + missing.join("\n"));
    return;
  }

  // wire the buttons, especially refresh
  initHeader();
  ui.header.refreshBtn.style.display = "";

  // Version
  try {
    version = await loadVersion()
    updateVersion();
  } catch(e) {
    console.error("Version load failed", e);
    showMessage("Version and config data not available\n");
    setAppState(APP_STATE.LIMITED);
    return;
  }

  STORAGE_TAG = version.storageTag;

  // Update Check
  const latest = await checkForUpdate();
  if (latest) {
    const doUpdate = confirm(
      `Newer version ${latest.version} is available.\n\nRefresh now?`
    );
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
    currentTrail = null;  // memory version only; leave localStorage alone
    setAppState(APP_STATE.EMPTY);
    return;
  }

  initializeCurrentTrail();

  setAppState(APP_STATE.ACTIVE);
}

function storageKey(key) {
  return `${STORAGE_TAG}:${key}`;
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

function makeTrailNoteHdlr(persist) {
  return (event) => {
    const text = event.target.value;
    if (text.trim())
      survey.trailNotes[currentTrail] = text;
    else
      delete survey.trailNotes[currentTrail];
    persist();
  };
}

function storeStartNote() {
  localStorage.setItem(storageKey('startNote'), JSON.stringify(survey.startNote));
}

function storeCloseNote() {
  localStorage.setItem(storageKey('closeNote'), JSON.stringify(survey.closeNote));
}

function storeTrailNotes() {
  localStorage.setItem(storageKey('trailNotes'), JSON.stringify(survey.trailNotes));
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

function cancellableDebounce(fn, delay = 2500) {
  let timer = null;

  function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, delay);
  }

  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };

  return debounced;
}

function trackPendingSave(fn) {
  pendingSaves.push(fn);
  return fn;
}

function cancelPendingSaves() {
  pendingSaves.forEach(fn => fn.cancel());
}

function flushPendingSaves() {
  pendingSaves.forEach(fn => fn.flush());
}

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

function updateVersion() {

  if (version.branch == "main")
    displayVersion = version.version.replace(/^main:/,"V");
  else
    displayVersion = version.version.replace(/:/,"");

  ui.header.version.textContent = $displayVersion;
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
  appState = state;

  switch (state) {
    case APP_STATE.EMPTY:
      renderEmptyState();
      break;
    case APP_STATE.ACTIVE:
      renderActiveState();
      break;
    case APP_STATE.LIMITED:
      renderLimitedState();
      break;
  }
}

function renderEmptyState() {
  ui.header.modeBtn.style.display = "none";
  ui.header.downloadBtn.style.display = "none";

  ui.log.panel.style.display = "none";
  ui.notes.panel.style.display = "none";

  setStatus("No Survey");
  setStateMessage("No current survey. Press New Survey to start one.");
}

function renderLimitedState() {

  ui.header.refreshBtn.style.display = "";
  ui.header.modeBtn.style.display = "none";
  ui.header.newBtn.style.display = "none";
  ui.header.downloadBtn.style.display = "none";

  ui.log.panel.style.display = "none";
  ui.notes.panel.style.display = "none";

  setStateMessage("Survey tool is not complete. Connect to the net and press Refresh.");
  setStatus("Refresh required");

  return; // STOP HERE
}

function renderActiveState() {


  ui.header.modeBtn.style.display = "";
  ui.header.newBtn.style.display = "";
  ui.header.downloadBtn.style.display = "";

  initHeader();
  initLogView();
  initNotesView();

  syncTrailSelectors();
  renderMode();
  clearStateMessage();
  setStatus("Active Survey");
}

function setCurrentTrail(id) {
  currentTrail = id;
  localStorage.setItem(storageKey('currentTrail'), id);
}

function initializeCurrentTrail() {

  const saved = localStorage.getItem(storageKey("currentTrail"));

  if (trails.some(t => t.id === saved)) {
    // Normally we would use setCurrentTrail(), but we just read it in.
    currentTrail = saved;
    return;
  }
  setCurrentTrail(DEFAULT_START_TRAIL);
}

function initUI() {
  ui.header = {
    modeBtn: document.getElementById("modeBtn"),
    newBtn: document.getElementById("newBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    importBtn: document.getElementById("importBtn"),
    importInput: document.getElementById("importInput"),
    downloadBtn: document.getElementById('downloadBtn'),
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
    buttons: {
      start: document.getElementById('startBtn'),
      trail: document.getElementById('trailBtn'),
      close: document.getElementById('closeBtn')
    },
    start: {
      panel: document.getElementById('startPanel'),
      date: document.getElementById('startDate'),
      time: document.getElementById('startTime'),
      weather: document.getElementById('startWeather'),
      participants: document.getElementById('participants'),
      notes: document.getElementById('startNote')
    },
    trail: {
      panel: document.getElementById('trailPanel'),
      trailSelect: document.getElementById('notesTrailSelect'),
      notes: document.getElementById('trailNotes')
    },
    close: {
      panel: document.getElementById('closePanel'),
      time: document.getElementById('closeTime'),
      weather: document.getElementById('closeWeather'),
      notes: document.getElementById('closeNote')
    }
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
  ui.header.modeBtn.addEventListener('click', toggleMode);
  ui.header.newBtn.addEventListener('click', newSurvey);
  ui.header.refreshBtn.addEventListener('click', refreshApp);
  ui.header.downloadBtn.addEventListener('click', downloadSurvey);
  ui.header.importBtn.addEventListener('click', () => {
    ui.header.importInput.click();
  });
  ui.header.importInput.addEventListener('change', importSurveyFile);
  ui.message.dismissBtn.addEventListener("click", clearMessage);
}

// --- LOAD LOCAL DATA ---
async function loadLocalData() {

  try {

    const dataFiles = [
      'plants',
      'trails',
      'participants'
    ];

    const responses = await Promise.all(
        dataFiles.map(name => fetch(`./${name}.json`))
    );

    responses.forEach(
      (response, i) => {
        if (!response.ok) throw new Error(`Failed to load ${dataFiles[i]}`);
      }
    );

    const parsed = await Promise.all(responses.map(r => r.json()));

    const loaded =
      Object.fromEntries(dataFiles.map((name, i) => [name, parsed[i]]));

    species = requireArray(loaded.plants, 'species', 'plants.json');
    species = processSpecies(species);
    trails = requireArray(loaded.trails, 'trails', 'trails.json');
    trails = processTrails(trails);
    participants = requireArray(loaded.participants, 'participants', 'participants.json');
    participants = processParticipants(participants);

  console.log(
    `Loaded ${trails.length} trails, ${species.length} species, ${participants.length} participants`
  );


    return true;
  } catch (e) {
    console.error('Failed to load local data', e);
    return false;
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
    } else if (!/^[a-zA-Z '()\-\/]+$/.test(common)) {
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
    } else if (!/^[a-zA-Z .\-]+$/.test(scientific)) {
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

function processTrails (trails) {
  // no processing yet
  DEFAULT_START_TRAIL = trails[0].id;
  return trails;
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

function validateSearchInput(event) {

  validateTextInput(event, /^[a-zA-Z\s,.\/'’-]+$/);
}

function validateParticipantInput(event) {

  validateTextInput(event, /^[a-zA-Z\s,.\/'’-]+$/);
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

function flashInvalidTextInput(input) {

  input.classList.add("inputRejected");

  setTimeout(() => {input.classList.remove("inputRejected");}, 120);
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

function hideParticipantResults(e) {
  const box = document.getElementById("participantResults");
  const input = ui.notes.start.participants;
  if (!box)
    return;

  if (e && (box.contains(e.target) || input.contains(e.target))) return;
  box.innerHTML = "";
  box.style.display = "none";
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

  const input = ui.notes.start.participants;

  const pieces =
    input.value
      .split(",")
      .map(s => s.trim());

  // replace current token
  pieces[pieces.length - 1] = name;

  input.value = pieces.join(", ") + ", ";

  survey.startNote.participants = input.value;
  storeStartNote();

  input.focus();

  // move caret to end (important on mobile)
  input.setSelectionRange(input.value.length, input.value.length);

  hideParticipantResults();
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

  ui.notes.buttons.start.addEventListener("click", () => {
    showNotesPanel(NOTE_PANEL.START);
  });
  ui.notes.buttons.trail.addEventListener("click", () => {
    showNotesPanel(NOTE_PANEL.TRAIL);
  });
  ui.notes.buttons.close.addEventListener("click", () => {
    showNotesPanel(NOTE_PANEL.END);
  });

  populateTrailSelector(ui.notes.trail.trailSelect);

  initStartNote();
  initTrailNote();
  initCloseNote();

  showNotesPanel(NOTE_PANEL.START); // or whatever default
}

function initStartNote() {

  const s = ui.notes.start;

  s.date.addEventListener("input", makeInputHdlr(() => survey?.startNote, "date", storeStartNoteLater));
  s.time.addEventListener("input", makeInputHdlr(() => survey?.startNote, "time", storeStartNoteLater));
  s.weather.addEventListener( "input", makeInputHdlr(() => survey?.startNote, "weather", storeStartNoteLater));
  s.notes.addEventListener("input", makeInputHdlr(() => survey?.startNote, "notes", storeStartNoteLater));
  s.participants.addEventListener("input", makeInputHdlr(() => survey?.startNote, "participants", storeStartNoteLater));

  s.participants.addEventListener("beforeinput", validateParticipantInput);
  s.participants.addEventListener("input", debounce(handleParticipantInput, 50));
  document.addEventListener("click", hideParticipantResults);
}

function initTrailNote() {
  const t = ui.notes.trail;
  
  t.notes.addEventListener("input", makeTrailNoteHdlr(storeTrailNotesLater));
}

function initCloseNote() {

  const c = ui.notes.close;

  c.time.addEventListener("input", makeInputHdlr(() => survey?.closeNote, "time", storeCloseNoteLater));
  c.weather.addEventListener("input", makeInputHdlr(() => survey?.closeNote, "weather", storeCloseNoteLater));
  c.notes.addEventListener("input", makeInputHdlr(() => survey?.closeNote, "notes", storeCloseNoteLater));
}

function populateTrailSelector(select) {
  select.innerHTML = "";

  trails.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    select.appendChild(opt);
  });
  select.value = currentTrail;

  select.addEventListener('change', (e) => {
    switchTrail(e.target.value);
  });
}

function switchTrail(id) {
  setCurrentTrail(id);
  syncTrailSelectors();
  renderLogView();
  renderTrailNotes();
}

function syncTrailSelectors() {

  if (ui.log.trailSelect)
    ui.log.trailSelect.value = currentTrail;

  if (ui.notes.trail.trailSelect)
    ui.notes.trail.trailSelect.value = currentTrail;
}

function toggleMode() {
  currentMode =
    currentMode === MODE.LOG
      ? MODE.NOTES
      : MODE.LOG;
  renderMode();
}

function renderMode() {
  if (currentMode === MODE.LOG) {
    ui.log.panel.style.display = '';
    ui.notes.panel.style.display = 'none';
    ui.header.modeBtn.textContent = 'Notes';
    renderLogView();
  } else {
    ui.log.panel.style.display = 'none';
    ui.notes.panel.style.display = '';
    ui.header.modeBtn.textContent = 'Log';
    renderNotesView();
  }
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

  ui.notes.start.panel.style.display = 'none';
  ui.notes.trail.panel.style.display = 'none';
  ui.notes.close.panel.style.display = 'none';

  ui.notes.buttons.start.classList.remove('activeNoteBtn');
  ui.notes.buttons.trail.classList.remove('activeNoteBtn');
  ui.notes.buttons.close.classList.remove('activeNoteBtn');

  if (currentNotePanel === NOTE_PANEL.START) {
    ui.notes.start.panel.style.display = '';
    ui.notes.buttons.start.classList.add('activeNoteBtn');
    renderStartNote();
  }

  if (currentNotePanel === NOTE_PANEL.TRAIL) {
    ui.notes.trail.panel.style.display = '';
    ui.notes.buttons.trail.classList.add('activeNoteBtn');
    renderTrailNotes();
  }

  if (currentNotePanel === NOTE_PANEL.END) {
    ui.notes.close.panel.style.display = '';
    ui.notes.buttons.close.classList.add('activeNoteBtn');
    renderCloseNote();
  }
}

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

function createSurvey() {
  const now = new Date();

  return {
    startNote: {
      date: formatDate(now),
      time: formatTime(now),
      weather: "",
      participants: "",
      notes: ""
    },
    trailNotes: {},
    closeNote: {
      time: "",
      weather: "",
      notes: ""
    },
    trailLogs: {}
  };
}

function focusField(field) {
  requestAnimationFrame(() => {
    field?.focus();
  });
}

// --- REFRESH APP ---
async function refreshApp() {
  flushPendingSaves();
  showMessage("Refreshing...");

  const oldCacheName = getCurrentCacheName();
  let stagingName = null;

  try {
    if (!navigator.onLine) throw new Error("Offline");

    const freshVersion = await loadVersion(true);

    // Stage downloads into a temporary cache first
    // Use a branch-specific temporary staging name.
    stagingName = `FoE:survey:${freshVersion.branch}:staging:${Date.now()}`;
    const staging = await caches.open(stagingName);

    // Fetch and populate staging cache
    for (const file of APP_SHELL) {
      console.log("staging refresh:", file);
      const req = new Request(file, { cache: "reload" });
      const res = await fetch(req);
      console.log(file, res.status, res.type);
      if (!res.ok) throw new Error(`Failed to refresh ${file}`);
      await staging.put(req, res.clone());
    }

    // Extract CACHE_NAME and APP_SHELL from staged shell-config.js (single source of truth)
    const shellRes = await staging.match('./shell-config.js');
    if (!shellRes) throw new Error('shell-config.js missing in staging');
    const shellText = await shellRes.text();
    // Evaluate in isolated function scope and return only the two expected values
    const cfg = (new Function(shellText + '\nreturn { CACHE_NAME, APP_SHELL };'))();
    const cacheName = cfg.CACHE_NAME;
    const newAppShell = cfg.APP_SHELL;
    console.log('Extracted cacheName from shell-config.js:', cacheName);

    // Verify staging contains every newAppShell entry (all-or-nothing)
    for (const file of newAppShell) {
      const req = new Request(file);
      const r = await staging.match(req);
      if (!r) throw new Error(`Staging missing ${file}`);
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

    if (oldCacheName && oldCacheName !== cacheName) {
      try {
        await caches.delete(oldCacheName);
      } catch (e) {
        console.warn('Could not delete old cache', oldCacheName, e);
      }
    }

    // Update in-page globals only after a successful commit so runtime
    // can immediately reflect the new shell if needed. The page will
    // also reload below which ensures a fresh environment.
    try {
      if (typeof window !== 'undefined') {
        window.APP_SHELL = newAppShell;
        window.CACHE_NAME = cacheName;
      }
    } catch (e) {
      console.warn('Could not assign globals after refresh commit', e);
    }

    showMessage("Refresh complete", 5000);

    // Now promote the waiting service worker (if any)
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        if (!reg.waiting) {
          try { await reg.update(); } catch (e) { console.warn('reg.update failed', e); }
        }

        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });

          // wait for the new controller before reloading
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('controllerchange timeout')), 5000);
            navigator.serviceWorker.addEventListener('controllerchange', function handler() {
              clearTimeout(timeout);
              resolve();
            }, { once: true });
          });

          location.reload();
          return;
        }
      }
    }

    // fallback: reload to pick up any changes
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

function getCurrentCacheName() {
  if (typeof CACHE_NAME === "string")
    return CACHE_NAME;

  if (typeof window !== "undefined" && typeof window.CACHE_NAME === "string")
    return window.CACHE_NAME;

  return null;
}

async function commitStagedCache(staging, cacheName, appShell, oldCacheName) {
  if (oldCacheName === cacheName) {
    await replaceCurrentCacheFromStaging(staging, cacheName, appShell);
    return;
  }

  // The normal path uses a new timestamped cache name. The old cache remains
  // untouched until the new one has been fully populated and verified.
  await caches.delete(cacheName);
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

function newSurvey() {

  // Existing Survey - ask first
  if (survey) {

    const ok = confirm("Delete current survey and start a new one?");
    if (!ok)
      return;
  }

  // Create new survey and save it

  localStorage.removeItem(storageKey("surveyExists"));

  cancelPendingSaves();

  clearStoredSurvey();
  
  survey = createSurvey();

  setCurrentTrail(DEFAULT_START_TRAIL);

  localStorage.setItem(storageKey("surveyExists"), "true");

  // Go to start note
  currentMode = MODE.NOTES;
  currentNotePanel = NOTE_PANEL.START;

  // now we're in active state
  setAppState(APP_STATE.ACTIVE);

  // Populate UI
  renderMode();

  saveSurvey();

  // put cursor in weather, we'll have populated time and date
    requestAnimationFrame(() => { ui.notes.start.weather?.focus(); });
}

async function importSurveyFile(event) {
  const input = event.target;
  const file = input.files?.[0];

  input.value = "";

  if (!file)
    return;

  if (survey) {
    const ok = confirm("Replace current survey with imported JSON?");
    if (!ok)
      return;
  }

  try {
    const imported = normalizeImportedSurvey(
      JSON.parse(await file.text())
    );

    cancelPendingSaves();
    clearStoredSurvey();

    survey = imported;

    const firstTrail = firstImportedTrail(imported) || DEFAULT_START_TRAIL;
    setCurrentTrail(firstTrail);

    localStorage.setItem(storageKey("surveyExists"), "true");
    saveSurvey();

    currentMode = MODE.NOTES;
    currentNotePanel = NOTE_PANEL.START;

    setAppState(APP_STATE.ACTIVE);
    renderMode();
    showMessage(`Imported ${file.name}`, 5000);

  } catch(e) {
    console.error("Import failed", e);
    alert("Import failed:\n" + e.message);
    showMessage("Import failed");
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
      throw new Error(`Invalid trailNotes.${trailId}`);

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

function requirePlainObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
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

function clearStoredSurvey() {
  localStorage.removeItem(storageKey("surveyExists"));
  localStorage.removeItem(storageKey("startNote"));
  localStorage.removeItem(storageKey("closeNote"));
  localStorage.removeItem(storageKey("trailNotes"));
  localStorage.removeItem(storageKey("trailLogs"));
}

function showNotesPanel(panel) {
  currentNotePanel = panel;
  renderNotesView();
}

// --- Storage ---
function loadSection(key) {

  const raw = localStorage.getItem(key);

  // never saved
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

function saveSurvey() {
  if (!survey)
    return;

  storeStartNote();
  storeTrailNotes();
  storeCloseNote();
  storeTrailLogs();
}

function loadSurvey() {

  const surveyExists = localStorage.getItem(storageKey("surveyExists"));
  if (!surveyExists)
    return null;

  const survey = {};
  
//
// These should all have been created and saved in newSurvey()
//
  try {
    survey.startNote = loadStartNote();
    survey.closeNote = loadCloseNote();
    survey.trailNotes = loadTrailNotes();
    survey.trailLogs = loadTrailLogs();

    return survey;

  } catch(e) {
    showMessage("Survey data appears corrupted. Please download/reset.");
    console.error('Bad survey data', e);
    return null;
  }
}

function loadStartNote() {

  const start = loadSection(storageKey("startNote"));

  if (start === null)
    throw new Error("Missing startNote");

  if (typeof start !== "object" || Array.isArray(start))
    throw new Error("Bad format for startNote");

  assertString(start.date, "startNote.date");
  assertString(start.time, "startNote.time");
  assertString(start.weather, "startNote.weather");
  assertString(start.participants, "startNote.participants");
  assertString(start.notes, "startNote.notes");

  return start;
}

function loadCloseNote() {

  const close = loadSection(storageKey("closeNote"));

  if (close === null)
    throw new Error("Missing closeNote");

  if (typeof close !== "object" || Array.isArray(close))
    throw new Error("Bad format for closeNote");

  assertString(close.time, "closeNote.time");
  assertString(close.weather, "closeNote.weather");
  assertString(close.notes, "closeNote.notes");

  return close;
}


function loadTrailNotes() {
  const notes = loadSection(storageKey("trailNotes"));

  if (notes === null)
    throw new Error("Missing trailNotes");

  if (typeof notes !== "object" || Array.isArray(notes))
    throw new Error("Bad format for trailNotes");

  for (const trailId in notes) {
    assertString(notes[trailId], `trailNotes.${trailId}`);
  }

  return notes;
}

function storeTrailLogs() {
  localStorage.setItem(storageKey('trailLogs'), JSON.stringify(survey.trailLogs));
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

function renderStartNote() {

  if (!survey) {
    return;
  }

  const s = ui.notes.start;
  const data = survey.startNote || {};

  s.date.value = data.date || '';
  s.time.value = data.time || '';
  s.weather.value = data.weather || '';
  s.participants.value = data.participants || '';
  s.notes.value = data.notes || '';
  focusField(s.weather);
}

function renderTrailNotes() {

  if (!survey || !currentTrail) {
    return;
  }
  ui.notes.trail.notes.value = survey.trailNotes[currentTrail]  || '';
  focusField(ui.notes.trail.notes);

}

function renderCloseNote() {

  if (!survey) {
    return;
  }

  const c = ui.notes.close;
  const data = survey.closeNote || {};

  c.time.value = data.time || '';
  c.weather.value = data.weather || '';
  c.notes.value = data.notes || '';
  focusField(c.weather);
}

// --- Add sighting ---
function addSighting(item) {

  if (!survey) {
    alert('No active survey');
    return;
  }
  const trailLog = ensureTrailLog(currentTrail);
  const entries = trailLog.entries;

  const duplicate = entries.some(e => e.speciesId === item.speciesId);
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

  saveLogEntry(entry);

  const row = createLogRow(entry);
  ui.log.log.prepend(row);
  highlightLogRow(row);
}

// --- SEARCH ---
function search(q) {

  q = normalizeQuery(q);

  if (q.length < 2) return [];
  
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

    if (common.startsWith(q) || scientific.startsWith(q))
      starts.push(item);

    else if (common.includes(qWord) || scientific.includes(qWord))
      wordStarts.push(item);

    else if (commonJoined.includes(qJoined))
      joined.push(item);

    else if (common.includes(q) || scientific.includes(q))
      contains.push(item);

  }

  return [
    ...starts,
    ...wordStarts,
    ...joined,
    ...contains
  ].slice(0, 30);
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

// --- Render results ---
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

    div.innerHTML = `
      <span class="common">${item.commonName}</span>
      <span class="scientific">${item.scientificName}</span>
    `;

    div.onclick = () => {
      addSighting(item);

      const input = ui.log.search;
      input.value = '';
      renderResults([]);

      input.focus();  // 👈 here
    };

    container.appendChild(div);
  });
}

// --- Render log ---
function renderLog() {
  const container = ui.log.log;
  container.innerHTML = '';

  if (!survey || !currentTrail) return;

  const trailLog = getTrailLog(currentTrail);
  if (!trailLog) return;

  trailLog.entries.slice().reverse().forEach((entry) => {
    const div = createLogRow(entry);
    container.appendChild(div);
  });
}

function highlightLogRow(row) {
      row.style.background = '#e6ffe6';
      setTimeout(() => row.style.background = '', 400);
}


function createLogRow(entry) {
    const div = document.createElement('div');
    div.className = 'item';

    const row = document.createElement('div');
    row.className = 'logRow';

    // Left side (names)
    const label = document.createElement('div');
    label.style.flex = '1';

    label.innerHTML = `
      <span class="common">${entry.commonName}</span>
      <span class="scientific">${entry.scientificName}</span>
    `;

    // Right side (note)
    const note = document.createElement('textarea');
    note.className = 'logNote'
    note.value = entry.note || '';
    note.placeholder = 'note';
    note.rows = 1;

    // initial size AFTER attachment/layout
    requestAnimationFrame(() => resizeNote(note));

    // auto-grow + save
    note.addEventListener('input', () => {
      resizeNote(note, true);
      entry.note = note.value;
      saveLogEntry(entry);
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
      deleteLogEntry(entry);
      div.remove();
    };

    row.appendChild(del);
    div.appendChild(row);
    return div;
}

function saveLogEntry(entry) {
  // Right now we save all the trails at once
  // later we may save trails individually
  storeTrailLogs();
}

function deleteLogEntry(entry) {
  const trailLog = getTrailLog(currentTrail);
  if (!trailLog) return;

  const entries = trailLog.entries;

  const i = entries.indexOf(entry);
  if (i >= 0) {
    entries.splice(i, 1);
  }

  storeTrailLogs();
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

function downloadSurvey() {

  flushPendingSaves();

  if (!survey)
    return;

  const jsonData = JSON.stringify(survey, null, 2);

  if (!jsonData) {
    alert('No survey data to download.');
    return;
  }

  const date = formatTimestamp().slice(0, 10);
  const basename = `edgewood-survey-${date}`;

  downloadTextFile(`${basename}.json`, jsonData, 'application/json');
  downloadTextFile(`${basename}.tsv`, buildSurveyTsv(survey), 'text/tab-separated-values');
}

function downloadTextFile(filename, data, type) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;

  a.click();

  // Delay revoke slightly to ensure download started in all browsers
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function buildSurveyTsv(data) {
  const rows = [
    ...buildSurveyHeaderRows(data),
    ...blankRows(4),
    ...buildSurveyLogRows(data)
  ];

  return rows
    .map(row => row.map(formatTsvCell).join('\t'))
    .join('\n') + '\n';
}

function buildSurveyHeaderRows(data) {
  const start = data.startNote || {};
  const close = data.closeNote || {};
  const participantLines = splitParticipants(start.participants || '');
  const rows = [];

  rows.push([
    `Date: ${start.date || ''}`,
    `Participants: ${participantLines[0]}`
  ]);

  rows.push([
    'Hike:',
    participantLines[1]
  ]);

  rows.push([
    `Weather: ${formatSurveyWeather(start, close)}`
  ]);

  const observedNotes = [start.notes, close.notes]
    .map(note => (note || '').trim())
    .filter(Boolean);

  if (observedNotes.length) {
    rows.push([
      `Also observed: ${observedNotes.join(' ')}`
    ]);
  }

  const trailNoteRows = buildTrailNoteRows(data);
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
  const participants = participantsText
    .split(',')
    .map(name => name.trim())
    .filter(Boolean);

  if (participants.length <= 1)
    return [participants.join(', '), ''];

  let bestSplit = 1;
  let bestDifference = Infinity;

  for (let i = 1; i < participants.length; i++) {
    const first = participants.slice(0, i).join(', ');
    const second = participants.slice(i).join(', ');
    const difference = Math.abs(
      `Participants: ${first}`.length - second.length
    );

    if (difference < bestDifference) {
      bestSplit = i;
      bestDifference = difference;
    }
  }

  return [
    participants.slice(0, bestSplit).join(', '),
    participants.slice(bestSplit).join(', ')
  ];
}

function formatSurveyWeather(start, close) {
  const startWeather = [start.time, start.weather]
    .map(value => (value || '').trim())
    .filter(Boolean)
    .join(', ');

  const closeWeather = [close.time, close.weather]
    .map(value => (value || '').trim())
    .filter(Boolean)
    .join(', ');

  return [startWeather, closeWeather]
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

//
// local timestamp
// YYYY-MM-DD HH:MM:SS
//
function formatTimestamp(date = new Date()) {

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');

  return (`${yyyy}-${mm}-${dd} ` + `${hh}:${min}:${ss}`);
}

function formatDate(date) {
  return date.toLocaleDateString(
    "en-US", { month: "numeric", day: "numeric", year: "numeric" }
  );
}

function formatTime(date) {
  return date.toLocaleTimeString(
    "en-US", { hour: "numeric", minute: "2-digit" }
  );
}
