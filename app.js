// --- GLOBAL STATE ---
const ui = {
  header: {},
  log: {},
  notes: {
    start:{},
    trail: {},
    close: {}
  }
};
let species = [];
let trails = [];
let survey = null;
let currentTrail = null;
let currentMode = 'log';
let currentNotePanel = 'start';
let version = null;

function debounce(fn, delay = 300) {
  let timer = null;

  return function (...args) {
    clearTimeout(timer);

    timer = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

document.addEventListener('DOMContentLoaded', init);

// --- INIT ---

async function init() {

  initUI();

  // Validate DOM
  const missing = validateUI(ui);
  if (missing.length) {
    console.error('Missing DOM elements:\n' + missing.join('\n'));
    return;
  }

  // Load running version info
  try {
    version = await loadVersion();
    updateStatus();
  } catch (e) {
    console.error('Version load failed', e);
    if (ui.header.status)
      ui.header.status.textContent = 'Unknown version';
  }

  // Async update check
  checkForUpdate().catch(e => console.warn('Version check failed', e));

  // Load datasets
  const ok = await loadLocalData();

  if (!ok) {
    enterLimitedMode();
    return;
  }

  //
  // Restore state
  //
  initializeCurrentTrail();

  survey = loadSurvey();

  determineInitialMode();

  // Initialize UI
  initHeader();
  initLogView();
  initNotesView();

  syncTrailSelectors();

  renderMode();
}

async function loadVersion() {
  const response = await fetch('./version.json');

  if (!response.ok)
    throw new Error('Failed to load version');

  const data = await response.json();

  if (!data.version || !data.cacheName)
    throw new Error( 'Invalid version.json');

  return data;
}

function updateStatus() {
  if (!ui.header.status || !version)
    return;
  ui.header.status.textContent = `Vers: ${version.version}`;
}

async function checkForUpdate() {

  if (!navigator.onLine)
    return;

  const response = await fetch('./version.json', {cache: 'no-store'});

  if (!response.ok)
    return;

  const latest = await response.json();

  if (latest.version !== version.version) {
    ui.header.status.textContent =
       `Vers: ${version.version} (Update available)`;
  }
}

function enterLimitedMode() {

  ui.header.refreshBtn.onclick = refreshApp;

  ui.header.modeBtn.style.display = 'none';
  ui.header.newBtn.style.display = 'none';
  ui.header.downloadBtn.style.display = 'none';

  ui.log.panel.style.display = 'none';
  ui.notes.panel.style.display = 'none';

  ui.header.status.textContent =
    'No local data. Connect to network and tap Refresh.';

  const status = ui.header.status;
  if (status) {
    status.textContent = 'No data loaded. Tap Refresh while online.';
  }

  return; // 🚨 STOP HERE
}

function initializeCurrentTrail() {

  const saved =
    localStorage.getItem('lastTrail');

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
    modeBtn: document.getElementById('modeBtn'),
    newBtn: document.getElementById('newBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
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
      'trails'
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
    trails = requireArray(loaded.trails, 'trails', 'trails.json');

    let dropped = 0;
    let missingCommon = 0;
    let missingScientific = 0;

    // Normalize once
    species = species.filter(s => {
      let common = s.commonName?.trim();
      let scientific = s.scientificName?.trim();

      // Remove completely broken entries
      if (!common && !scientific) {
        dropped++;
        console.warn('Dropped empty species record', s);
        return false;
      }

      // Repair partial entries
      if (!common) {
        missingCommon++;
        common = '[no common name]';
      }
      if (!scientific) {
        missingScientific++;
        scientific = '[no scientific name]';
      }
      // Normalize back into object
      s.commonName = common;
      s.scientificName = scientific;
      s._common = common.toLowerCase();
      s._scientific = scientific.toLowerCase();
      s.displayCommon = common + (s.status || '');

      return true;
    });

    if (dropped) console.warn(`Dropped ${dropped} invalid species`);

    if (missingCommon || missingScientific) {
      let msg = 'Plant data warning: ';
      if (missingCommon) msg += `${missingCommon} missing common names`;
      if (missingCommon && missingScientific) msg += ', ';
      if (missingScientific) {
        msg += `${missingScientific} missing scientific names`;
      }
      console.warn(msg);

      const status = ui.header.status;
      if (status) {
        status.textContent = msg;
      }
    }
    console.log(`Loaded ${trails.length} trails, ${species.length} species`);
    return true;
  } catch (e) {
    console.error('Failed to load local data', e);
    return false;
  }
}

function requireArray(obj, key, filename) {

  if (!obj || !Array.isArray(obj[key])) throw new Error(`Invalid ${filename}`);

  return obj[key];
}

function normalizeCommon(str) {
  return (str || '')
    .toLowerCase()
    .trim()
    // replace funky apostrophes
    .replace(/[’']/g, "'")
    .replace(/-/g, ' ')
    .replace(/(\w+)'s/, '$1s')
    .replace(/(\w+)s'/, '$1s')
    .replace(/\s+/g, ' ');
}

function initLogView() {
  // Hook search
  let searchTimer;
  ui.log.search.addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const results = search(e.target.value);
      renderResults(results);
    }, 100);
  });

  window.addEventListener('resize', debounce(positionResults, 50));
  window.visualViewport?.addEventListener( 'resize', debounce(positionResults, 50));

  populateTrailSelector(ui.log.trailSelect);
}

function initNotesView() {
  ui.notes.buttons.start.addEventListener('click', () => {
    showNotesPanel('start');
  });
  ui.notes.buttons.trail.addEventListener('click', () => {
    showNotesPanel('trail');
  });
  ui.notes.buttons.close.addEventListener('click', () => {
    showNotesPanel('close');
  });

  populateTrailSelector(ui.notes.trail.trailSelect);

  initStartNote();
  initTrailNote();
  initCloseNote();

  showNotesPanel('start'); // or whatever default
}

function initStartNote() {

  const s = ui.notes.start;

  s.date.addEventListener('input', debounce(saveStartNote, 300));
  s.time.addEventListener('input', debounce(saveStartNote, 300));
  s.weather.addEventListener('input', debounce(saveStartNote, 300));
  s.participants.addEventListener('input', debounce(saveStartNote, 300));
  s.notes.addEventListener('input', debounce(saveStartNote, 300));
}

function initTrailNote() {

  const t = ui.notes.trail;

  t.notes.addEventListener('input', debounce(saveTrailNote, 300));
}

function initCloseNote() {

  const c = ui.notes.close;

  c.time.addEventListener('input', debounce(saveCloseNote, 300));
  c.weather.addEventListener('input', debounce(saveCloseNote, 300));
  c.notes.addEventListener('input', debounce(saveCloseNote, 300));
}

function determineInitialMode() {
  if (survey) {
    currentMode = 'log';
  } else {
    currentMode = 'notes';
    currentNotePanel = 'start';
  }
}

function populateTrailSelector(select) {
  select.innerHTML = '';

  trails.forEach(t => {
    const opt = document.createElement('option');
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
  localStorage.setItem('lastTrail', id);

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
    currentMode === 'log'
      ? 'notes'
      : 'log';
  renderMode();
}

function renderMode() {
  if (currentMode === 'log') {
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
    currentTrail = localStorage.getItem('lastTrail')
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

  if (currentNotePanel === 'start') {
    ui.notes.start.panel.style.display = '';
    ui.notes.buttons.start.classList.add('activeNoteBtn');
    renderStartNote();
  }

  if (currentNotePanel === 'trail') {
    ui.notes.trail.panel.style.display = '';
    ui.notes.buttons.trail.classList.add('activeNoteBtn');
    renderTrailNotes();
  }

  if (currentNotePanel === 'close') {
    ui.notes.close.panel.style.display = '';
    ui.notes.buttons.close.classList.add('activeNoteBtn');
    renderCloseNote();
  }
}

function createEmptySurvey() {
  return {
    meta: {
      created: formatTimestamp(),
      updated: formatTimestamp()
    },
    startNote: {
      date: '',
      startTime: '',
      weather: '',
      participants: '',
      notes: ''
    },
    endNote: {
      endTime: '',
      weather: '',
      notes: ''
    },
    trails: {}
  };
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
      './foe-logo.png',
      './manifest.json'
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
  const ok = confirm(
    'Start a new survey?'
  );

  if (!ok) {
    return;
  }

  survey = createEmptySurvey();
  saveSurvey(survey);
  currentMode = 'notes';
  currentNotePanel = 'start';
  renderMode();
  showNotesPanel('start');
}

function showNotesPanel(panel) {

  currentNotePanel = panel;

  renderNotesView();
}

// --- Storage ---
function loadSurvey() {
  try {
    const survey = JSON.parse(
      localStorage.getItem('survey')
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
  localStorage.setItem('survey', JSON.stringify(survey));
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

  survey.meta.updated = formatTimestamp();

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

  survey.meta.updated = formatTimestamp();

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

  survey.meta.updated = formatTimestamp();

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

  const duplicate = entries.some(e => e.speciesId == item.speciesId);
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

function clearSurvey() {
  const confirmClear = confirm('Clear all survey data?');

  if (!confirmClear) return;

  survey = null;
  localStorage.removeItem('survey');

  determineInitialMode();
  renderMode();

  const status = ui.header.status;
  if (status) {
    status.textContent = 'Survey cleared';
    setTimeout(() => {
      const last = localStorage.getItem('lastUpdated');
      if (last) {
        status.textContent =
          'Data updated: ' + new Date(last).toLocaleString();
      } else {
        status.textContent = '';
      }
    }, 1500);
  }
}

// --- SEARCH ---
function search(q) {
  if (!Array.isArray(species)) return [];

  q = (q || '').toLowerCase();

  if (q.length < 2) return [];

  if (q.length < 3) {
    return species.filter(item => {
      return item._common.startsWith(q) || item._scientific.startsWith(q);
    });
  }

  const exactWord = [];   // NEW
  const starts = [];
  const wordStarts = [];
  const contains = [];

  species.forEach(item => {
    const common = (item._common || '');
    const scientific = (item._scientific || '');

    //  Exact match on starting word (best)
    if (
      common.startsWith(q + ' ') ||
      scientific.startsWith(q + ' ')
    ) {
      exactWord.push(item);
      return;
    }

    // starts with q
    if (common.startsWith(q) || scientific.startsWith(q)) {
      starts.push(item);
      return;
    }

    // a non-leading word starts with q
    if (
      common.includes(' ' + q) ||
      scientific.includes(' ' + q)
    ) {
      wordStarts.push(item);
      return;
    }

    // q is in there
    if (
      common.includes(q) ||
      scientific.includes(q)
    ) {
      contains.push(item);
    }
    });

  return [
    ...exactWord,   // 👈 highest priority
    ...starts,
    ...wordStarts,
    ...contains
  ].slice(0, 30);
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

  entries.forEach((entry, index) => {

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
  note.placeholder = 'note...';

  note.rows = 1;

  note.style.flex = '0 1 120px';
  note.style.minWidth = '60px';
  note.style.maxWidth = '50%';
  note.style.width = '120px';

  note.style.resize = 'none';
  note.style.overflow = 'hidden';
  note.style.font = 'inherit';
  note.style.lineHeight = '1.3';

// initial size AFTER attachment/layout
setTimeout(() => {
  note.style.height = 'auto';
  note.style.height = note.scrollHeight + 'px';
}, 0);


    // auto-grow
    note.addEventListener('input', () => {
      note.style.height = 'auto';
      note.style.height = note.scrollHeight + 'px';

      entry.note = note.value;
      saveSurvey(survey);
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
      entries.splice(index, 1);
      saveSurvey(survey);
      renderLog();
    };

    row.appendChild(del);
    div.appendChild(row);

    // Highlight most recent (last item)
    if (index === entries.length - 1) {
      div.style.background = '#e6ffe6';
      setTimeout(() => div.style.background = '', 400);
    }

    container.appendChild(div);
  });

  container.scrollTop = container.scrollHeight;
}


function downloadSurvey() {
  const data = localStorage.getItem('survey');

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

