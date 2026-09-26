const works = Array.isArray(window.ARTWORKS) ? window.ARTWORKS : [];
const palette = ["#91a7ff", "#ff9fc8", "#83d8bd", "#c5a3ff", "#ffbd86"];
const CLIP_MODEL = "Xenova/clip-vit-base-patch32";
const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";
const STORAGE_VERSION = 6;
const kindLabels = { all: "all works", painting: "paintings", paper: "works on paper", sculpture: "sculpture", object: "objects", textile: "textiles", photography: "photography" };

const state = {
  axes: [], filter: { kind: "all", era: "all", query: "" },
  drawing: false, dragStart: null, dragEnd: null, pendingAxis: null,
  zoom: 1, panX: 0, panY: 0, panning: false, panStart: null
};

const canvas = document.querySelector("#artCanvas");
const worldLayer = document.querySelector("#worldLayer");
const artLayer = document.querySelector("#artLayer");
const axisSvg = document.querySelector("#axisSvg");
const axisList = document.querySelector("#axisList");
const drawButton = document.querySelector("#drawButton");
const axisDialog = document.querySelector("#axisDialog");
const detailPanel = document.querySelector("#detailPanel");
const backdrop = document.querySelector("#backdrop");
const modelStatus = document.querySelector("#modelStatus");
const zoomLevel = document.querySelector("#zoomResetButton");
const filterPanel = document.querySelector("#filterPanel");
const collectionButton = document.querySelector("#collectionButton");
let clipClassifierPromise = null;
let statusTimer = null;

function imageUrl(work) { return `./art/${work.id}.jpg`; }
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
}
function setModelStatus(message, tone = "working") {
  window.clearTimeout(statusTimer); modelStatus.textContent = message; modelStatus.dataset.tone = tone; modelStatus.hidden = !message;
  if (tone !== "working") statusTimer = window.setTimeout(() => { modelStatus.hidden = true; }, 3000);
}

function filteredWorks(filter = state.filter) {
  const query = filter.query.trim().toLowerCase();
  return works.filter(work => {
    if (filter.kind !== "all" && work.kind !== filter.kind) return false;
    if (filter.era !== "all" && work.era !== filter.era) return false;
    if (!query) return true;
    return [work.title, work.artist, work.medium, work.origin, work.classification].some(value => String(value).toLowerCase().includes(query));
  });
}
function visibleWorks() {
  const includedIds = new Set(state.axes.flatMap(axis => axis.scopeIds || []));
  return works.filter(work => includedIds.has(work.id));
}
function axisIncludes(axis, work) { return axis.scopeIds?.includes(work.id); }
function axisScore(work, axis) {
  const score = axis.modelScores?.[work.id];
  return Number.isFinite(score) ? score : null;
}
function normalizeScores(rawScores, ids) {
  const entries = ids.map(id => [id, rawScores?.[id]]).filter(([, score]) => Number.isFinite(score));
  if (!entries.length) return {};
  const values = entries.map(([, score]) => score), min = Math.min(...values), max = Math.max(...values), span = max - min;
  return Object.fromEntries(entries.map(([id, score]) => [id, span < 1e-6 ? 0 : ((score - min) / span) * 1.84 - .92]));
}

async function getClipClassifier() {
  if (!clipClassifierPromise) {
    setModelStatus("loading clip · first time only");
    clipClassifierPromise = (async () => {
      const { pipeline, env } = await import(TRANSFORMERS_CDN);
      env.allowLocalModels = false; env.useBrowserCache = true;
      return pipeline("zero-shot-image-classification", CLIP_MODEL, {
        dtype: "q8",
        progress_callback: progress => {
          if (progress?.status === "progress" && Number.isFinite(progress.progress)) setModelStatus(`loading clip · ${Math.round(progress.progress)}%`);
        }
      });
    })().catch(error => { clipClassifierPromise = null; throw error; });
  }
  return clipClassifierPromise;
}

async function scoreAxisWithClip(axis) {
  const runToken = `${Date.now()}-${Math.random()}`;
  axis.runToken = runToken; axis.scoreSource = "loading"; axis.rawModelScores ||= {}; saveState(); renderSidebar();
  try {
    const classifier = await getClipClassifier();
    const labels = [`an artwork that feels ${axis.low}`, `an artwork that feels ${axis.high}`];
    const missing = works.filter(work => axisIncludes(axis, work) && !Number.isFinite(axis.rawModelScores[work.id]));
    for (let index = 0; index < missing.length; index++) {
      if (!state.axes.includes(axis) || axis.runToken !== runToken) { setModelStatus(""); return; }
      const work = missing[index];
      setModelStatus(`reading ${axis.low} ↔ ${axis.high} · ${index + 1}/${missing.length}`);
      const output = await classifier(imageUrl(work), labels, { hypothesis_template: "{}" });
      const low = output.find(item => item.label === labels[0])?.score ?? 0;
      const high = output.find(item => item.label === labels[1])?.score ?? 0;
      const total = low + high;
      axis.rawModelScores[work.id] = total ? Math.max(-1, Math.min(1, (high - low) / total)) : 0;
      if (index % 4 === 3 || index === missing.length - 1) { axis.modelScores = normalizeScores(axis.rawModelScores, axis.scopeIds); render(); }
    }
    if (!state.axes.includes(axis) || axis.runToken !== runToken) { setModelStatus(""); return; }
    axis.modelScores = normalizeScores(axis.rawModelScores, axis.scopeIds); axis.normalization = "relative"; axis.scoreSource = "clip"; delete axis.runToken;
    saveState(); render(); setModelStatus(`${axis.scopeIds.length} works placed`, "success");
  } catch (error) {
    console.warn("CLIP scoring unavailable", error);
    if (!state.axes.includes(axis)) return;
    axis.scoreSource = "error"; delete axis.runToken; saveState(); render(); setModelStatus("clip couldn’t score that axis", "error");
  }
}

function solvePosition(work, width, height) {
  const center = { x: width / 2, y: height / 2 };
  const scoredAxes = state.axes.filter(axis => axisIncludes(axis, work) && axisScore(work, axis) !== null);
  if (!scoredAxes.length) {
    const angle = hash(`angle:${work.id}`) * Math.PI * 2;
    const radius = Math.sqrt(hash(`radius:${work.id}`));
    return { x: center.x + Math.cos(angle) * radius * width * .43, y: center.y + Math.sin(angle) * radius * height * .4 };
  }
  let a00 = .06, a01 = 0, a11 = .06, b0 = 0, b1 = 0;
  scoredAxes.forEach(axis => {
    const p1 = { x: axis.a.x * width, y: axis.a.y * height }, p2 = { x: axis.b.x * width, y: axis.b.y * height };
    const dx = p2.x - p1.x, dy = p2.y - p1.y, length = Math.max(1, Math.hypot(dx, dy)), ux = dx / length, uy = dy / length;
    const midpoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const target = (midpoint.x - center.x) * ux + (midpoint.y - center.y) * uy + axisScore(work, axis) * length * .43;
    a00 += ux * ux; a01 += ux * uy; a11 += uy * uy; b0 += ux * target; b1 += uy * target;
  });
  const determinant = a00 * a11 - a01 * a01;
  let rx = (b0 * a11 - b1 * a01) / determinant, ry = (a00 * b1 - a01 * b0) / determinant;
  rx += (hash(`${work.id}:jx`) - .5) * 16; ry += (hash(`${work.id}:jy`) - .5) * 16;
  return { x: Math.max(38, Math.min(width - 38, center.x + rx)), y: Math.max(38, Math.min(height - 38, center.y + ry)) };
}

function svgEl(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value)); return element;
}
function labelGroup(text, x, y, color, anchor) {
  const group = svgEl("g", { style: `color:${color}` }), width = Math.max(52, text.length * 7 + 16), offset = anchor === "end" ? -width : 0;
  group.append(svgEl("rect", { x: x + offset, y: y - 13, width, height: 25, class: "axis-label-bg" }));
  const label = svgEl("text", { x: x + offset + 8, y: y + 4, class: "axis-label" }); label.textContent = text; group.append(label); return group;
}
function renderAxes(width, height) {
  axisSvg.replaceChildren(); axisSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  state.axes.forEach(axis => {
    const x1 = axis.a.x * width, y1 = axis.a.y * height, x2 = axis.b.x * width, y2 = axis.b.y * height;
    axisSvg.append(svgEl("line", { x1, y1, x2, y2, stroke: axis.color, class: "axis-line" }));
    axisSvg.append(svgEl("circle", { cx: x1, cy: y1, r: 5, fill: axis.color, class: "axis-dot" })); axisSvg.append(svgEl("circle", { cx: x2, cy: y2, r: 5, fill: axis.color, class: "axis-dot" }));
    axisSvg.append(labelGroup(axis.low, x1 + (x1 < x2 ? -8 : 8), y1 + (y1 < y2 ? -10 : 18), axis.color, x1 < x2 ? "end" : "start"));
    axisSvg.append(labelGroup(axis.high, x2 + (x2 > x1 ? 8 : -8), y2 + (y2 < y1 ? -10 : 18), axis.color, x2 > x1 ? "start" : "end"));
  });
  if (state.dragStart && state.dragEnd) axisSvg.append(svgEl("line", { x1: state.dragStart.x, y1: state.dragStart.y, x2: state.dragEnd.x, y2: state.dragEnd.y, class: "axis-temp" }));
}

function renderArt(width, height) {
  const visible = visibleWorks(), positions = new Map(visible.map(work => [work.id, solvePosition(work, width, height)]));
  const base = new Map([...positions].map(([id, point]) => [id, { ...point }])), minGap = visible.length > 80 ? 44 : width < 700 ? 54 : 68;
  canvas.classList.toggle("dense", visible.length > 80);
  for (let pass = 0; pass < 18; pass++) {
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
      const a = positions.get(visible[i].id), b = positions.get(visible[j].id); let dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
      if (distance < 1) { dx = hash(`${visible[i].id}:${visible[j].id}`) - .5; dy = .5; distance = Math.hypot(dx, dy); }
      if (distance < minGap) { const push = (minGap - distance) * .24, ux = dx / distance, uy = dy / distance; a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push; }
    }
    positions.forEach((point, id) => { const origin = base.get(id); point.x += (origin.x - point.x) * .04; point.y += (origin.y - point.y) * .04; point.x = Math.max(34, Math.min(width - 34, point.x)); point.y = Math.max(34, Math.min(height - 34, point.y)); });
  }
  const visibleIds = new Set(visible.map(work => work.id)), existing = new Map([...artLayer.children].map(element => [Number(element.dataset.id), element]));
  works.forEach(work => {
    let node = existing.get(work.id);
    if (!node) {
      node = document.createElement("button"); node.className = "art-node"; node.dataset.id = work.id; node.type = "button"; node.setAttribute("aria-label", `${work.title} by ${work.artist}`);
      const image = document.createElement("img"); image.src = imageUrl(work); image.alt = ""; image.loading = "lazy"; image.draggable = false; node.append(image);
      node.addEventListener("click", () => openDetail(work)); artLayer.append(node);
    }
    node.hidden = !visibleIds.has(work.id);
    if (visibleIds.has(work.id)) { const point = positions.get(work.id); node.style.left = `${point.x}px`; node.style.top = `${point.y}px`; }
  });
}

function renderSidebar() {
  document.querySelector("#axisCount").textContent = state.axes.length; axisList.replaceChildren();
  state.axes.forEach(axis => {
    const card = document.createElement("div"); card.className = "axis-card"; card.dataset.loading = axis.scoreSource === "loading"; card.style.setProperty("--axis-color", axis.color);
    card.innerHTML = `<div class="axis-card-top"><span class="axis-color"></span><span class="axis-name">${escapeHtml(axis.low)} → ${escapeHtml(axis.high)}</span><button class="axis-delete" type="button" aria-label="Remove ${escapeHtml(axis.low)} to ${escapeHtml(axis.high)}">×</button></div><div class="axis-scope-row"><span class="axis-scope-summary">${axis.scopeIds.length} works · this filter</span></div>`;
    card.querySelector(".axis-delete").addEventListener("click", () => { state.axes = state.axes.filter(item => item !== axis); saveState(); render(); });
    axisList.append(card);
  });
}
function renderFilters() {
  const filtered = filteredWorks(), search = document.querySelector("#collectionSearch");
  document.querySelector("#kindFilter").value = state.filter.kind; document.querySelector("#eraFilter").value = state.filter.era;
  if (document.activeElement !== search) search.value = state.filter.query;
  document.querySelector("#collectionCount").textContent = filtered.length;
  document.querySelector("#filterSummary").textContent = `${filtered.length} available for the next axis`;
}
function render() { const rect = canvas.getBoundingClientRect(); renderAxes(rect.width, rect.height); renderArt(rect.width, rect.height); renderSidebar(); renderFilters(); }

function openDetail(work) {
  const scores = state.axes.filter(axis => axisIncludes(axis, work) && axisScore(work, axis) !== null).map(axis => ({ axis, score: axisScore(work, axis) }));
  document.querySelector("#detailContent").innerHTML = `<img class="detail-image" src="${imageUrl(work, 843)}" alt="${escapeHtml(work.title)} by ${escapeHtml(work.artist)}" /><div class="detail-body"><span class="eyebrow">Art Institute of Chicago · ${work.id}</span><h2>${escapeHtml(work.title)}</h2><p class="artist">${escapeHtml(work.artist)}</p><dl class="metadata"><div><dt>date</dt><dd>${escapeHtml(work.date)}</dd></div><div><dt>origin</dt><dd>${escapeHtml(work.origin)}</dd></div><div><dt>medium</dt><dd>${escapeHtml(work.medium)}</dd></div><div><dt>type</dt><dd>${escapeHtml(kindLabels[work.kind])}</dd></div></dl>${scores.length ? `<span class="eyebrow">current reading</span><div class="score-list">${scores.map(({ axis, score }) => `<div class="score-row"><span>${escapeHtml(axis.low)} ↔ ${escapeHtml(axis.high)}</span><span class="score-track" style="--axis-color:${axis.color};--score:${(score + 1) * 50}%"><i></i></span></div>`).join("")}</div>` : ""}<a class="source-link" href="${work.source}" target="_blank" rel="noreferrer">view museum record ↗</a></div>`;
  detailPanel.classList.add("open"); detailPanel.setAttribute("aria-hidden", "false"); backdrop.hidden = false;
}
function closeDetail() { detailPanel.classList.remove("open"); detailPanel.setAttribute("aria-hidden", "true"); backdrop.hidden = true; }
function setDrawing(on) { state.drawing = on; drawButton.setAttribute("aria-pressed", String(on)); canvas.classList.toggle("drawing", on); document.querySelector("#drawHint").hidden = !on; }
function applyViewport() { worldLayer.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`; zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`; }
function setZoom(next, screenX = canvas.clientWidth / 2, screenY = canvas.clientHeight / 2) {
  const zoom = Math.max(.25, Math.min(4, next)), worldX = (screenX - state.panX) / state.zoom, worldY = (screenY - state.panY) / state.zoom;
  state.panX = screenX - worldX * zoom; state.panY = screenY - worldY * zoom; state.zoom = zoom; applyViewport();
}
function resetViewport() { state.zoom = 1; state.panX = 0; state.panY = 0; applyViewport(); }
function localPoint(event) { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left - state.panX) / state.zoom, y: (event.clientY - rect.top - state.panY) / state.zoom }; }
function updateAxisScopeHint() {
  const count = filteredWorks().length;
  document.querySelector("#axisScopeHint").textContent = count > 60 ? `${count} works · clip will take longer the first time` : `${count} work${count === 1 ? "" : "s"}`;
}

canvas.addEventListener("pointerdown", event => {
  if (state.drawing) { state.dragStart = localPoint(event); state.dragEnd = state.dragStart; canvas.setPointerCapture(event.pointerId); renderAxes(canvas.clientWidth, canvas.clientHeight); return; }
  if (event.button !== 0 || event.target.closest(".art-node,.floating-axes,.floating-actions,.model-status")) return;
  state.panning = true; state.panStart = { x: event.clientX - state.panX, y: event.clientY - state.panY }; canvas.classList.add("panning"); canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", event => {
  if (state.panning) { state.panX = event.clientX - state.panStart.x; state.panY = event.clientY - state.panStart.y; applyViewport(); return; }
  if (!state.dragStart) return; state.dragEnd = localPoint(event); renderAxes(canvas.clientWidth, canvas.clientHeight);
});
canvas.addEventListener("pointerup", event => {
  if (state.panning) { state.panning = false; state.panStart = null; canvas.classList.remove("panning"); return; }
  if (!state.dragStart) return;
  const end = localPoint(event), start = state.dragStart; state.dragStart = null; state.dragEnd = null;
  if (Math.hypot(end.x - start.x, end.y - start.y) * state.zoom < 70) { render(); return; }
  const rect = canvas.getBoundingClientRect(); state.pendingAxis = { a: { x: start.x / rect.width, y: start.y / rect.height }, b: { x: end.x / rect.width, y: end.y / rect.height } };
  setDrawing(false); document.querySelector("#axisForm").reset(); updateAxisScopeHint(); axisDialog.showModal(); setTimeout(() => document.querySelector("#startLabel").focus(), 0); render();
});
canvas.addEventListener("pointercancel", () => { state.panning = false; state.panStart = null; state.dragStart = null; state.dragEnd = null; canvas.classList.remove("panning"); render(); });
canvas.addEventListener("wheel", event => { if (event.target.closest(".floating-axes,.floating-actions")) return; event.preventDefault(); const rect = canvas.getBoundingClientRect(); setZoom(state.zoom * Math.exp(-event.deltaY * .0015), event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });

document.querySelector("#axisForm").addEventListener("submit", event => {
  if (event.submitter?.value === "cancel" || !state.pendingAxis) { state.pendingAxis = null; return; }
  event.preventDefault();
  const low = document.querySelector("#startLabel").value.trim(), high = document.querySelector("#endLabel").value.trim(); if (!low || !high) return;
  const scoped = filteredWorks();
  if (!scoped.length) { document.querySelector("#axisScopeHint").textContent = "no artworks match this filter"; return; }
  const axis = { ...state.pendingAxis, id: `axis-${Date.now()}`, low, high, color: palette[state.axes.length % palette.length], scopeMode: "current", scopeLabel: "this filter", scopeIds: scoped.map(work => work.id), rawModelScores: {}, modelScores: {}, scoreSource: "loading" };
  state.axes.push(axis); state.pendingAxis = null; axisDialog.close(); saveState(); render(); scoreAxisWithClip(axis);
});

drawButton.addEventListener("click", () => setDrawing(!state.drawing));
document.querySelector("#zoomOutButton").addEventListener("click", () => setZoom(state.zoom / 1.25)); document.querySelector("#zoomInButton").addEventListener("click", () => setZoom(state.zoom * 1.25)); zoomLevel.addEventListener("click", resetViewport);
document.querySelector("#resetButton").addEventListener("click", () => { state.axes = []; state.filter = { kind: "all", era: "all", query: "" }; resetViewport(); saveState(); render(); });
document.querySelector("#closeDetail").addEventListener("click", closeDetail); backdrop.addEventListener("click", closeDetail);

collectionButton.addEventListener("click", () => { const open = filterPanel.hidden; filterPanel.hidden = !open; collectionButton.setAttribute("aria-expanded", String(open)); if (open) setTimeout(() => document.querySelector("#collectionSearch").focus(), 0); });
document.addEventListener("pointerdown", event => { if (!filterPanel.hidden && !filterPanel.contains(event.target) && !collectionButton.contains(event.target)) { filterPanel.hidden = true; collectionButton.setAttribute("aria-expanded", "false"); } });
document.querySelector("#collectionSearch").addEventListener("input", event => { state.filter.query = event.target.value; saveState(); render(); });
document.querySelector("#kindFilter").addEventListener("change", event => { state.filter.kind = event.target.value; saveState(); render(); });
document.querySelector("#eraFilter").addEventListener("change", event => { state.filter.era = event.target.value; saveState(); render(); });
document.querySelector("#clearFilters").addEventListener("click", () => { state.filter = { kind: "all", era: "all", query: "" }; saveState(); render(); });
window.addEventListener("keydown", event => { if (event.key === "Escape" && detailPanel.classList.contains("open")) closeDetail(); });

function saveState() {
  const axes = state.axes.map(({ runToken, ...axis }) => axis);
  localStorage.setItem("art-axes-state", JSON.stringify({ version: STORAGE_VERSION, axes, filter: state.filter }));
}
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem("art-axes-state")); if (saved?.version !== STORAGE_VERSION) return;
    if (saved.filter) state.filter = { ...state.filter, ...saved.filter };
    if (Array.isArray(saved.axes)) {
      const validIds = new Set(works.map(work => work.id));
      state.axes = saved.axes.map((axis, index) => { const scopeIds = (axis.scopeIds || []).filter(id => validIds.has(id)); return { ...axis, color: palette[index % palette.length], scopeIds, scopeLabel: axis.scopeLabel || "saved filter", rawModelScores: axis.rawModelScores || {}, modelScores: normalizeScores(axis.rawModelScores || {}, scopeIds) }; });
    }
  } catch (error) { console.warn("Could not restore the previous canvas", error); }
}

function registerWebMCP() {
  const context = document.modelContext; if (!context?.registerTool) return;
  const rerender = () => { saveState(); render(); return { axisCount: state.axes.length, visibleWorks: visibleWorks().length, collectionSize: works.length }; };
  try {
    context.registerTool({ name: "filter_art_collection", title: "Filter art collection", description: "Choose the artworks that the next semantic axis will place, by type and period.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: Object.keys(kindLabels) }, era: { type: "string", enum: ["all", "ancient", "pre1800", "1800s", "modern"] }, query: { type: "string" } }, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(input) { state.filter = { ...state.filter, ...input }; return rerender(); } });
    context.registerTool({ name: "add_semantic_axis", title: "Add semantic axis", description: "Add a labeled semantic dimension scoped to the current artwork filter.", inputSchema: { type: "object", properties: { startLabel: { type: "string", minLength: 1 }, endLabel: { type: "string", minLength: 1 } }, required: ["startLabel", "endLabel"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, async execute({ startLabel, endLabel }) {
      const scoped = filteredWorks(), index = state.axes.length;
      const axis = { id: `axis-tool-${Date.now()}`, a: { x: .2 + (index % 3) * .06, y: .22 }, b: { x: .8 - (index % 3) * .04, y: .78 }, low: startLabel.trim(), high: endLabel.trim(), color: palette[index % palette.length], scopeMode: "current", scopeLabel: "saved filter", scopeIds: scoped.map(work => work.id), rawModelScores: {}, modelScores: {}, scoreSource: "loading" };
      state.axes.push(axis); rerender(); await scoreAxisWithClip(axis); return rerender();
    } });
  } catch (error) { console.warn("Structured browser tools unavailable", error); }
}

loadState(); saveState(); render(); applyViewport(); registerWebMCP(); new ResizeObserver(render).observe(canvas); state.axes.filter(axis => axis.scoreSource === "loading").forEach(scoreAxisWithClip);
