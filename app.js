// --- GLOBAL STATE ---
let species = [];
let trails = [];
let currentTrail = null;

document.addEventListener('DOMContentLoaded', init);

// --- INIT ---
async function init() {
  const input = document.getElementById('search');
  const refreshBtn = document.getElementById('refreshBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const clearBtn = document.getElementById('clearBtn');

  if (!input || !refreshBtn || !downloadBtn || !clearBtn) {
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
    clearBtn.disabled = true;

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

  clearBtn.addEventListener('click', clearSurvey);

  // Optional: show last updated time
  const status = document.getElementById('status');
  const last = localStorage.getItem('lastUpdated');
  if (status && last) {
    status.textContent =
      'Data updated: ' + new Date(last).toLocaleString();
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

    // 🔥 Normalize once
    species.forEach(s => {
      s._common = (s.commonName || '').toLowerCase();
      s._scientific = (s.scientificName || '').toLowerCase();
    });

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

function createEmptySurvey() {
  return {
    startNotes: '',
    endNotes: '',
    trails: {}
  };
}

// --- REFRESH APP (ONLINE ONLY ACTION) ---
async function refreshApp() {
  document.getElementById('status').textContent = 'Refreshing data…';

  try {
    const [plantsRes, trailsRes] = await Promise.all([
      fetch('plants.json?ts=' + Date.now(), { cache: 'no-store' }),
      fetch('trails.json?ts=' + Date.now(), { cache: 'no-store' })
    ]);

    if (!plantsRes.ok || !trailsRes.ok) {
      throw new Error('Network response not ok');
    }

    const plants = await plantsRes.json();
    const trailData = await trailsRes.json();

    // Save locally
    localStorage.setItem('plants', JSON.stringify(plants));
    localStorage.setItem('trails', JSON.stringify(trailData));
    localStorage.setItem('lastUpdated', new Date().toISOString());

    console.log('Refresh complete');

    location.reload();

  } catch (e) {
    console.error('Refresh failed', e);
    alert('Refresh failed — check network connection');
    location.reload();
  }
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



  // Add to END (most recent last)
  trail.entries.push({
    speciesId: item.speciesId,
    commonName: item.commonName,
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
    div.className = 'item';

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
