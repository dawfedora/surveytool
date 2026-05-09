// --- GLOBAL STATE ---
let species = [];
let trails = [];
let currentTrail = null;
let currentMode = 'log';

document.addEventListener('DOMContentLoaded', init);

// --- INIT ---
async function init() {
  const input = document.getElementById('search');
  const refreshBtn = document.getElementById('refreshBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const newBtn = document.getElementById('newBtn');
  const modeBtn = document.getElementById('modeBtn');


  if (!input || !modeBtn || !refreshBtn || !downloadBtn || !newBtn) {
    console.error('Missing required DOM elements');
    return;
  }

  // Always allow refresh
  refreshBtn.addEventListener('click', refreshApp);

  const ok = loadLocalData();

  if (!ok) {
    console.warn('No local data → limited mode');

    // Disable everything except refresh
    input.disabled = true;
    downloadBtn.disabled = true;
    newBtn.disabled = true;

    const status = document.getElementById('status');
    if (status) {
      status.textContent = 'No data loaded. Tap Refresh while online.';
    }

    return; // 🚨 STOP HERE
  }

  // ✅ FULL APP MODE

  input.disabled = false;
  downloadBtn.disabled = false;

  initTrails();

  // Hook search
  let searchTimer;

  input.addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const results = search(e.target.value);
      renderResults(results);
    }, 100);
  });

  // Hook up download amd clear buttons
  downloadBtn.addEventListener('click', downloadSurvey);

  modeBtnaddEventListener('click', toggleMode);
  renderMode();

  newBtn.addEventListener('click', clearSurvey);

  // Optional: show last updated time
  const status = document.getElementById('status');
  const last = localStorage.getItem('lastUpdated');
  if (status && last) {
    status.textContent =
      'Data updated: ' + new Date(last).toLocaleString();
  }
  if (navigator.onLine) {
    checkForAppUpdate();
  }
}

// --- LOAD LOCAL DATA ---
function loadLocalData() {
  try {
    const plants = JSON.parse(localStorage.getItem('plants'));
    const trailData = JSON.parse(localStorage.getItem('trails'));

    if (!plants || !trailData) {
      console.warn('No local data found');
      return false;
    }

    trails = trailData.trails || trailData;
    species = plants.species || plants;

    let dropped = 0;
    let missingCommon = 0;
    let missingScientific = 0;

    // 🔥 Normalize once
    species = species.filter(s => {
      let common = s.commonName?.trim();
      let scientific = s.scientificName?.trim();

      // Remove completely broken entries
      if (!common && !scientific) {
        dropped++;
        console.warn( 'Dropped empty species record', s);
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

    if (missingCommon || missingScientific) {
      let msg = 'Plant data warning: ';
      if (missingCommon) {
        msg += `${missingCommon} missing common names`;
      }
      if (missingCommon && missingScientific) {
        msg += ', ';
      }
      if (missingScientific) {
        msg += `${missingScientific} missing scientific names`;
      }
      console.warn(msg);

      const status = document.getElementById('status');
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

// --- Initialize trail dropdown ---
function initTrails() {
  const select = document.getElementById('trailSelect');
  select.innerHTML = '';

  if (!Array.isArray(trails) || trails.length === 0) {
    console.warn('No trails available');
    return;
  }
  trails.forEach(t => { 
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    select.appendChild(opt);
  });
    
  currentTrail = localStorage.getItem('lastTrail') || trails[0]?.id;
  select.value = currentTrail;

  select.addEventListener('change', (e) => {
    currentTrail = e.target.value;
    localStorage.setItem('lastTrail', currentTrail);
    renderLog();
  });

  renderLog();
}

async function checkForAppUpdate() {

  if (!navigator.onLine) {
    return;
  }

  try {

    const res = await fetch(
      'version.json?ts=' + Date.now(),
      { cache: 'no-store' }
    );

    if (!res.ok) {
      return;
    }

    const info = await res.json();

    if (!info || !info.version) {
      console.warn('Bad version payload', info);
      return;
    }

    const remoteVersion = String(info.version).trim();

    let installed =
      localStorage.getItem('installedAppVersion');

    if (installed) {
      installed = installed.trim();
    }

    // BOOTSTRAP
    if (!installed) {
      installed = remoteVersion;

      localStorage.setItem(
        'installedAppVersion',
        installed
      );
    }

    // UPDATE CHECK
    if (installed !== remoteVersion) {

      const ok = confirm(
        `New app version available.\n\n` +
        `Current: ${installed}\n` +
        `New: ${remoteVersion}\n\n` +
        `Update now?`
      );

      if (ok) {
        await updateAppShell(remoteVersion);
      }
    }

  } catch (e) {

    console.warn('Version check failed', e);
  }
}

async function updateAppShell(version) {

  const status =
    document.getElementById('status');

  status.textContent =
    'Updating app…';

  try {

    const cache =
      await caches.open(
        'edgewood-shell-v1'
      );

    // Force fresh shell fetches
    await Promise.all([

      cache.add(
        './index.html?ts=' + Date.now()
      ),

      cache.add(
        './app.js?ts=' + Date.now()
      ),

      cache.add(
        './manifest.json?ts=' + Date.now()
      )

    ]);

    localStorage.setItem(
      'installedAppVersion',
      version
    );

    status.textContent =
      'Reloading…';

    location.href =
      './index.html?reload=' +
      Date.now();

  } catch (e) {

    console.error(e);

    alert('Update failed');
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

  const logView = document.getElementById('logView');
  const notesView = document.getElementById('notesView');
  const modeBtn = document.getElementById('modeBtn');

  if (currentMode === 'log') {
    logView.style.display = '';
    notesView.style.display = 'none';
    modeBtn.textContent = 'Notes';
  } else {
    logView.style.display = 'none';
    notesView.style.display = '';
    modeBtn.textContent = 'Log';
  }
}

function createEmptySurvey() {
  return {
    startNotes: '',
    endNotes: '',
    trails: {}
  };
}

// --- REFRESH APP (ONLINE ONLY ACTION) ---
async function refreshApp() {

  const status = document.getElementById('status');
  status.textContent = 'Refreshing…';

  try {

    // Require network
    if (!navigator.onLine) {
      throw new Error('Offline');
    }

    // Refresh datasets
    const [plantsRes, trailsRes] = await Promise.all([
      fetch('plants.json?ts=' + Date.now(), {
        cache: 'no-store'
      }),
      fetch('trails.json?ts=' + Date.now(), {
        cache: 'no-store'
      })
    ]);

    if (!plantsRes.ok || !trailsRes.ok) {
      throw new Error('Dataset fetch failed');
    }

    const plants = await plantsRes.json();
    const trailData = await trailsRes.json();

    localStorage.setItem('plants', JSON.stringify(plants));
    localStorage.setItem('trails', JSON.stringify(trailData));
    localStorage.setItem('lastUpdated', new Date().toISOString());

    // Force fresh app shell into SW cache
    if ('serviceWorker' in navigator) {

      const cache = await caches.open('edgewood-shell-v1');

      await cache.addAll([
        './',
        './index.html?ts=' + Date.now(),
        './app.js?ts=' + Date.now(),
        './manifest.json?ts=' + Date.now()
      ]);
    }

    status.textContent = 'Refresh complete';

    // HARD reload from network
    window.location.href =
      './index.html?reload=' + Date.now();

  } catch (e) {

    console.error(e);

    alert(
      'Refresh failed.\n' +
      'Check network connection.'
    );

    status.textContent =
      'Offline mode using cached app';
  }
}

function updateStatus(version) {

  const status =
    document.getElementById('status');

  const last =
    localStorage.getItem('lastUpdated');

  let text =
    `App ${version}`;

  if (last) {
    text +=
      ` • Data ${new Date(last).toLocaleDateString()}`;
  }

  status.textContent = text;
}

// --- Storage ---
function loadSurvey() {
  try {
    const survey = JSON.parse(
      localStorage.getItem('survey')
    );
    if (!survey) {
      return createEmptySurvey();
    }

  // Ensure required top-level fields exist
  survey.startNotes ??= '';
  survey.endNotes ??= '';
  survey.trails ??= {};

  return survey;

  } catch(e) {
    console.error('Bad survey data', e);
    return createEmptySurvey();
  }
}

function ensureTrail(survey, trailId) {
  if (!survey.trails[trailId]) {
    survey.trails[trailId] = {
      notes: '',
      entries: []
    };
  }

  return survey.trails[trailId];
}

function saveSurvey(data) {
  localStorage.setItem('survey', JSON.stringify(data));
}

// --- Add sighting ---
function addSighting(item) {
  const survey = loadSurvey();
  const trail = ensureTrail(survey, currentTrail);
  const entries = trail.entries;

  const duplicate = entries.some( e => e.speciesId == item.speciesId );
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
    time: new Date().toISOString()
  });

  saveSurvey(survey);
  renderLog();
}

function clearSurvey() {
  const confirmClear = confirm('Clear all survey data?');

  if (!confirmClear) return;

  localStorage.removeItem('survey');

  renderLog();

  const status = document.getElementById('status');
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
  const container = document.getElementById('results');
  container.innerHTML = '';
  container.scrollTop = 0;

  const input = document.getElementById('search');

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

      const input = document.getElementById('search');
      input.value = '';
      renderResults([]);

      input.focus();  // 👈 here
    };

    container.appendChild(div);
  });
}

// --- Render log ---
function renderLog() {
  const survey = loadSurvey();
  const trail = ensureTrail(survey, currentTrail);

  const entries = trail.entries;

  const container = document.getElementById('log');
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
note.style.width = '120ox';

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

  const date = new Date().toISOString().slice(0, 10);
  a.download = `edgewood-survey-${date}.json`;

  a.click();

  URL.revokeObjectURL(url);
}
