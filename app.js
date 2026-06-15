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

  if (version.branch !== "prod") {
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

  initializeCurrentTrail();

  setAppState(APP_STATE.ACTIVE);
}

function storageKey(key) {
  return `${STORAGE_TAG}:${key}`;
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

async function loadVersion(useFresh = false) {

  const response = await fetch("./version.json",
    {cache: useFresh ? "reload" : "default"}
  );

  if (!response.ok)
    throw new Error("Failed to load version");

  const data = await response.json();

  if (!data.version || !data.cacheName || !data.storageTag)
    throw new Error("Invalid version.json");

  return data;
}

function updateVersion() {
  ui.header.version.textContent =
    `${version.version}`;
}

function setStatus(text) {
  ui.header.status.textContent = text;
}

async function checkForUpdate() {

  if (!navigator.onLine)
    return null;

  try {
    const latest = await loadVersion({fresh: true});

    if (!version)
      return latest

    if (latest.version === version.version)
      return null;

    return latest;

  } catch (e) {
    console.warn("Update check failed", e);
    return null;
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
}

function renderLimitedState() {
  enterLimitedMode();
}

function enterLimitedMode() {

  ui.header.refreshBtn.style.display = "";
  ui.header.modeBtn.style.display = "none";
  ui.header.newBtn.style.display = "none";
  ui.header.downloadBtn.style.display = "none";

  ui.log.panel.style.display = "none";
  ui.notes.panel.style.display = "none";

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
  setStatus("Active Survey");
}

function initializeCurrentTrail() {

  const saved =
    localStorage.getItem(storageKey("currentTrail"));

  const valid =
    trails.some(t => t.id === saved);

  currentTrail =
    valid
      ? saved
      : trails?.[0]?.id
      || null;
}

function initUI() {
  ui.header = {
    modeBtn: document.getElementById("modeBtn"),
    newBtn: document.getElementById("newBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    downloadBtn: document.getElementById('downloadBtn'),
    version: document.getElementById('version'),
    status: document.getElementById('status')
  };

  ui.message = {
    panel: document.getElementById("messagePanel"),
    text: document.getElementById("messageText"),
    dismissBtn: document.getElementById("dismissMessageBtn")
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

function requireString(value, name) {

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

  const box =
    ui.notes.start
      .participants
      .parentElement
      .querySelector("#participantResults");

  box.innerHTML = "";

  if (!list.length) {
    box.style.display = "none";
    return;
  }

  box.style.display = "block";

  for (const name of list) {

    const div =
      document.createElement("div");

    div.textContent = name;
    div.className = "resultItem";

    div.onclick = () => {
      insertParticipant(name);
    };

    box.appendChild(div);
  }
}

function insertParticipant(name) {

  const input =
    ui.notes.start.participants;

  const pieces =
    input.value
      .split(",")
      .map(s => s.trim());

  // replace current token
  pieces[pieces.length - 1] = name;

  input.value =
    pieces.join(", ") + ", ";

  saveStartNote();

  input.focus();

  // move caret to end (important on mobile)
  input.setSelectionRange(
    input.value.length,
    input.value.length
  );

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
  window.visualViewport?.addEventListener(
    "resize",debounce(positionResults, 50)
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

  s.date.addEventListener("input", debounce(saveStartNote, 1500));
  s.time.addEventListener("input", debounce(saveStartNote, 1500));
  s.weather.addEventListener("input", debounce(saveStartNote, 1500));
  s.participants.addEventListener("beforeinput", validateParticipantInput);
  s.participants.addEventListener("input", debounce(handleParticipantInput, 50));
  s.participants.addEventListener("input", debounce(saveStartNote, 300));
  document.addEventListener("click", hideParticipantResults);
  s.notes.addEventListener("input", debounce(saveStartNote, 1500));
}

function initTrailNote() {

  const t = ui.notes.trail;

  t.notes.addEventListener("input", debounce(saveTrailNotes, 1500));
}

function initCloseNote() {

  const c = ui.notes.close;

  c.time.addEventListener("input", debounce(saveCloseNote, 1500));
  c.weather.addEventListener("input", debounce(saveCloseNote, 1500));
  c.notes.addEventListener("input", debounce(saveCloseNote, 1500));
}

function determineInitialMode() {
  if (survey) {
    currentMode = MODE.LOG;
  } else {
    currentMode = MODE.NOTES;
    currentNotePanel = NOTE_PANEL.START;
  }
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
    setCurrentTrail(e.target.value);
  });
}

function setCurrentTrail(id) {
  currentTrail = id;
  localStorage.setItem(storageKey('currentTrail'), id);

  syncTrailSelectors();

  renderLog();
  renderTrailNotes();
}

function syncTrailSelectors() {
  if (ui.log.trailSelect) {
    ui.log.trailSelect.value = currentTrail;
  }

  if (ui.notes.trail.trailSelect) {
    ui.notes.trail.trailSelect.value = currentTrail;
  }
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

  // restore last trail if needed
  if (!currentTrail) {
    currentTrail = localStorage.getItem(storageKey('currentTrail'))
      || trails?.[0]?.id
      || null;
  }

  // render sightings list
  renderLog();

  // clear search UI state (optional but clean)
  ui.log.results.innerHTML = '';

  // position results overlay
  requestAnimationFrame(positionResults);
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
    trails: {}
  };
}

// --- REFRESH APP ---
async function refreshApp() {
  showMessage("Refreshing...");

  try {

    if (!navigator.onLine)
      throw new Error("Offline");

    let freshVersion = await loadVersion({fresh: true});

    const cacheName = freshVersion.cacheName;

    const APP_SHELL = [
      './',
      './index.html',
      './app.js',
      './sw.js',
      './version.json',
      './plants.json',
      './trails.json',
      './participants.json',
      './manifest.json',
      './icons/foe-icon-512.png',
      './icons/foe-icon-192.png',
      './foe-logo.png'
    ];

    const refreshed = new Map();

    // Fetch everything first
    for (const file of APP_SHELL) {
      console.log("refreshing:", file);
      const request = new Request(file, { cache: "reload" });

      const response = await fetch(request);
      console.log(file, response.status, response.type);

      if (!response.ok)
        throw new Error(`Failed to refresh ${file}`);

      refreshed.set(file, response.clone());
    }

    // Commit only after success
    const cache = await caches.open(cacheName);

    for (const [file, response] of refreshed) {
      await cache.put(file, response);
    }

    showMessage("Refresh complete", 5000);

    // restart app
    location.reload();

  } catch (e) {
    console.error("REFRESH FAILED:", e);
    alert("Refresh failed:\n" + e.message);
    showMessage("Refresh failed");
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

  
  survey = createSurvey();

  setCurrentTrail(trails[0].id);

  localStorage.setItem(storageKey("surveyExists"), "true");

  // Go to start note
  currentMode = MODE.NOTES;
  currentNotePanel = NOTE_PANEL.START;

  // now we're in active state
  setAppState(APP_STATE.ACTIVE);

  // Populate UI
  renderMode();

  saveSurvey(survey);

  // put cursor in weather, we'll have populated time and date
    requestAnimationFrame(() => { ui.notes.start.weather?.focus(); });
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

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function saveSurvey(survey) {
  if (!survey)
    return;

  saveStartNote();
  saveTrailNotes();
  saveCloseNote();
  saveTrails();
}

function loadSurvey() {

  const surveyExists = localStorage.getItem(storageKey("surveyExists"));
  if (!surveyExists)
    return null;

  const survey = {};
  
//
// These should all have been created and saved in createSurvey()
//
  try {
    survey.startNote = loadStartNote();
    survey.closeNote = loadCloseNote();
    survey.trailNotes = loadTrailNotes();
    survey.trails = loadTrails();

    return survey;

  } catch(e) {
    console.error('Bad survey data', e);
    return null;
  }
}

function saveStartNote() {
  if (!survey)
    return;

  const s = ui.notes.start;

  survey.startNote = {
    date: s.date.value,
    time: s.time.value,
    weather: s.weather.value,
    participants: s.participants.value,
    notes: s.notes.value
  };

  localStorage.setItem(storageKey('startNote'),
    JSON.stringify(survey.startNote));
}


function loadStartNote() {

  const start = loadSection(storageKey("startNote"));

  if (start === null)
    throw new Error("Missing startNote");

  if (typeof start !== "object" || Array.isArray(start))
    throw new Error("Bad format for startNote");

  requireString(start.date, "startNote.date");
  requireString(start.time, "startNote.time");
  requireString(start.weather, "startNote.weather");
  requireString(start.participants, "startNote.participants");
  requireString(start.notes, "startNote.notes");

  return start;
}

function saveCloseNote() {
  if (!survey)
    return;

  const c = ui.notes.close;

  survey.closeNote = {
    time: c.time.value,
    weather: c.weather.value,
    notes: c.notes.value
  };

  localStorage.setItem(storageKey('closeNote'),
    JSON.stringify(survey.closeNote));
}

function loadCloseNote() {

  const close = loadSection(storageKey("closeNote"));

  if (close === null)
    throw new Error("Missing closeNote");

  if (typeof close !== "object" || Array.isArray(close))
    throw new Error("Bad format for closeNote");

  requireString(close.time, "closeNote.time");
  requireString(close.weather, "closeNote.weather");
  requireString(close.notes, "closeNote.notes");

  return close;
}

// We save all trail notes together
function saveTrailNotes() {

  if (!survey)
    return;

  // Get current UI value to memory, just in case
  survey.trailNotes[currentTrail]  = ui.notes.trail.notes.value;

  // Store all the trail notes
  localStorage.setItem(storageKey("trailNotes"),
    JSON.stringify(survey.trailNotes));
}

function loadTrailNotes() {
  const notes = loadSection(storageKey("trailNotes"));

  if (notes === null)
    throw new Error("Missing trailNotes");

  if (typeof notes !== "object" || Array.isArray(notes))
    throw new Error("Bad format for trailNotes");

  for (const trailId in notes) {
    requireString(notes[trailId], `trailNotes.${trailId}`);
  }

  return notes;
}

function saveTrails() {
  localStorage.setItem(storageKey('trails'), JSON.stringify(survey.trails));
}

function loadTrails() {
  const trails = loadSection(storageKey("trails"));

  if (trails === null)
    throw new Error("Missing trails log");

  if (typeof trails !== "object" || Array.isArray(trails))
    throw new Error ("Bad format for trails log");

  for (const trailId in trails) {
    const trail = trails[trailId];

    if (trail === null || typeof trail !== "object" || Array.isArray( trail))
      throw new Error(`Bad trail: ${trailId}`);

    requireString(trail.firstEntered, `trail ${trailId} .firstEntered`);

    if (!Array.isArray(trail.entries))
      throw new Error(`Bad entries: ${trailId}`);
  }

  return trails;
}

function ensureTrail(survey, trailId) {
  survey.trails[trailId] ??= {
    firstEntered: formatTimestamp(),
    entries: []
  };

  return survey.trails[trailId];
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
}

function renderTrailNotes() {

  if (!survey || !currentTrail) {
    return;
  }
  ui.notes.trail.notes.value = survey.trailNotes[currentTrail]  || '';

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
}

// --- Add sighting ---
function addSighting(item) {

  if (!survey) {
    alert('No active survey');
    return;
  }
  const trail = ensureTrail(survey, currentTrail);
  const entries = trail.entries;

  const duplicate = entries.some(e => e.speciesId === item.speciesId);
  if (duplicate) {
    if (!confirm('Already recorded on this trail. Add again?')) {
      return;
    }
  }

  // Add to END (most recent last)
  trail.entries.push({
    speciesId: item.speciesId,
    commonName: item.displayCommon,
    scientificName: item.scientificName,
    note: '', 
    time: formatTimestamp()
  });

  saveSurvey(survey);
  renderLog();
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
      .toLowerCase();;

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
    return;
  }

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

  if (!survey || !currentTrail) {
    ui.log.log.innerHTML = '';
    return;
  }
  const trail = ensureTrail(survey, currentTrail);

  const entries = trail.entries;

  const container = ui.log.log;
  container.innerHTML = '';

  entries.slice().reverse().forEach((entry, reverseIndex) => {

    const div = document.createElement('div');
    div.className = 'item';

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'flex-start';
    row.style.gap = '8px';

    // Left side (names)
    const label = document.createElement('div');
    label.style.flex = '1';

    label.innerHTML = `
      <span class="common">${entry.commonName}</span>
      <span class="scientific">${entry.scientificName}</span>
    `;

  // Right side (note)
  const note = document.createElement('textarea');

  note.value = entry.note || '';
  note.placeholder = 'note';

  note.rows = 1;

  note.style.flex = '0 1 auto';

  note.style.minWidth = '5ch';
  note.style.maxWidth = '50%';

  note.style.resize = 'none';
  note.style.overflow = 'hidden';
  note.style.font = 'inherit';
  note.style.lineHeight = 'inherit';
  // wrap nicely
  note.style.whiteSpace = 'pre';
  note.style.wordBreak = 'break-word';
note.style.paddingTop = '0';
note.style.paddingBottom = '0';
note.style.paddingLeft = '4px';
note.style.paddingRight = '4px';

note.style.boxSizing = 'border-box';
note.style.verticalAlign = 'top';

// initial size AFTER attachment/layout
setTimeout(() => resizeNote(note), 0);


// auto-grow + save
note.addEventListener('input', () => {
  resizeNote(note, true);
  entry.note = note.value;
  saveSurvey(survey);
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
      const ok = confirm(
        `Delete "${entry.commonName}"?`
      );
      if (!ok) {
        return;
      }
      const i = entries.indexOf(entry);
      if (i >= 0) {
        entries.splice(i, 1);
      }
      saveSurvey(survey);
      renderLog();
    };

    row.appendChild(del);
    div.appendChild(row);

    // Highlight most recent (last item)
    if (reverseIndex === 0) {
      div.style.background = '#e6ffe6';
      setTimeout(() => div.style.background = '', 400);
    }

    container.appendChild(div);
  });
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

  if (!survey)
    return;

  const data = JSON.stringify(survey, null, 2);

  if (!data) {
    alert('No survey data to download.');
    return;
  }

  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;

  const date = formatTimestamp().slice(0, 10);
  a.download = `edgewood-survey-${date}.json`;

  a.click();

  URL.revokeObjectURL(url);
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

