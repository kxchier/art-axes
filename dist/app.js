const $ = id => document.getElementById(id);
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const STORAGE_KEY = 'art-axes-film-sessions-v2';
const sources = [
  ['personal', 'personal label meaning', 'similar labels combine into shared theme magnets. each movie is pulled toward its themes.'],
  ['metadata', 'factual metadata', 'shared director + release-year proximity.'],
  ['synopsis', 'synopsis meaning', 'AI compares the meaning of the short plot summaries.']
];

// Round-robin ordering visits all ten films in every round, without repeating a pair.
function makePairs() {
  const ring = Array.from({ length: films.length }, (_, i) => i);
  const result = [];
  for (let round = 0; round < films.length - 1; round++) {
    for (let i = 0; i < films.length / 2; i++) result.push([ring[i], ring[ring.length - 1 - i]]);
    ring.splice(1, 0, ring.pop());
  }
  return result;
}
const pairs = makePairs();
const pairKey = (a, b) => [a, b].sort((x, y) => x - y).join('-');
const blankSession = name => ({
  name, answers: {}, cursor: 0, view: 'pairs', weights: { personal: 60, metadata: 15, synopsis: 25 }, magnetPositions: {}, themeSeparations: [], themeMerges: [], magnetCount: null, showMagnets: true
});
let storage = { active: '', sessions: {} };
let storageAvailable = true;
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (saved && typeof saved.sessions === 'object' && saved.sessions) {
    const sessions = {};
    for (const [key, session] of Object.entries(saved.sessions)) {
      if (!session || typeof session.name !== 'string' || !session.answers || typeof session.answers !== 'object') continue;
      const clean = blankSession(session.name.slice(0, 60));
      for (const [a, b] of pairs) {
        const answer = session.answers[pairKey(a, b)];
        if (answer && (answer.skipped === true || typeof answer.label === 'string')) {
          clean.answers[pairKey(a, b)] = {
            label: typeof answer.label === 'string' ? answer.label.slice(0, 100) : '',
            skipped: !!answer.skipped
          };
        }
      }
      for (const [source] of sources) {
        if (Number.isFinite(session.weights?.[source])) clean.weights[source] = Math.max(0, Math.min(100, session.weights[source]));
      }
      if (session.magnetPositions && typeof session.magnetPositions === 'object') {
        for (const [label, position] of Object.entries(session.magnetPositions)) {
          if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) Object.defineProperty(clean.magnetPositions, label, { value: { x: Math.max(.06, Math.min(.94, position.x)), y: Math.max(.15, Math.min(.88, position.y)) }, enumerable: true, writable: true, configurable: true });
        }
      }
      if (Array.isArray(session.themeSeparations)) clean.themeSeparations = session.themeSeparations.filter(pair => Array.isArray(pair) && pair.length === 2 && pair.every(label => typeof label === 'string' && label.length <= 100));
      if (Array.isArray(session.themeMerges)) clean.themeMerges = session.themeMerges.filter(group => Array.isArray(group) && group.length >= 2 && group.every(label => typeof label === 'string' && label.length <= 100));
      if (Number.isInteger(session.magnetCount) && session.magnetCount > 0) clean.magnetCount = session.magnetCount;
      clean.showMagnets = session.showMagnets !== false;
      clean.cursor = Number.isInteger(session.cursor) ? Math.max(0, Math.min(45, session.cursor)) : 0;
      clean.view = session.view === 'map' ? 'map' : 'pairs';
      sessions[key] = clean;
    }
    storage = { active: Object.hasOwn(sessions, saved.active) ? saved.active : '', sessions };
  }
} catch { /* A fresh session remains usable if browser storage is unavailable. */ }
let session = storage.active ? storage.sessions[storage.active] : null;
let inspection = null;
let mapPositions = null;
let mapAnchors = null;
let zoom = 1;
let pan = { x: 0, y: 0 };
let viewInitialized = false;
const mapPointers = new Map();
let pinchStart = null;
let nativeGesture = null;
let gestureConsumed = false;
let drag = null;
let magnetDrag = null;
let activeFilm = null;
let pinnedFilm = null;
let hoverTimer;
let defaultMagnets = new Map();
let magnetSignature = '';
let themeGroups = [];
let availableThemeCount = 0;
let themeByLabel = new Map();
let themeEmbeddings = new Map();
let magnetMoved = false;
let magnetStart = null;
function getMagnets() {
  const labels = [...new Set(personalProfiles.flatMap(profile => [...profile.keys()]))];
  const mapWidth = $('mapWorld').clientWidth || 1000, mapHeight = $('mapWorld').clientHeight || 760;
  const signature = JSON.stringify([labels.slice().sort(), session.themeSeparations || [], session.themeMerges || [], session.magnetCount, profileSignature, mapWidth, mapHeight]) + ':' + embeddings.size;
  if (magnetSignature !== signature) {
    const baseThemes = PersonalSimilarity.buildThemes(labels, embeddings, session.themeSeparations || [], .6, [...preferredThemeGroups, ...(session.themeMerges || [])]);
    availableThemeCount = baseThemes.length;
    themeGroups = session.magnetCount ? PersonalSimilarity.themesAtCount(baseThemes, session.magnetCount, embeddings) : baseThemes;
    themeByLabel = new Map(themeGroups.flatMap(theme => theme.labels.map(label => [label, theme.id])));
    themeEmbeddings = new Map(themeGroups.map(theme => [theme.id, theme.vector]));
    const memberships = new Map(themeGroups.map(theme => [theme.id, new Set()]));
    personalProfiles.forEach((profile, film) => {
      for (const label of profile.keys()) memberships.get(themeByLabel.get(label))?.add(film);
    });
    const labelSizes = new Map(themeGroups.map(theme => [theme.id, {
      width: (Math.min(180, theme.id.length * 6.2 + 24 + (theme.labels.length > 1 ? 21 : 0)) + 8) / mapWidth,
      height: 36 / mapHeight
    }]));
    defaultMagnets = PersonalSimilarity.layoutMagnets(themeGroups.map(theme => theme.id), themeEmbeddings, memberships, labelSizes);
    magnetSignature = signature;
    personalScores.clear();
  }
  return new Map([...defaultMagnets].map(([id, position]) => {
    const members = themeGroups.find(theme => theme.id === id).labels;
    const moved = members.filter(label => Object.hasOwn(session.magnetPositions || {}, label)).map(label => session.magnetPositions[label]);
    return [id, moved.length ? { x: moved.reduce((s,p) => s + p.x, 0) / moved.length, y: moved.reduce((s,p) => s + p.y, 0) / moved.length } : position];
  }));
}

const embeddings = new Map();
const EMBEDDING_KEY = 'pairwise-label-embeddings-minilm-q8-v1';
try {
  for (const [label, vector] of JSON.parse(localStorage.getItem(EMBEDDING_KEY) || '[]')) {
    if (typeof label === 'string' && Array.isArray(vector) && vector.length === 384 && vector.every(Number.isFinite)) embeddings.set(label, vector);
  }
} catch { /* Recompute unavailable or outdated cached vectors. */ }
let personalProfiles = PersonalSimilarity.buildProfiles([], films.length);
let profileSignature = '';
let personalScores = new Map();
let worker = null;
let workerRequest = 0;
let activeRequest = 0;
let requestedSignature = '';
let labelStatus = '';
let labelError = false;
let labelTimeout;
let localLabelRequest = null;
let labelErrorDetails = '';
let labelServerError = '';
const localLabelServer = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);

function refreshPersonalProfiles(retry = false) {
  const relations = relationships();
  const signature = JSON.stringify(relations);
  if (profileSignature !== signature) {
    profileSignature = signature;
    personalProfiles = PersonalSimilarity.buildProfiles(relations, films.length);
    personalScores.clear();
  }
  const labels = [...new Set(personalProfiles.flatMap(profile => [...profile.keys()]))];
  const missing = labels.filter(label => !embeddings.has(label));
  if (!missing.length) {
    labelStatus = labels.length ? 'personal labels: semantic comparison ready' : 'add personal labels to shape the map';
    labelError = false;
    requestedSignature = '';
    activeRequest = 0;
    clearTimeout(labelTimeout);
    localLabelRequest?.abort();
    return;
  }
  if (!retry && requestedSignature === signature) return;
  requestedSignature = signature;
  labelError = false;
  labelErrorDetails = '';
  labelServerError = '';
  activeRequest = ++workerRequest;
  const id = activeRequest;
  localLabelRequest?.abort();
  armLabelTimeout(id);
  if (localLabelServer) {
    labelStatus = 'comparing your labels on the local server…';
    localLabelRequest = new AbortController();
    const signal = localLabelRequest.signal;
    fetch(new URL('./api/label-embeddings', document.baseURI), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: missing }), signal
    }).then(async response => {
      if (!response.ok) {
        let reason = `local label service returned ${response.status}`;
        try { reason = (await response.json()).error || reason; } catch {}
        throw new Error(reason);
      }
      return response.json();
    }).then(data => receiveLabels({ ...data, id, type: 'result' }))
      .catch(error => {
        if (error.name === 'AbortError' || id !== activeRequest) return;
        startBrowserLabels(id, missing, error.message);
        updatePersonalMap();
      });
  } else startBrowserLabels(id, missing);
}
function armLabelTimeout(id) {
  clearTimeout(labelTimeout);
  labelTimeout = setTimeout(() => {
    if (id !== activeRequest) return;
    failLabels('The label model took too long to load. Check your connection and retry.');
    updatePersonalMap();
  }, 120000);
}
function receiveLabels(data) {
  if (data.type === 'result') {
    const valid = Array.isArray(data.labels) && Array.isArray(data.vectors) && data.labels.length === data.vectors.length &&
      data.labels.every(label => typeof label === 'string') &&
      data.vectors.every(vector => Array.isArray(vector) && vector.length === 384 && vector.every(Number.isFinite));
    if (!valid) {
      if (data.id === activeRequest) { failLabels('The label model returned incomplete embeddings. Retry to recompute them.'); updatePersonalMap(); }
      return;
    }
    data.labels.forEach((label, i) => embeddings.set(label, data.vectors[i]));
    personalScores.clear();
    try { localStorage.setItem(EMBEDDING_KEY, JSON.stringify([...embeddings])); } catch { /* In-memory cache still works. */ }
  }
  if (data.id !== activeRequest) return;
  if (data.type === 'status') { labelStatus = data.message; armLabelTimeout(data.id); }
  if (data.type === 'result') {
    clearTimeout(labelTimeout);
    labelStatus = 'personal labels: semantic comparison ready' + (data.runtime ? ` / ${data.runtime}` : '');
    labelError = false;
    labelErrorDetails = '';
    activeRequest = 0;
    requestedSignature = '';
  }
  if (data.type === 'error') failLabels(data.message);
  updatePersonalMap();
}
function startBrowserLabels(id, labels, serverError = '') {
  if (id !== activeRequest) return;
  labelStatus = 'loading the label model in your browser…';
  labelServerError = serverError;
  armLabelTimeout(id);
  try {
    if (!worker) {
      worker = new Worker(new URL('./label-worker.js', document.baseURI), { type: 'module' });
      worker.onmessage = ({ data }) => receiveLabels(data);
      worker.onerror = event => {
        event.preventDefault();
        failLabels(event.message || 'The browser could not start the label worker. A model file may be missing or blocked.');
        updatePersonalMap();
      };
    }
    worker.postMessage({ id, labels });
  } catch (error) {
    failLabels([serverError, error.message].filter(Boolean).join(' Browser fallback: '));
  }
}
function failLabels(message = 'The label model could not load.') {
  labelError = true;
  labelErrorDetails = labelServerError ? `${message} Local service: ${labelServerError}` : message;
  labelStatus = 'label comparison unavailable / retry to include personal labels';
  console.error('Label comparison failed:', message);
  activeRequest = 0;
  clearTimeout(labelTimeout);
  localLabelRequest?.abort();
  worker?.terminate();
  worker = null;
}
function updatePersonalMap() {
  mapPositions = null;
  if (session?.view === 'map') drawMap();
  if ($('inspector').open && inspection && session) {
    const draft = $('revisionLabel')?.value;
    inspect(...inspection);
    if (draft !== undefined) $('revisionLabel').value = draft;
  }
}
function personalEvidence(a, b) {
  getMagnets();
  const original = [personalProfiles[a], personalProfiles[b]];
  if (original.some(profile => !profile.size)) return { score: null, matches: [], reason: 'missing' };
  if (original.some(profile => [...profile.keys()].some(label => !embeddings.has(label)))) return { score: null, matches: [], reason: 'pending' };
  const grouped = index => new Map([...personalProfiles[index]].map(([label, origins]) => [themeByLabel.get(label) || label, origins]));
  const key = pairKey(a, b);
  if (!personalScores.has(key)) personalScores.set(key, PersonalSimilarity.compareProfiles(grouped(Math.min(a, b)), grouped(Math.max(a, b)), themeEmbeddings));
  return a <= b ? personalScores.get(key) : PersonalSimilarity.compareProfiles(grouped(a), grouped(b), themeEmbeddings);
}


function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(storage)); }
  catch {
    storageAvailable = false;
    $('progressText').textContent = 'storage unavailable / saved for this visit only';
  }
}
function openParticipant(name) {
  activeFilm = pinnedFilm = null;
  clearTimeout(hoverTimer);
  const key = `participant:${name.trim().toLocaleLowerCase()}`;
  if (!Object.hasOwn(storage.sessions, key)) storage.sessions[key] = blankSession(name.trim());
  storage.active = key;
  session = storage.sessions[key];
  viewInitialized = false;
  mapPositions = null;
  save();
  render();
}
function relationships() {
  return pairs.filter(([a, b]) => session.answers[pairKey(a, b)]?.label)
    .map(([a, b]) => ({ a, b, label: session.answers[pairKey(a, b)].label }));
}
function reviewedCount() { return Object.keys(session.answers).length; }
function poster(index, className = '') {
  const film = films[index];
  return `<img class="${className}" src="${film.poster}" alt="${escapeHTML(film.title)} poster" draggable="false">`;
}
function render() {
  const relating = !!session && session.view !== 'map' && session.cursor < pairs.length;
  document.documentElement.classList.toggle('is-relating', relating);
  document.documentElement.classList.toggle('is-mapping', !!session && session.view === 'map');
  $('welcome').hidden = !!session;
  $('pairView').hidden = !session || session.view === 'map' || session.cursor === pairs.length;
  $('completeView').hidden = !session || session.view === 'map' || session.cursor !== pairs.length;
  $('mapView').hidden = !session || session.view !== 'map';
  $('mapButton').hidden = !session || session.view === 'map';
  $('pairsButton').hidden = !session || session.view !== 'map';
  $('personButton').hidden = !session;
  if (!session) {
    $('phase').textContent = 'a few connections to start';
    $('progressText').textContent = 'your interpretation, one pair at a time';
    return;
  }
  $('personButton').textContent = session.name;
  $('phase').textContent = session.view === 'map' ? `${session.name}’s map` : `${session.name} / relating films`;
  $('progressText').textContent = storageAvailable ? `${reviewedCount()} / 45 pairs visited · ${relationships().length} connections` : 'storage unavailable / saved for this visit only';
  refreshPersonalProfiles();
  if (session.view === 'map') renderMapView();
  else if (session.cursor < pairs.length) renderPair();
  else $('completeSummary').textContent = `${relationships().length} connections, ${45 - relationships().length} skipped. let’s see how they sit alongside the films’ descriptions.`;
}
function renderPair() {
  const [a, b] = pairs[session.cursor];
  const answer = session.answers[pairKey(a, b)];
  $('pairNumber').textContent = `pair ${String(session.cursor + 1).padStart(2, '0')} / 45`;
  $('previousPair').disabled = session.cursor === 0;
  $('pairFilms').innerHTML = [a, b].map((i, side) => `${side ? '<span class="pair-bridge" aria-hidden="true">↔</span>' : ''}<article class="pair-film">${poster(i)}<h3>${escapeHTML(films[i].title)}</h3><p>${films[i].year} / ${escapeHTML(films[i].director)}</p></article>`).join('');
  $('relationship').value = answer?.label || '';
  $('savePair').textContent = answer?.label ? 'update & next →' : 'save & next →';
  $('skipPair').textContent = answer?.label ? 'keep & next' : 'skip this pair';
  $('pairFeedback').textContent = answer?.skipped ? 'you skipped this pair. you can add a connection now.' : 'commas separate labels · enter saves or skips if blank.';
  $('relatedCount').textContent = `${relationships().length} connections / ${Object.values(session.answers).filter(a => a.skipped).length} skipped`;
}
function advance() {
  session.cursor = Math.min(pairs.length, session.cursor + 1);
  if (session.cursor === pairs.length) {
    const pending = pairs.findIndex(([a, b]) => !session.answers[pairKey(a, b)]);
    if (pending >= 0) session.cursor = pending;
  }
  mapPositions = null;
  save();
  render();
  if (session.cursor < pairs.length) $('relationship').focus({ preventScroll: true });
}
$('nameForm').onsubmit = event => {
  event.preventDefault();
  const name = $('personName').value.trim();
  if (!name) return;
  openParticipant(name);
  if (session.view !== 'map' && session.cursor < pairs.length) $('relationship').focus();
};
$('pairForm').onsubmit = event => {
  event.preventDefault();
  const label = $('relationship').value.trim();
  if (!label) { skipCurrentPair(); return; }
  const [a, b] = pairs[session.cursor];
  session.answers[pairKey(a, b)] = { label, skipped: false };
  advance();
};
function skipCurrentPair() {
  const [a, b] = pairs[session.cursor];
  const key = pairKey(a, b);
  if (!session.answers[key]?.label) session.answers[key] = { label: '', skipped: true };
  advance();
}
$('skipPair').onclick = skipCurrentPair;
function movePair(offset) {
  session.cursor = Math.max(0, Math.min(pairs.length - 1, session.cursor + offset));
  save();
  render();
}
$('previousPair').onclick = () => movePair(-1);
function showMap() {
  activeFilm = pinnedFilm = null;
  clearTimeout(hoverTimer);
  session.view = 'map';
  save();
  render();
}
function showPairs() {
  session.view = 'pairs';
  if (session.cursor === pairs.length) session.cursor = 0;
  save();
  render();
}
for (const id of ['mapButton', 'earlyMap', 'finishMap']) $(id).onclick = showMap;
for (const id of ['pairsButton', 'continuePairs', 'reviewPairs']) $(id).onclick = showPairs;
$('personButton').onclick = () => {
  $('newName').value = session.name;
  $('participantDialog').showModal();
};
$('cancelParticipant').onclick = () => $('participantDialog').close();
$('nameScreen').onclick = () => {
  $('participantDialog').close();
  storage.active = '';
  session = null;
  $('personName').value = '';
  save();
  render();
};
$('participantForm').onsubmit = event => {
  event.preventDefault();
  const name = $('newName').value.trim();
  if (!name) return;
  $('participantDialog').close();
  openParticipant(name);
};
$('collection').innerHTML = films.map((film, i) => `<figure>${poster(i)}<figcaption>${escapeHTML(film.title)}</figcaption><small>${film.year}</small></figure>`).join('');
$('collectionButton').onclick = () => {
  $('collectionPanel').hidden = !$('collectionPanel').hidden;
  $('collectionButton').setAttribute('aria-expanded', String(!$('collectionPanel').hidden));
};
$('closeCollection').onclick = () => {
  $('collectionPanel').hidden = true;
  $('collectionButton').setAttribute('aria-expanded', 'false');
};

// Personal label vectors run locally in a worker; public synopsis vectors were precomputed.
function evidence(a, b) {
  const answer = session.answers[pairKey(a, b)];
  return {
    personal: personalEvidence(a, b).score,
    personalDetails: personalEvidence(a, b),
    label: answer?.label || '',
    skipped: answer?.skipped || false,
    metadata: ((films[a].director === films[b].director ? 1 : 0) + Math.max(0, 1 - Math.abs(films[a].year - films[b].year) / 30)) / 2,
    synopsis: synopsisData.scores[a][b]
  };
}
function affinity(a, b) {
  const values = evidence(a, b);
  let weighted = 0, total = 0;
  for (const [source] of sources) {
    if (values[source] === null) continue;
    weighted += values[source] * session.weights[source];
    total += session.weights[source];
  }
  return total ? weighted / total : 0;
}
function computePositions() {
  const magnets = getMagnets();
  const targets = personalProfiles.map(profile => PersonalSimilarity.magnetTarget(profile, magnets, themeByLabel));
  const result = MovieLayout.layoutMovies({
    metadata: films.map((_, a) => films.map((_, b) => evidence(a, b).metadata)),
    synopsis: synopsisData.scores, weights: session.weights, targets,
    width: $('mapWorld').clientWidth || 1000, height: $('mapWorld').clientHeight || 760,
    cardWidth: matchMedia('(max-width: 700px)').matches ? 55 : 78,
    cardHeight: matchMedia('(max-width: 700px)').matches ? 110 : 150
  });
  mapAnchors = result.anchors;
  return result.positions;
}
function renderMapView() {
  $('mapTitle').textContent = `${session.name}’s map`;
  $('sliders').innerHTML = sources.map(([key, title, description]) => `<div class="source"><label for="weight-${key}">${title}<output id="out-${key}">${session.weights[key]}</output></label><input id="weight-${key}" data-weight="${key}" type="range" min="0" max="100" value="${session.weights[key]}"><p>${description}</p></div>`).join('');
  const relations = relationships();
  $('connectionCount').textContent = relations.length;
  $('contributions').innerHTML = relations.length ? relations.map(r => `<button class="relation" data-pair="${r.a},${r.b}"><b>${escapeHTML(r.label)}</b><small>${escapeHTML(films[r.a].title)} ↔ ${escapeHTML(films[r.b].title)}</small></button>`).join('') : '<p class="small-note">no personal connections yet. you can add them whenever you like.</p>';
  $('modelStatus').textContent = labelStatus;
  $('pairSelect').innerHTML = '<option value="">choose two films…</option>' + pairs.map(([a, b]) => `<option value="${a},${b}">${escapeHTML(films[a].title)} ↔ ${escapeHTML(films[b].title)}</option>`).join('');
  drawMap();
  if (!viewInitialized) { fitMapView(); viewInitialized = true; }
}
function drawMap() {
  mapPositions ||= computePositions();
  const mapWidth = $('mapWorld').clientWidth || 1000;
  const mapHeight = $('mapWorld').clientHeight || 700;
  const unitX = mapWidth / 100, unitY = mapHeight / 100;
  $('modelStatus').textContent = Object.values(session.weights).some(weight => weight > 0)
    ? `${labelStatus} · synopsis: precomputed AI`
    : 'all sources are off / hover a poster to inspect its statements';
  $('retryLabels').hidden = !labelError;
  $('labelErrorDetails').hidden = !labelError;
  $('labelErrorMessage').textContent = labelErrorDetails;
  const visible = new Set();
  for (let a = 0; a < films.length; a++) {
    const nearest = films.map((_, b) => ({ b, score: a === b ? -1 : affinity(a, b) })).sort((x, y) => y.score - x.score).slice(0, 2);
    nearest.filter(p => p.score > .4).forEach(p => visible.add(pairKey(a, p.b)));
  }
  relationships().forEach(r => visible.add(pairKey(r.a, r.b)));
  const lines = [...visible].map(key => {
    const [a, b] = key.split('-').map(Number), p = mapAnchors[a], q = mapAnchors[b];
    const values = evidence(a, b);
    const label = values.label;
    const semantic = !label && values.personal !== null && values.personal >= .45;
    return `<g class="edge-group" aria-hidden="true" data-pair="${a},${b}" role="button" tabindex="-1" aria-label="Inspect ${escapeHTML(films[a].title)} and ${escapeHTML(films[b].title)}"><title>${escapeHTML(label || (semantic ? 'similar personal label meanings' : 'computational connection'))}</title><line class="edge ${label ? 'personal' : semantic ? 'semantic' : ''}" x1="${p.x * unitX}" y1="${p.y * unitY}" x2="${q.x * unitX}" y2="${q.y * unitY}" stroke-width="${label ? 1.8 : 1}" ${label ? '' : 'stroke-dasharray="3 5"'}/><line x1="${p.x * unitX}" y1="${p.y * unitY}" x2="${q.x * unitX}" y2="${q.y * unitY}" stroke="transparent" stroke-width="16"/>${label ? `<text class="edge-label" text-anchor="middle" x="${(p.x + q.x) * unitX / 2}" y="${(p.y + q.y) * unitY / 2 - 7}">${escapeHTML(label.length > 28 ? label.slice(0, 27) + '…' : label)}</text>` : ''}</g>`;
  }).join('');
  const offsets = mapPositions.map((p, i) => {
    const q = mapAnchors[i];
    if (Math.hypot((p.x-q.x)*unitX, (p.y-q.y)*unitY) < 2) return '';
    return `<g class="poster-offset"><title>Semantic position of ${escapeHTML(films[i].title)}; poster moved to avoid overlap</title><line x1="${p.x*unitX}" y1="${p.y*unitY}" x2="${q.x*unitX}" y2="${q.y*unitY}"/><circle cx="${q.x*unitX}" cy="${q.y*unitY}" r="3"/></g>`;
  }).join('');
  $('mapWorld').innerHTML = `<svg viewBox="0 0 ${mapWidth} ${mapHeight}" preserveAspectRatio="none" aria-label="Film connections">${lines}${offsets}</svg>` + films.map((film, i) => `<button class="node" data-film="${i}" style="left:${mapPositions[i].x}%;top:${mapPositions[i].y}%" aria-label="Show connections for ${escapeHTML(film.title)}" aria-pressed="false">${poster(i)}<span class="node-title">${escapeHTML(film.title)}</span></button>`).join('');
  const magnets = getMagnets();
  $('magnetCount').max = Math.max(1, availableThemeCount);
  $('magnetCount').value = themeGroups.length || 1;
  $('magnetCount').disabled = availableThemeCount < 2;
  $('magnetCountValue').textContent = themeGroups.length;
  $('magnetCountHint').textContent = availableThemeCount ? `1 broad theme ↔ ${availableThemeCount} specific themes` : 'add labels to create themes';
  $('mapWorld').insertAdjacentHTML('beforeend', [...magnets].map(([label, position]) => {
    const theme = themeGroups.find(theme => theme.id === label);
    return `<button class="magnet" data-magnet="${escapeHTML(label)}" style="left:${position.x * 100}%;top:${position.y * 100}%;--magnet-hue:${(themeGroups.indexOf(theme) * 137.508 + 12) % 360}" title="${escapeHTML(theme.labels.join(' · '))} — drag to move; click to inspect theme" aria-label="Inspect ${escapeHTML(label)} theme">${escapeHTML(label)}${theme.labels.length > 1 ? `<small class="theme-count">${theme.labels.length}</small>` : ''}</button>`;
  }).join(''));
  $('showMagnets').checked = session.showMagnets !== false;
  $('mapWorld').classList.toggle('magnets-hidden', session.showMagnets === false);
  applyView();
  revealConnections(pinnedFilm ?? activeFilm);
}
function revealConnections(film) {
  activeFilm = film;
  $('mapWorld').querySelectorAll('[data-pair]').forEach(edge => {
    const visible = film !== null && edge.dataset.pair.split(',').map(Number).includes(film);
    edge.classList.toggle('is-revealed', visible);
    edge.setAttribute('aria-hidden', String(!visible));
    edge.setAttribute('tabindex', visible ? '0' : '-1');
  });
  $('mapWorld').querySelectorAll('[data-film]').forEach(node => {
    node.classList.toggle('is-active', Number(node.dataset.film) === film);
    node.setAttribute('aria-pressed', String(Number(node.dataset.film) === pinnedFilm));
  });
}
$('map').onpointerover = event => {
  const node = event.target.closest('[data-film]');
  if (node) { clearTimeout(hoverTimer); revealConnections(Number(node.dataset.film)); }
  if (event.target.closest('[data-pair]')) clearTimeout(hoverTimer);
};
$('map').onpointerout = event => {
  if (pinnedFilm !== null) return;
  if (event.target.closest('[data-film], [data-pair]') && !event.relatedTarget?.closest?.('[data-film], [data-pair]')) {
    hoverTimer = setTimeout(() => revealConnections(null), 250);
  }
};
$('map').onpointerleave = () => { clearTimeout(hoverTimer); revealConnections(pinnedFilm); };
$('map').onfocusin = event => {
  const node = event.target.closest('[data-film]');
  if (node) revealConnections(Number(node.dataset.film));
};
$('map').onfocusout = event => {
  if (!event.relatedTarget?.closest?.('[data-film], [data-pair]')) revealConnections(pinnedFilm);
};
$('showMagnets').onchange = event => {
  session.showMagnets = event.target.checked;
  $('mapWorld').classList.toggle('magnets-hidden', !session.showMagnets);
  save();
};
$('magnetCount').oninput = event => {
  session.magnetCount = Number(event.target.value);
  magnetSignature = '';
  mapPositions = null;
  activeFilm = pinnedFilm = null;
  drawMap();
  save();
};
$('resetMagnets').onclick = () => {
  session.magnetPositions = {};
  mapPositions = null;
  save(); drawMap();
};
$('sliders').oninput = event => {
  const key = event.target.dataset.weight;
  if (!sources.some(([source]) => source === key)) return;
  session.weights[key] = Number(event.target.value);
  $('out-' + key).textContent = event.target.value;
  mapPositions = null;
  drawMap();
  save();
};
$('contributions').onclick = event => {
  const pair = event.target.closest('[data-pair]');
  if (pair) inspect(...pair.dataset.pair.split(',').map(Number));
};
$('pairSelect').onchange = event => {
  if (event.target.value) inspect(...event.target.value.split(',').map(Number));
};
function inspectTheme(id) {
  const theme = themeGroups.find(group => group.id === id);
  if (!theme) return;
  inspection = null;
  $('inspectorContent').innerHTML = `<h2>${escapeHTML(theme.id)}</h2><p>${theme.labels.length > 1 ? `${theme.labels.length} similar labels combined into one shared theme magnet.` : 'one original label in this theme.'} Original wording is preserved below.</p><div class="theme-members">${theme.labels.map(label => {
    const origins = relationships().filter(relation => PersonalSimilarity.splitLabels(relation.label).includes(label));
    return `<section class="profile-label"><b>${escapeHTML(label)}</b>${themeByLabel.get(label) && themeByLabel.get(label) !== label ? `<span class="small-note">shared theme: ${escapeHTML(themeByLabel.get(label))}</span>` : ''}${origins.map(origin => `<button class="text-button" data-origin="${origin.a},${origin.b}">${escapeHTML(origin.label)} / ${escapeHTML(films[origin.a].title)} ↔ ${escapeHTML(films[origin.b].title)}</button>`).join('')}</section>`;
  }).join('')}</div><p>Plural variants and your explicitly requested groupings are combined. Automatic themes combine close semantic matches. Lowering the magnet count combines the closest themes into broader groups, which can contain different but related ideas. The magnet uses the group’s average embedding; its title is a representative original label. Nearby clusters use both label meaning and shared movies, rather than evenly spaced positions.</p>${theme.labels.length > 1 ? '<button id="separateTheme" class="primary" type="button">keep these labels separate</button>' : ''}<form id="combineTheme" class="combine-theme"><label for="themeMergeTarget">combine with another theme</label><select id="themeMergeTarget"><option value="">choose a theme…</option>${themeGroups.filter(other => other.id !== id).map(other => `<option value="${escapeHTML(other.id)}">${escapeHTML(other.id)}</option>`).join('')}</select><button type="submit">combine themes</button></form>`;
  if (theme.labels.length > 1) $('separateTheme').onclick = () => {
    session.magnetCount = null;
    session.themeSeparations ||= [];
    for (let i = 0; i < theme.labels.length; i++) for (let j = i + 1; j < theme.labels.length; j++) session.themeSeparations.push([theme.labels[i], theme.labels[j]]);
    magnetSignature = '';
    mapPositions = null;
    save();
    $('inspector').close();
    render();
  };
  $('combineTheme').onsubmit = event => {
    event.preventDefault();
    const other = themeGroups.find(group => group.id === $('themeMergeTarget').value);
    if (!other) return;
    const members = [...theme.labels, ...other.labels];
    session.magnetCount = null;
    session.themeMerges ||= [];
    session.themeMerges.push(members);
    session.themeSeparations = (session.themeSeparations || []).filter(pair => !pair.every(label => members.includes(label)));
    magnetSignature = '';
    mapPositions = null;
    save();
    $('inspector').close();
    render();
  };
  if (!$('inspector').open) $('inspector').showModal();
}
function profileHTML(index) {
  const profile = personalProfiles[index];
  if (!profile.size) return '<p>no labels yet</p>';
  return [...profile].map(([label, origins]) => `<div class="profile-label"><b>${escapeHTML(label)}</b>${themeByLabel.get(label) && themeByLabel.get(label) !== label ? `<span class="small-note">shared theme: ${escapeHTML(themeByLabel.get(label))}</span>` : ''}${origins.map(origin => `<button class="text-button" type="button" data-origin="${origin.a},${origin.b}">from ${escapeHTML(films[origin.a].title)} ↔ ${escapeHTML(films[origin.b].title)}</button>`).join('')}</div>`).join('');
}
function personalMatchHTML(details) {
  if (details.reason === 'missing') return '<p>one or both films have no personal labels yet. this source is excluded for the pair.</p>';
  if (details.reason === 'pending') return `<p>${labelError ? 'personal comparison is unavailable. close this panel and retry the model on the map.' : 'comparing label meanings… personal influence is excluded until ready.'}</p>`;
  return `<h3>strongest label matches</h3><ul class="label-matches">${details.matches.slice(0, 5).map(match => `<li><span>${escapeHTML(match.left)} ↔ ${escapeHTML(match.right)}</span><span>${Math.round(match.score * 100)} / 100</span></li>`).join('')}</ul>`;
}
$('inspectorContent').onclick = event => {
  const origin = event.target.closest('[data-origin]');
  if (origin) inspect(...origin.dataset.origin.split(',').map(Number));
};
function inspect(a, b) {
  inspection = [a, b];
  const values = evidence(a, b), x = films[a], y = films[b];
  $('inspectorContent').innerHTML = `<div class="inspect-pair">${poster(a)}${poster(b)}</div><h2>${escapeHTML(x.title)} ↔ ${escapeHTML(y.title)}</h2><p>combined affinity: ${Math.round(affinity(a, b) * 100)} / 100. this is a pairwise summary. the map fits distances between movies using metric MDS, balanced with personal theme magnets. Dotted leaders mark posters moved away from their semantic position to prevent overlap.</p>
    <section class="source-block"><h3>personal label meaning / ${values.personal === null ? 'not available' : Math.round(values.personal * 100)}</h3><p>each original connection gives both films its label magnets. similar labels are combined into shared themes; theme magnets cluster using label meaning and the movies that share them. each film is pulled toward the average position of its own magnets; metadata and synopsis comparisons also influence it.</p>
      <div class="label-profiles"><div><h4>${escapeHTML(x.title)}</h4>${profileHTML(a)}</div><div><h4>${escapeHTML(y.title)}</h4>${profileHTML(b)}</div></div>
      ${personalMatchHTML(values.personalDetails)}
      <p>the summary score averages each label’s closest semantic match in the other film’s labels, then average both directions. labels in the same shared theme count once. the layout uses the label magnets rather than this score as a direct movie-to-movie pull. you can drag a magnet to express a placement you disagree with; semantic relatedness does not establish opposition.</p>
      <h3>your original connection</h3><p>${values.label ? escapeHTML(values.label) : values.skipped ? 'you skipped this direct pair; other labels can still connect the films.' : 'no direct statement for this pair yet.'}</p>
      <form id="revisionForm"><label class="sr-only" for="revisionLabel">relationship</label><input id="revisionLabel" maxlength="100" value="${escapeHTML(values.label)}" placeholder="nature, growing up…" required><button class="primary" type="submit">${values.label ? 'revise connection' : 'add connection'}</button></form></section>
    <section class="source-block"><h3>factual metadata / ${Math.round(values.metadata * 100)}</h3><p>${escapeHTML(x.director)} / ${x.year}<br>${escapeHTML(y.director)} / ${y.year}</p><p>director match (1 or 0) and year proximity (1 − year gap / 30, minimum 0), weighted equally. locally stored from the unofficial Studio Ghibli API: <a href="${x.metadataSource}" target="_blank" rel="noreferrer">${escapeHTML(x.title)} ↗</a> / <a href="${y.metadataSource}" target="_blank" rel="noreferrer">${escapeHTML(y.title)} ↗</a>. not a live feed. posters are TMDB artwork, not metadata inputs.</p></section>
    <section class="source-block"><h3>synopsis meaning / ${Math.round(values.synopsis * 100)}</h3><p><b>${escapeHTML(x.title)}</b><br>${escapeHTML(x.synopsis)}</p><p><b>${escapeHTML(y.title)}</b><br>${escapeHTML(y.synopsis)}</p><p>these exact summaries were embedded with <a href="https://huggingface.co/Xenova/all-MiniLM-L6-v2" target="_blank" rel="noreferrer">MiniLM</a>. score = cosine similarity between normalized text embeddings (negative values clamped to 0). calculated once locally; personal labels use the same model on this computer: through the local server on localhost, or in a browser worker on a static site. no labels are sent to a third-party inference service. poster appearance is not an input.</p></section>
    <p>source scores are multiplied by their relative influence, then averaged. personal input is excluded while its embeddings load or if either film has no labels. all weights at zero gives no affinity. dashed lines show each film’s two strongest inferred connections above 40/100; every pair is inspectable in the selector.</p>`;
  $('revisionForm').onsubmit = event => {
    event.preventDefault();
    const label = $('revisionLabel').value.trim();
    if (!label) return;
    session.answers[pairKey(a, b)] = { label, skipped: false };
    mapPositions = null;
    save();
    render();
    inspect(a, b);
  };
  if (!$('inspector').open) $('inspector').showModal();
}
$('closeInspector').onclick = () => { inspection = null; $('inspector').close(); };
$('inspector').onclose = () => { inspection = null; };
$('retryLabels').onclick = () => { refreshPersonalProfiles(true); updatePersonalMap(); };
$('map').onclick = event => {
  if (gestureConsumed && event.detail !== 0) return;
  const edge = event.target.closest('[data-pair]');
  if (edge) { inspect(...edge.dataset.pair.split(',').map(Number)); return; }
  const magnet = event.target.closest('[data-magnet]');
  if (magnet) { if (!magnetMoved || event.detail === 0) inspectTheme(magnet.dataset.magnet); return; }
  const node = event.target.closest('[data-film]');
  if (node) {
    const film = Number(node.dataset.film);
    if (event.detail === 0 || matchMedia('(hover: none)').matches) pinnedFilm = pinnedFilm === film ? null : film;
    revealConnections(pinnedFilm ?? film);
  }
};
$('map').onkeydown = event => {
  if (event.key === 'Escape') { pinnedFilm = null; revealConnections(null); }
  const magnet = event.target.closest('[data-magnet]');
  if (magnet && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const position = getMagnets().get(magnet.dataset.magnet);
    const step = event.shiftKey ? .04 : .01;
    moveMagnet(magnet.dataset.magnet, {
      x: position.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      y: position.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)
    });
    $('mapWorld').querySelectorAll('[data-magnet]').forEach(node => { if (node.dataset.magnet === magnet.dataset.magnet) node.focus(); });
    save();
  }
  const edge = event.target.closest('[data-pair]');
  if (edge && ['Enter', ' '].includes(event.key)) { event.preventDefault(); inspect(...edge.dataset.pair.split(',').map(Number)); }
};
function applyView() {
  $('mapWorld').style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  $('zoomReset').textContent = `${Math.round(zoom * 100)}%`;
}
function viewState() { return { zoom, panX: pan.x, panY: pan.y }; }
function setView(view) {
  zoom = view.zoom; pan = { x: view.panX, y: view.panY }; applyView();
}
function viewOrigin() { return { x: $('mapWorld').offsetWidth / 2, y: $('mapWorld').offsetHeight / 2 }; }
function mapPoint(clientX, clientY) {
  const bounds = $('map').getBoundingClientRect();
  return { x: clientX - bounds.left, y: clientY - bounds.top };
}
function changeZoom(factor, clientX, clientY) {
  const anchor = Number.isFinite(clientX) && Number.isFinite(clientY)
    ? mapPoint(clientX, clientY) : { x: $('map').clientWidth / 2, y: $('map').clientHeight / 2 };
  setView(MapNavigation.zoomAt(viewState(), factor, anchor, viewOrigin()));
}
function fitMapView() {
  const width = $('map').clientWidth, height = $('map').clientHeight;
  const worldWidth = $('mapWorld').offsetWidth, worldHeight = $('mapWorld').offsetHeight;
  if (!width || !height || !worldWidth || !worldHeight) return;
  const positions = [...(mapPositions || []), ...(mapAnchors || [])].map(p => ({x:p.x/100*worldWidth,y:p.y/100*worldHeight}));
  if (session.showMagnets !== false) getMagnets().forEach(p => positions.push({x:p.x*worldWidth,y:p.y*worldHeight}));
  const minX = Math.min(0, ...positions.map(p => p.x-65)), maxX = Math.max(worldWidth, ...positions.map(p => p.x+65));
  const minY = Math.min(0, ...positions.map(p => p.y-90)), maxY = Math.max(worldHeight, ...positions.map(p => p.y+90));
  zoom = Math.max(.05, Math.min(1, (width-30)/(maxX-minX), (height-30)/(maxY-minY)));
  pan = {x:width/2-worldWidth/2-zoom*((minX+maxX)/2-worldWidth/2), y:height/2-worldHeight/2-zoom*((minY+maxY)/2-worldHeight/2)};
  applyView();
}
$('zoomIn').onclick = () => changeZoom(1.15);
$('zoomOut').onclick = () => changeZoom(1 / 1.15);
$('zoomReset').onclick = fitMapView;
$('map').addEventListener('wheel', event => {
  event.preventDefault();
  if (nativeGesture) return;
  // Trackpad pinch is delivered as Ctrl+wheel in Chromium and Firefox.
  if (event.ctrlKey) changeZoom(Math.exp(-event.deltaY * .01), event.clientX, event.clientY);
  else {
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? $('map').clientHeight : 1;
    pan.x -= event.deltaX * unit; pan.y -= event.deltaY * unit;
    applyView();
  }
}, { passive: false });
// Safari trackpads expose pinch through GestureEvents instead of Ctrl+wheel.
$('map').addEventListener('gesturestart', event => {
  event.preventDefault();
  if (mapPointers.size > 1) return;
  nativeGesture = { view: viewState(), anchor: mapPoint(event.clientX, event.clientY) };
}, { passive: false });
$('map').addEventListener('gesturechange', event => {
  event.preventDefault();
  if (!nativeGesture || mapPointers.size > 1) return;
  setView(MapNavigation.zoomAt(nativeGesture.view, event.scale, nativeGesture.anchor, viewOrigin()));
}, { passive: false });
$('map').addEventListener('gestureend', event => { event.preventDefault(); nativeGesture = null; }, { passive: false });
window.addEventListener('gestureend', () => { nativeGesture = null; });
function beginPinch() {
  for (const id of mapPointers.keys()) $('map').setPointerCapture(id);
  clearTimeout(hoverTimer); pinnedFilm = null; revealConnections(null);
  const [a, b] = [...mapPointers.values()];
  pinchStart = {
    distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
    midpoint: mapPoint((a.x + b.x) / 2, (a.y + b.y) / 2), view: viewState()
  };
  if (magnetDrag && magnetMoved) save();
  magnetDrag = null; drag = null; nativeGesture = null;
  gestureConsumed = true;
  $('map').classList.remove('panning');
}
$('map').onpointerdown = event => {
  if (event.pointerType === 'touch') {
    if (!mapPointers.size) gestureConsumed = false;
    mapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (mapPointers.size >= 2) {
      $('map').setPointerCapture(event.pointerId);
      beginPinch(); event.preventDefault(); return;
    }
  } else gestureConsumed = false;
  if (event.button !== 0) return;
  const magnet = event.target.closest('[data-magnet]');
  if (magnet) {
    magnetMoved = false;
    magnetStart = { x: event.clientX, y: event.clientY };
    magnetDrag = magnet.dataset.magnet;
    $('map').setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (event.target.closest('button, [data-pair]')) return;
  drag = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  $('map').setPointerCapture(event.pointerId);
  $('map').classList.add('panning');
  event.preventDefault();
};
$('map').onpointermove = event => {
  if (mapPointers.has(event.pointerId)) mapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinchStart && mapPointers.size >= 2) {
    const [a, b] = [...mapPointers.values()];
    const midpoint = mapPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
    const factor = Math.hypot(b.x - a.x, b.y - a.y) / pinchStart.distance;
    setView(MapNavigation.pinch(pinchStart.view, pinchStart.midpoint, midpoint, factor, viewOrigin()));
    event.preventDefault(); return;
  }
  if (magnetDrag) {
    if (!magnetMoved && Math.hypot(event.clientX - magnetStart.x, event.clientY - magnetStart.y) < 3) return;
    magnetMoved = true;
    const bounds = $('mapWorld').getBoundingClientRect();
    moveMagnet(magnetDrag, { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height });
    return;
  }
  if (!drag) return;
  pan = { x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y };
  applyView();
};
function moveMagnet(label, position) {
  session.magnetPositions ||= {};
  const members = themeGroups.find(theme => theme.id === label)?.labels || [label];
  const bounded = { x: Math.max(.06, Math.min(.94, position.x)), y: Math.max(.15, Math.min(.88, position.y)) };
  session.magnetPositions = { ...session.magnetPositions, ...Object.fromEntries(members.map(member => [member, bounded])) };
  mapPositions = null;
  drawMap();
}
function endDrag(event) {
  const clickedTheme = magnetDrag && !magnetMoved && event?.type === 'pointerup' ? magnetDrag : null;
  if (magnetDrag && magnetMoved) save();
  magnetDrag = null; magnetStart = null; drag = null;
  $('map').classList.remove('panning');
  if (clickedTheme) { magnetMoved = true; inspectTheme(clickedTheme); }
}
function endMapPointer(event) {
  mapPointers.delete(event.pointerId);
  if (pinchStart) {
    if (mapPointers.size >= 2) { beginPinch(); return; }
    pinchStart = null;
    const remaining = [...mapPointers.values()][0];
    drag = remaining ? { x: remaining.x, y: remaining.y, panX: pan.x, panY: pan.y } : null;
    if (!remaining) $('map').classList.remove('panning');
    return;
  }
  endDrag(event);
}
$('map').onpointerup = endMapPointer;
$('map').onpointercancel = endMapPointer;
window.addEventListener('blur', () => {
  mapPointers.clear(); pinchStart = null; nativeGesture = null; endDrag();
});
render();

let lastMapSize = '';
new ResizeObserver(entries => {
  const { width, height } = entries[0].contentRect;
  const size = `${width},${height}`;
  if (width && height && size !== lastMapSize && session?.view === 'map') {
    lastMapSize = size;
    mapPositions = null;
    drawMap();
  }
}).observe($('map'));
