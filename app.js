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
    updateStatus();
  } catch(e) {
    console.error("Version load failed", e);
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

async function loadVersion() {
  const response = await fetch("./version.json");

  if (!response.ok)
    throw new Error("Failed to load version");

  const data = await response.json();

  if (!data.version || !data.cacheName)
    throw new Error( "Invalid version.json");

  return data;
}

function updateStatus() {
  if (!ui.header.status || !version)
    return;
  ui.header.status.textContent = `V. ${version.version}`;
}

async function checkForUpdate() {

  if (!navigator.onLine || !version)
    return null;

  const response = await fetch("./version.json", {cache: "no-store"});

  if (!response.ok)
    return null;

  const latest = await response.json();

  if (latest.version === version.version)
    return null;

  return latest;
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

  ui.header.status.textContent =
    "No survey in progress. Press 'New Survey' to start.";
}

function renderLimitedState() {
  enterLimitedMode();
}

function enterLimitedMode() {

  ui.header.refreshBtn.onclick = refreshApp;

  ui.header.modeBtn.style.display = "none";
  ui.header.newBtn.style.display = "none";
  ui.header.downloadBtn.style.display = "none";

  ui.log.panel.style.display = "none";
  ui.notes.panel.style.display = "none";

  ui.header.status.textContent =
    "No local data. Connect to network and tap Refresh.";

  const status = ui.header.status;
  if (status) {
    status.textContent = "No data loaded. Tap Refresh while online.";
  }

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
}

function initializeCurrentTrail() {

  const saved =
    localStorage.getItem("survey:lastTrail");

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
    status: document.getElementById('status')
  };
  ui.log ={
    panel: document.getElementById('logView'),
    trailSelect: document.getElementById('logTrailSelect'),
    search: document.getElementById('search'),
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
  // Hook up buttons
  ui.header.modeBtn.addEventListener('click', toggleMode);
  ui.header.newBtn.addEventListener('click', newSurvey);
  ui.header.refreshBtn.addEventListener('click', refreshApp);
  ui.header.downloadBtn.addEventListener('click', downloadSurvey);
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

    const status = ui.header.status;
    if (status) {
      status.textContent = msg;
    }
  }
  console.log(
    `Loaded ${trails.length} trails, ${species.length} species`
  );

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

  window.addEventListener("resize", debounce(positionResults, 50));
  window.visualViewport?.addEventListener(
    "resize",debounce(positionResults, 50)
  );

  populateTrailSelector(ui.log.trailSelect);
}

function initNotesView() {
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

  s.date.addEventListener("input", debounce(saveStartNote, 300));
  s.time.addEventListener("input", debounce(saveStartNote, 300));
  s.weather.addEventListener("input", debounce(saveStartNote, 300));
  s.participants.addEventListener("beforeinput", validateParticipantInput);
  s.participants.addEventListener("input", debounce(handleParticipantInput, 50));
  s.participants.addEventListener( "input", debounce(saveStartNote, 300));
  document.addEventListener("click", hideParticipantResults);
  s.notes.addEventListener("input", debounce(saveStartNote, 300));
}

function initTrailNote() {

  const t = ui.notes.trail;

  t.notes.addEventListener("input", debounce(saveTrailNote, 300));
}

function initCloseNote() {

  const c = ui.notes.close;

  c.time.addEventListener("input", debounce(saveCloseNote, 300));
  c.weather.addEventListener("input", debounce(saveCloseNote, 300));
  c.notes.addEventListener("input", debounce(saveCloseNote, 300));
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
  localStorage.setItem(storageKey('survey:lastTrail', id));

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
    currentTrail = localStorage.getItem(storageKey('survey:lastTrail'))
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

function createSurvey() {

  const now = new Date();

  return {
    startNote: {
      date: formatDate(now),
      startTime: formatTime(now),
      weather: "",
      participants: "",
      notes: ""
    },
    endNote: {
      time: "",
      weather: "",
      notes: ""
    },
    trails: {}
  };
}

function formatDate(date) {
  return date.toLocaleDateString(
    "en-US",
    {
      month: "numeric",
      day: "numeric",
      year: "numeric"
    }
  );
}

function formatTime(date) {
  return date.toLocaleTimeString(
    "en-US",
    {
      hour: "numeric",
      minute: "2-digit"
    }
  );
}

// --- REFRESH APP ---
async function refreshApp() {
  const status = ui.header.status;
  status.textContent = 'Refreshing…';

  try {
    if (!navigator.onLine) { throw new Error('Offline'); }

    const cacheName = version.cacheName;

    if (!cacheName) { throw new Error('Missing cache name'); }

    const cache = await caches.open(cacheName);

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

    // refresh cached files
    for (const file of APP_SHELL) {
      console.log('refreshing:', file);
      const request = new Request(file, { cache: 'reload' });

      const response = await fetch(request);
      console.log(file, response.status, response.type);

      if (!response.ok) {
        throw new Error(`Failed to refresh ${file}`);
      }
      await cache.put(file, response.clone());
    }

    status.textContent = 'Refresh complete';

    // restart app
    location.reload();

  } catch (e) {
    console.error( 'REFRESH FAILED:', e);
    alert( 'Refresh failed:\n' + e.message);
    status.textContent = 'Offline mode using cached app';
  }
}

function newSurvey() {

  // Existing Survey - ask first
  if (survey) {

    const ok = confirm( "Delete current survey and start a new one?");
    if (!ok)
      return;
  }

  // Create new survey and save it
  survey = createSurvey();
  saveSurvey(survey);

  setCurrentTrail(trails[0].id);

  // Go to start note
  currentMode = MODE.NOTES;
  currentNotePanel = NOTE_PANEL.START;

  // now we're in active state
  setAppState(APP_STATE.ACTIVE);

  // Populate UI
  renderMode();

  // put cursor in weather, we'll have populated time and date
    requestAnimationFrame(() => { ui.notes.start.weather?.focus(); });
}

function showNotesPanel(panel) {
  currentNotePanel = panel;
  renderNotesView();
}

// --- Storage ---
function loadSurvey() {
  try {
    const survey = JSON.parse(
      localStorage.getItem(`survey`)
    );
    if (!survey) {
      return null;
    }

  // Ensure required top-level fields exist
  survey.startNote ??= {};
  survey.endNote ??= {};
  survey.trails ??= {};

  return survey;

  } catch(e) {
    console.error('Bad survey data', e);
    return null;
  }
}

function ensureTrail(survey, trailId) {
  if (!survey.trails[trailId]) {
    survey.trails[trailId] = {
      firstEntered: formatTimestamp(),
      notes: '',
      entries: []
    };
  }

  return survey.trails[trailId];
}

function saveSurvey(survey) {
  localStorage.setItem(storageKey('survey'), JSON.stringify(survey));
}

function saveStartNote() {

  if (!survey) {
    return;
  }

  const s = ui.notes.start;

  survey.startNote = {
    date: s.date.value,
    startTime: s.time.value,
    weather: s.weather.value,
    participants: s.participants.value,
    notes: s.notes.value
  };

  saveSurvey(survey);
}

function renderStartNote() {

  if (!survey) {
    return;
  }

  const s = ui.notes.start;
  const data = survey.startNote || {};

  s.date.value = data.date || '';
  s.time.value = data.startTime || '';
  s.weather.value = data.weather || '';
  s.participants.value = data.participants || '';
  s.notes.value = data.notes || '';
}

function saveTrailNote() {

  if (!survey || !currentTrail) {
    return;
  }

  const trail = ensureTrail(survey, currentTrail);

  trail.notes = ui.notes.trail.notes.value;

  saveSurvey(survey);
}

function renderTrailNotes() {

  if (!survey || !currentTrail) {
    return;
  }
  const trail = ensureTrail(survey, currentTrail);
  ui.notes.trail.notes.value = trail.notes || '';
}

function saveCloseNote() {

  if (!survey) {
    return;
  }

  const c = ui.notes.close;

  survey.endNote = {
    endTime: c.time.value,
    weather: c.weather.value,
    notes: c.notes.value
  };

  saveSurvey(survey);
}

function renderCloseNote() {

  if (!survey) {
    return;
  }

  const c = ui.notes.close;
  const data = survey.endNote || {};

  c.time.value = data.endTime || '';
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
  const data = localStorage.getItem(storageKey('survey'));

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

//
// display date
// MM/DD/YYYY
//
function formatDate(date) {
  return date.toLocaleDateString(
    'en-US', {year: 'numeric', month: '2-digit', day: '2-digit' }
  );
}

//
// display time
// HH:MM
//
function formatTime(date) {
  return date.toLocaleTimeString(
    'en-US',
    {hour: '2-digit', minute: '2-digit', hour12: false }
  );
}

