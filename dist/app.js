let works = Array.isArray(window.ARTWORKS) ? [...window.ARTWORKS] : [];
const museumWorks = [...works];
const palette = ["#91a7ff", "#ff9fc8", "#83d8bd", "#c5a3ff", "#ffbd86"];
const CLIP_MODEL = "Xenova/clip-vit-base-patch32";
const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";
const ZIP_FALLBACK_CDN = "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm";
const STORAGE_VERSION = 12;
const kindLabels = { all: "all works", painting: "paintings", paper: "works on paper", sculpture: "sculpture", object: "objects", textile: "textiles", photography: "photography", custom: "personal collection" };

const state = {
  draggingMagnet: null, frames: [], activeFrameId: null, filter: { kinds: [], era: "all", query: "" },
  drawing: false, dragStart: null, dragEnd: null, drawingFrameId: null, pendingAxis: null,
  zoom: 1, panX: 0, panY: 0, panning: false, panStart: null,
  draggingFrame: null, resizingFrame: null
};

const canvas = document.querySelector("#artCanvas");
const worldLayer = document.querySelector("#worldLayer");
const boardFrames = document.querySelector("#boardFrames");
const axisList = document.querySelector("#axisList");
const drawButton = document.querySelector("#drawButton");
const axisDialog = document.querySelector("#axisDialog");
const detailPanel = document.querySelector("#detailPanel");
const backdrop = document.querySelector("#backdrop");
const modelStatus = document.querySelector("#modelStatus");
const zoomLevel = document.querySelector("#zoomResetButton");
const filterPanel = document.querySelector("#filterPanel");
const collectionButton = document.querySelector("#collectionButton");
const uploadButton = document.querySelector("#uploadButton");
const uploadDialog = document.querySelector("#uploadDialog");
const uploadForm = document.querySelector("#uploadForm");
const artFileInput = document.querySelector("#artFile");
const artFolderInput = document.querySelector("#artFolder");
const uploadDropzone = document.querySelector("#uploadDropzone");
const frameDialog = document.querySelector("#frameDialog");
const deleteFrameDialog = document.querySelector("#deleteFrameDialog");
let clipClassifierPromise = null;
let zipInflaterPromise = null;
let statusTimer = null;
let selectedUploadItems = [];
let uploadPreviewUrl = null;
let pendingDeleteFrameId = null;
const FRAME_WIDTH = 720;
const FRAME_HEIGHT = 520;
const FRAME_GAP_X = 110;
const FRAME_GAP_Y = 130;
const BOARD_PADDING = 80;
const MIN_FRAME_WIDTH = 420;
const MIN_FRAME_HEIGHT = 320;

function defaultFrameLayout(index) {
  const columns = 2;
  return { x: BOARD_PADDING + (index % columns) * (FRAME_WIDTH + FRAME_GAP_X), y: BOARD_PADDING + Math.floor(index / columns) * (FRAME_HEIGHT + FRAME_GAP_Y), width: FRAME_WIDTH, height: FRAME_HEIGHT, contentWidth: FRAME_WIDTH, contentHeight: FRAME_HEIGHT };
}
function ensureFrameLayout(frame, index = state.frames.indexOf(frame)) {
  const fallback = defaultFrameLayout(Math.max(0, index));
  const width = Math.max(MIN_FRAME_WIDTH, Number.isFinite(frame.layout?.width) ? frame.layout.width : fallback.width);
  const height = Math.max(MIN_FRAME_HEIGHT, Number.isFinite(frame.layout?.height) ? frame.layout.height : fallback.height);
  frame.layout = {
    x: Number.isFinite(frame.layout?.x) ? frame.layout.x : fallback.x,
    y: Number.isFinite(frame.layout?.y) ? frame.layout.y : fallback.y,
    width,
    height,
    contentWidth: Number.isFinite(frame.layout?.contentWidth) ? frame.layout.contentWidth : width,
    contentHeight: Number.isFinite(frame.layout?.contentHeight) ? frame.layout.contentHeight : height
  };
  return frame.layout;
}

function createFrame(name, memberIds = [], mode = frameMode()) {
  return {
    id: `frame-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name, mode,
    memberIds: [...new Set(memberIds)],
    axes: [],
    layout: defaultFrameLayout(state.frames.length)
  };
}
function activeFrame() { return state.frames.find(frame => frame.id === state.activeFrameId) || state.frames[0] || null; }
function frameMode(frame = activeFrame()) { return frame?.mode === "magnets" ? "magnets" : "axes"; }
function modeDimensions(frame = activeFrame()) { return (frame?.axes || []).filter(axis => (axis.type === "magnet" ? "magnets" : "axes") === frameMode(frame)); }
function activeAxes() { return modeDimensions(); }
function renderMode() {
  document.querySelectorAll("[data-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === frameMode())));
  drawButton.innerHTML = `<span class="plus">＋</span> ${frameMode() === "magnets" ? "place magnet" : "draw axis"}`;
  document.querySelector(".floating-heading span").textContent = frameMode();
  const reset = document.querySelector("#resetButton"); reset.textContent = `clear ${frameMode()}`; reset.title = `clear ${frameMode()} in this frame`;
  document.querySelector("#drawHint").innerHTML = frameMode() === "magnets" ? "<b>click to place</b><span>then name your magnet</span>" : "<b>drag to draw</b><span>release to name the axis</span>";
}
function openMagnetDialog(frame, point) {
  const layout = ensureFrameLayout(frame);
  state.pendingAxis = { type: "magnet", frameId: frame.id, a: { x: point.x / layout.contentWidth, y: point.y / layout.contentHeight } };
  setDrawing(false); document.querySelector("#magnetForm").reset();
  document.querySelector("#magnetScopeHint").textContent = `${filteredWorks().length} artworks in this selection`;
  document.querySelector("#magnetDialog").showModal(); document.querySelector("#magnetLabel").focus();
}
function frameForAxis(axis) { return state.frames.find(frame => frame.axes.includes(axis)); }
function syncFrameMembers(frame) { frame.memberIds = [...new Set(frame.axes.flatMap(axis => axis.scopeIds || []))]; }
function switchFrame(frameId) {
  if (frameId === state.activeFrameId) return;
  closeDetail(); setDrawing(false); setModelStatus("");
  state.activeFrameId = frameId; saveState(); render();
}
function frameLayout(index) {
  return ensureFrameLayout(state.frames[index], index);
}
function boardBounds() {
  const layouts = state.frames.map((_, index) => frameLayout(index));
  return {
    width: Math.max(FRAME_WIDTH + BOARD_PADDING * 2, ...layouts.map(point => point.x + point.width + BOARD_PADDING)),
    height: Math.max(FRAME_HEIGHT + BOARD_PADDING * 2, ...layouts.map(point => point.y + point.height + BOARD_PADDING))
  };
}
function renameFrame(frame, nameElement) {
  const input = document.createElement("input");
  input.className = "frame-name-input"; input.value = frame.name; input.maxLength = 80;
  input.setAttribute("aria-label", `Rename ${frame.name}`);
  nameElement.replaceWith(input); input.focus(); input.select();
  let finished = false;
  const finish = cancel => {
    if (finished) return; finished = true;
    const nextName = input.value.trim();
    if (!cancel && nextName) frame.name = nextName;
    saveState(); render();
  };
  input.addEventListener("click", event => event.stopPropagation());
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); finish(false); }
    if (event.key === "Escape") { event.preventDefault(); finish(true); }
  });
  input.addEventListener("blur", () => finish(false));
}
function requestFrameDeletion(frame) {
  const axisCount = frame.axes.length;
  pendingDeleteFrameId = frame.id;
  document.querySelector("#deleteFrameMessage").textContent = `“${frame.name}”${axisCount ? ` and its ${axisCount} ${axisCount === 1 ? "axis" : "axes"}` : ""} will be removed. this cannot be undone.`;
  deleteFrameDialog.showModal();
}
function confirmFrameDeletion() {
  const frame = state.frames.find(item => item.id === pendingDeleteFrameId); pendingDeleteFrameId = null;
  if (!frame) return;
  frame.axes.forEach(axis => { axis.runToken = "deleted"; }); frame.axes = [];
  const index = state.frames.indexOf(frame), wasActive = frame.id === state.activeFrameId;
  state.frames = state.frames.filter(item => item !== frame);
  if (!state.frames.length) state.frames.push(createFrame("frame 1"));
  if (wasActive) {
    state.activeFrameId = state.frames[Math.min(index, state.frames.length - 1)].id;
    closeDetail(); setDrawing(false); setModelStatus("");
  }
  saveState(); render(); requestAnimationFrame(showAllFrames);
}

function imageUrl(work) { return work.imageUrl || `./art/${work.id}.jpg`; }
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

function openArtworkDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("art-axes", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("artworks", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function clearArtworkDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("art-axes");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
async function readCustomArtworks() {
  const database = await openArtworkDatabase();
  const records = await new Promise((resolve, reject) => {
    const request = database.transaction("artworks", "readonly").objectStore("artworks").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  records.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const normalized = [], updatedById = new Map(), duplicateIds = [];
  for (const original of records) {
    const record = {
      ...original,
      collectionName: original.collectionName?.trim() || "your art",
      kind: "custom",
      fingerprint: original.fingerprint || await fingerprintBlob(original.imageBlob)
    };
    normalized.push(record);
    if (!original.fingerprint || !original.collectionName || original.kind !== "custom") updatedById.set(record.id, record);
  }
  const namedCollections = new Map(normalized.filter(record => record.collectionName.toLowerCase() !== "your art").map(record => [record.collectionName.toLowerCase(), record.collectionName]));
  if (namedCollections.size === 1) {
    const targetName = [...namedCollections.values()][0];
    normalized.forEach(record => {
      if (record.collectionName.toLowerCase() === "your art") { record.collectionName = targetName; updatedById.set(record.id, record); }
    });
  }
  const unique = [], seen = new Set();
  for (const record of normalized) {
    const key = artworkDedupeKey(record);
    if (seen.has(key)) duplicateIds.push(record.id);
    else { seen.add(key); unique.push(record); }
  }
  duplicateIds.forEach(id => updatedById.delete(id));
  if (updatedById.size || duplicateIds.length) await commitArtworkChanges([...updatedById.values()], duplicateIds);
  return unique.map(record => ({ ...record, imageUrl: URL.createObjectURL(record.imageBlob), custom: true }));
}
async function commitArtworkChanges(records, idsToDelete = []) {
  const database = await openArtworkDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("artworks", "readwrite"), store = transaction.objectStore("artworks");
    records.forEach(record => store.put(record));
    idsToDelete.forEach(id => store.delete(id));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
async function storeCustomArtworks(records) {
  await commitArtworkChanges(records);
}
async function deleteCustomArtwork(id) {
  const database = await openArtworkDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("artworks", "readwrite");
    transaction.objectStore("artworks").delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
function eraFromYear(value) {
  const year = Number(String(value).match(/\d{3,4}/)?.[0]);
  if (!year) return "modern";
  if (year < 1500) return "ancient";
  if (year < 1800) return "pre1800";
  if (year < 1900) return "1800s";
  return "modern";
}
async function resizeArtwork(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvasElement = document.createElement("canvas");
  canvasElement.width = Math.max(1, Math.round(bitmap.width * scale));
  canvasElement.height = Math.max(1, Math.round(bitmap.height * scale));
  canvasElement.getContext("2d").drawImage(bitmap, 0, 0, canvasElement.width, canvasElement.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvasElement.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not prepare that image")), "image/webp", .88));
}
function titleFromFilename(filename) {
  return filename.split("/").pop().replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "untitled";
}
async function fingerprintBlob(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function artworkDedupeKey(work) {
  return [artworkContentKey(work), (work.collectionName || "your art").trim().toLowerCase()].join("\u0000");
}
function artworkContentKey(work) {
  return [work.fingerprint, work.title.trim().toLowerCase(), work.artist.trim().toLowerCase(), work.kind].join("\u0000");
}
function collectionToken(name) {
  return `collection:${encodeURIComponent((name || "your art").trim().toLowerCase())}`;
}
function imageMimeType(filename) {
  const extension = filename.split(".").pop().toLowerCase();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" })[extension] || "";
}
async function inflateZipEntry(compressed) {
  try {
    if (typeof DecompressionStream !== "undefined") return await new Response(compressed.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
  } catch (error) { console.info("Using zip compatibility fallback", error); }
  zipInflaterPromise ||= import(ZIP_FALLBACK_CDN);
  const { inflateSync } = await zipInflaterPromise;
  return new Blob([inflateSync(new Uint8Array(await compressed.arrayBuffer()))]);
}
async function extractZipImages(file, filename = file.name) {
  if (file.size > 250 * 1024 * 1024) throw new Error("zip files must be smaller than 250 mb");
  const buffer = await file.arrayBuffer(), bytes = new Uint8Array(buffer), view = new DataView(buffer);
  let endOffset = -1;
  for (let offset = Math.max(0, bytes.length - 65557); offset <= bytes.length - 22; offset++) {
    if (view.getUint32(offset, true) === 0x06054b50) endOffset = offset;
  }
  if (endOffset < 0) throw new Error(`${filename} could not be read`);
  const entryCount = view.getUint16(endOffset + 10, true);
  if (entryCount > 500) throw new Error("a zip can contain up to 500 artworks");
  let offset = view.getUint32(endOffset + 16, true), totalSize = 0;
  const decoder = new TextDecoder(), images = [];
  for (let index = 0; index < entryCount; index++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("that zip file has an unsupported structure");
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true), name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    const mimeType = imageMimeType(name), hidden = name.startsWith("__MACOSX/") || name.split("/").some(part => part.startsWith("."));
    if (!mimeType || name.endsWith("/") || hidden) continue;
    if (flags & 1) throw new Error("password-protected zip files aren’t supported");
    totalSize += size;
    if (size > 30 * 1024 * 1024 || totalSize > 250 * 1024 * 1024) throw new Error("the uncompressed artwork folder is too large");
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("that zip file has an unsupported structure");
    const localNameLength = view.getUint16(localOffset + 26, true), localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = new Blob([bytes.slice(dataStart, dataStart + compressedSize)]);
    let imageBlob;
    if (method === 0) imageBlob = compressed;
    else if (method === 8) imageBlob = await inflateZipEntry(compressed);
    else throw new Error("this zip uses a compression format your browser doesn’t support");
    if (imageBlob.size !== size) throw new Error(`couldn’t unpack ${name.split("/").pop()}`);
    images.push({ blob: new Blob([imageBlob], { type: mimeType }), name });
  }
  if (!images.length) throw new Error("no jpg, png, webp, or gif images were found in that zip");
  return images;
}
function clearUploadForm() {
  uploadForm.reset(); selectedUploadItems = [];
  if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
  uploadPreviewUrl = null;
  document.querySelector(".upload-placeholder").hidden = false;
  document.querySelector(".upload-preview").hidden = true;
  uploadDropzone.classList.remove("has-selection");
  document.querySelector("#uploadTitleField").hidden = false;
  document.querySelector("#batchTitleNote").hidden = true;
  document.querySelector("#addArtworkButton").textContent = "add to collection";
  document.querySelector("#uploadError").hidden = true;
  uploadDialog.dataset.saving = "false";
}
function readFileEntry(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}
async function readDirectoryEntry(entry) {
  const reader = entry.createReader(), children = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    children.push(...batch);
  }
  return children;
}
async function collectDroppedEntry(entry, results) {
  if (results.length > 500) throw new Error("you can import up to 500 artworks at once");
  if (entry.isFile) {
    const file = await readFileEntry(entry);
    const name = entry.fullPath?.replace(/^\//, "") || file.name;
    if (imageMimeType(name) || name.toLowerCase().endsWith(".zip")) results.push({ blob: file, name });
    return;
  }
  if (!entry.isDirectory) return;
  for (const child of await readDirectoryEntry(entry)) await collectDroppedEntry(child, results);
}
async function filesFromDrop(dataTransfer) {
  const entries = [...(dataTransfer.items || [])].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];
  const results = [];
  for (const entry of entries) await collectDroppedEntry(entry, results);
  return results;
}
async function chooseUploadFiles(files) {
  const error = document.querySelector("#uploadError");
  const picked = [...files].map(item => item?.blob ? item : ({ blob: item, name: item.webkitRelativePath || item.name }));
  if (!picked.length) return;
  error.hidden = true; uploadDialog.dataset.saving = "true";
  document.querySelector("#addArtworkButton").textContent = "reading files…";
  try {
    const items = [];
    for (const pickedFile of picked) {
      const file = pickedFile.blob, name = pickedFile.name;
      const isZip = file.type === "application/zip" || name.toLowerCase().endsWith(".zip");
      if (isZip) items.push(...await extractZipImages(file, name));
      else if (imageMimeType(name)) {
        if (file.size > 30 * 1024 * 1024) throw new Error(`${name} is over 30 mb`);
        items.push({ blob: file, name });
      }
    }
    if (!items.length) throw new Error("choose images or a zip folder containing images");
    const seenItems = new Set(), distinctItems = [];
    items.forEach(item => {
      const key = `${item.name}\u0000${item.blob.size}\u0000${item.blob.lastModified || 0}`;
      if (!seenItems.has(key)) { seenItems.add(key); distinctItems.push(item); }
    });
    items.splice(0, items.length, ...distinctItems);
    if (items.length > 500) throw new Error("you can import up to 500 artworks at once");
    selectedUploadItems = items;
    if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    uploadPreviewUrl = URL.createObjectURL(items[0].blob);
    document.querySelector("#uploadPreviewImage").src = uploadPreviewUrl;
    document.querySelector("#uploadFileName").textContent = items.length === 1 ? items[0].name.split("/").pop() : `${items.length} artworks ready`;
    const roots = new Set(picked.map(item => item.name.split("/")[0])), folderName = picked.some(item => item.name.includes("/")) && roots.size === 1 ? [...roots][0] : "";
    const sourceLabel = folderName || (picked.length === 1 ? picked[0].name.split("/").pop() : `${picked.length} selected files`);
    document.querySelector("#uploadFileSummary").textContent = `${sourceLabel} · change selection`;
    const zipName = picked.length === 1 && picked[0].name.toLowerCase().endsWith(".zip") ? titleFromFilename(picked[0].name) : "";
    document.querySelector("#uploadCollection").value = folderName || zipName || (picked.length > 1 ? "new collection" : "your art");
    document.querySelector(".upload-placeholder").hidden = true;
    document.querySelector(".upload-preview").hidden = false;
    uploadDropzone.classList.add("has-selection");
    document.querySelector("#uploadTitleField").hidden = items.length > 1;
    document.querySelector("#batchTitleNote").hidden = items.length === 1;
    const title = document.querySelector("#uploadTitle");
    if (items.length === 1 && !title.value) title.value = titleFromFilename(items[0].name);
    document.querySelector("#addArtworkButton").textContent = items.length === 1 ? "add to collection" : `add ${items.length} artworks`;
  } catch (caught) {
    selectedUploadItems = []; error.textContent = caught.message; error.hidden = false;
    document.querySelector("#addArtworkButton").textContent = "add to collection";
  } finally { uploadDialog.dataset.saving = "false"; }
}

function workMatchesFilter(work, filter) {
  const query = (filter.query || "").trim().toLowerCase();
  const kinds = Array.isArray(filter.kinds) ? filter.kinds : [];
  const matchesCollection = work.custom && (kinds.includes("custom") || kinds.includes(collectionToken(work.collectionName)));
  if (kinds.length && !(matchesCollection || kinds.includes(work.kind))) return false;
  if (filter.era !== "all" && work.era !== filter.era) return false;
  if (!query) return true;
  return [work.title, work.artist, work.medium, work.origin, work.classification].some(value => String(value).toLowerCase().includes(query));
}
function filteredWorks(filter = state.filter) {
  return works.filter(work => workMatchesFilter(work, filter));
}
function visibleWorks(frame = activeFrame()) {
  const includedIds = new Set(modeDimensions(frame).flatMap(axis => axis.scopeIds || []));
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
  const ownerFrame = frameForAxis(axis);
  if (!ownerFrame) return;
  const runToken = `${Date.now()}-${Math.random()}`;
  axis.runToken = runToken; axis.scoreSource = "loading"; axis.rawModelScores ||= {}; saveState(); if (activeFrame() === ownerFrame) renderSidebar();
  try {
    const classifier = await getClipClassifier();
    const labels = axis.type === "magnet" ? ["an artwork", `an artwork that feels ${axis.high}`] : [`an artwork that feels ${axis.low}`, `an artwork that feels ${axis.high}`];
    const missing = works.filter(work => axisIncludes(axis, work) && !Number.isFinite(axis.rawModelScores[work.id]));
    for (let index = 0; index < missing.length; index++) {
      if (!ownerFrame.axes.includes(axis) || axis.runToken !== runToken) { if (activeFrame() === ownerFrame) setModelStatus(""); return; }
      const work = missing[index];
      if (activeFrame() === ownerFrame) setModelStatus(`reading ${axis.type === "magnet" ? axis.high : `${axis.low} ↔ ${axis.high}`} · ${index + 1}/${missing.length}`);
      const output = await classifier(imageUrl(work), labels, { hypothesis_template: "{}" });
      const low = output.find(item => item.label === labels[0])?.score ?? 0;
      const high = output.find(item => item.label === labels[1])?.score ?? 0;
      const total = low + high;
      axis.rawModelScores[work.id] = total ? Math.max(-1, Math.min(1, (high - low) / total)) : 0;
      if (index % 4 === 3 || index === missing.length - 1) { axis.modelScores = normalizeScores(axis.rawModelScores, axis.scopeIds); if (activeFrame() === ownerFrame) render(); }
    }
    if (!ownerFrame.axes.includes(axis) || axis.runToken !== runToken) { if (activeFrame() === ownerFrame) setModelStatus(""); return; }
    axis.modelScores = normalizeScores(axis.rawModelScores, axis.scopeIds); axis.normalization = "relative"; axis.scoreSource = "clip"; delete axis.runToken;
    saveState(); if (activeFrame() === ownerFrame) { render(); setModelStatus(`${axis.scopeIds.length} works placed`, "success"); }
  } catch (error) {
    console.warn("CLIP scoring unavailable", error);
    if (!ownerFrame.axes.includes(axis)) return;
    axis.scoreSource = "error"; delete axis.runToken; saveState();
    if (activeFrame() === ownerFrame) { render(); setModelStatus(`clip couldn’t score that ${axis.type === "magnet" ? "magnet" : "axis"} · try scoring again`, "error"); }
  }
}

function solvePosition(work, width, height, frame = activeFrame()) {
  const center = { x: width / 2, y: height / 2 };
  const scoredAxes = modeDimensions(frame).filter(axis => axisIncludes(axis, work) && axisScore(work, axis) !== null);
  if (!scoredAxes.length) {
    const angle = hash(`angle:${work.id}`) * Math.PI * 2;
    const radius = Math.sqrt(hash(`radius:${work.id}`));
    return { x: center.x + Math.cos(angle) * radius * width * .43, y: center.y + Math.sin(angle) * radius * height * .4 };
  }
  if (frameMode(frame) === "magnets") {
    // Weak matches keep their spread; strong matches gather around their concepts.
    const angle = hash(`angle:${work.id}`) * Math.PI * 2, radius = Math.sqrt(hash(`radius:${work.id}`));
    let x = (center.x + Math.cos(angle) * radius * width * .43) * .35;
    let y = (center.y + Math.sin(angle) * radius * height * .4) * .35, total = .35;
    scoredAxes.forEach(magnet => {
      const affinity = Math.max(0, Math.min(1, (axisScore(work, magnet) + .92) / 1.84));
      const weight = affinity ** 3 * 4;
      x += magnet.a.x * width * weight; y += magnet.a.y * height * weight; total += weight;
    });
    return { x: Math.max(38, Math.min(width - 38, x / total)), y: Math.max(38, Math.min(height - 38, y / total)) };
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
function renderAxes(svg, width, height, frame) {
  svg.replaceChildren(); svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const layout = ensureFrameLayout(frame), contentWidth = layout.contentWidth, contentHeight = layout.contentHeight;
  modeDimensions(frame).forEach(axis => {
    if (axis.type === "magnet") {
      svg.append(svgEl("circle", { cx: axis.a.x * contentWidth, cy: axis.a.y * contentHeight, r: 65, fill: axis.color, opacity: .12 })); return;
    }
    const x1 = axis.a.x * contentWidth, y1 = axis.a.y * contentHeight, x2 = axis.b.x * contentWidth, y2 = axis.b.y * contentHeight;
    svg.append(svgEl("line", { x1, y1, x2, y2, stroke: axis.color, class: "axis-line" }));
    svg.append(svgEl("circle", { cx: x1, cy: y1, r: 5, fill: axis.color, class: "axis-dot" })); svg.append(svgEl("circle", { cx: x2, cy: y2, r: 5, fill: axis.color, class: "axis-dot" }));
    svg.append(labelGroup(axis.low, x1 + (x1 < x2 ? -8 : 8), y1 + (y1 < y2 ? -10 : 18), axis.color, x1 < x2 ? "end" : "start"));
    svg.append(labelGroup(axis.high, x2 + (x2 > x1 ? 8 : -8), y2 + (y2 < y1 ? -10 : 18), axis.color, x2 > x1 ? "start" : "end"));
  });
  if (state.drawingFrameId === frame.id && state.dragStart && state.dragEnd) svg.append(svgEl("line", { x1: state.dragStart.x, y1: state.dragStart.y, x2: state.dragEnd.x, y2: state.dragEnd.y, class: "axis-temp" }));
}

function renderArt(layer, frameCanvas, width, height, frame) {
  const layout = ensureFrameLayout(frame), contentWidth = layout.contentWidth, contentHeight = layout.contentHeight;
  const visible = visibleWorks(frame), positions = new Map(visible.map(work => [work.id, solvePosition(work, contentWidth, contentHeight, frame)]));
  const base = new Map([...positions].map(([id, point]) => [id, { ...point }])), minGap = visible.length > 80 ? 44 : contentWidth < 700 ? 54 : 68;
  frameCanvas.classList.toggle("dense", visible.length > 80);
  for (let pass = 0; pass < 18; pass++) {
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
      const a = positions.get(visible[i].id), b = positions.get(visible[j].id); let dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
      if (distance < 1) { dx = hash(`${visible[i].id}:${visible[j].id}`) - .5; dy = .5; distance = Math.hypot(dx, dy); }
      if (distance < minGap) { const push = (minGap - distance) * .24, ux = dx / distance, uy = dy / distance; a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push; }
    }
    positions.forEach((point, id) => { const origin = base.get(id); point.x += (origin.x - point.x) * .04; point.y += (origin.y - point.y) * .04; point.x = Math.max(34, Math.min(contentWidth - 34, point.x)); point.y = Math.max(34, Math.min(contentHeight - 34, point.y)); });
  }
  visible.forEach(work => {
    const workId = String(work.id);
    const node = document.createElement("button"); node.className = "art-node"; node.dataset.id = workId; node.type = "button"; node.setAttribute("aria-label", `${work.title} by ${work.artist}`);
    const image = document.createElement("img"); image.src = imageUrl(work); image.alt = ""; image.loading = "lazy"; image.draggable = false; node.append(image);
    node.addEventListener("click", event => {
      event.stopPropagation();
      if (state.activeFrameId !== frame.id) {
        state.activeFrameId = frame.id; saveState(); renderSidebar(); renderFilters();
        boardFrames.querySelectorAll(".board-frame").forEach(element => { element.dataset.selected = String(element.dataset.frameId === frame.id); });
      }
      openDetail(work);
    });
    const point = positions.get(work.id); node.style.left = `${point.x}px`; node.style.top = `${point.y}px`; layer.append(node);
  });
}

function renderSidebar() {
  renderMode();
  const axes = activeAxes();
  document.querySelector("#axisCount").textContent = axes.length; axisList.replaceChildren();
  axes.forEach(axis => {
    const card = document.createElement("div"); card.className = "axis-card"; card.dataset.loading = axis.scoreSource === "loading"; card.style.setProperty("--axis-color", axis.color);
    card.innerHTML = `<div class="axis-card-top"><span class="axis-color"></span><span class="axis-name">${axis.type === "magnet" ? "⊙ " : `${escapeHtml(axis.low)} → `}${escapeHtml(axis.high)}</span><button class="axis-delete" type="button" aria-label="Remove ${axis.type === "magnet" ? "magnet " : `${escapeHtml(axis.low)} to `}${escapeHtml(axis.high)}">×</button></div><div class="axis-scope-row"><span class="axis-scope-summary">${axis.scopeIds.length} works · ${axis.type === "magnet" ? "drag to move" : "this axis"}${axis.scoreSource === "error" ? " · scoring failed" : ""}</span></div>`;
    card.querySelector(".axis-delete").addEventListener("click", () => { const frame = activeFrame(); frame.axes = frame.axes.filter(item => item !== axis); syncFrameMembers(frame); saveState(); render(); });
    if (axis.scoreSource === "error" || (axis.scoreSource === "loading" && !axis.runToken)) {
      const retry = document.createElement("button"); retry.type = "button"; retry.className = "text-button"; retry.textContent = "retry scoring";
      retry.addEventListener("click", () => scoreAxisWithClip(axis)); card.append(retry);
    }
    axisList.append(card);
  });
}
function renderFrames() {
  boardFrames.replaceChildren();
  const bounds = boardBounds(); worldLayer.style.width = `${bounds.width}px`; worldLayer.style.height = `${bounds.height}px`;
  document.querySelector("#frameCount").textContent = state.frames.length;
  state.frames.forEach((frame, index) => {
    const selected = frame.id === state.activeFrameId;
    const position = frameLayout(index), item = document.createElement("section");
    item.className = "board-frame"; item.dataset.frameId = frame.id; item.dataset.selected = String(selected);
    item.style.left = `${position.x}px`; item.style.top = `${position.y}px`; item.style.width = `${position.width}px`; item.style.height = `${position.height + 36}px`; item.setAttribute("aria-label", `${frame.name} frame`);
    const header = document.createElement("header"); header.className = "board-frame-header";
    const main = document.createElement("button"); main.type = "button"; main.className = "board-frame-title";
    main.innerHTML = `<span class="frame-tab-name">${escapeHtml(frame.name)}</span><span class="frame-mode-badge">${frameMode(frame)}</span><span class="frame-tab-count">${visibleWorks(frame).length}</span>`;
    main.title = selected ? "drag to move · click to rename" : "drag to move · click to select";
    main.addEventListener("click", event => {
      if (frame.id !== state.activeFrameId) switchFrame(frame.id);
      else renameFrame(frame, event.currentTarget.querySelector(".frame-tab-name"));
    });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "frame-delete";
    remove.textContent = "×"; remove.setAttribute("aria-label", `Delete ${frame.name}`); remove.title = `delete ${frame.name}`;
    remove.addEventListener("click", () => requestFrameDeletion(frame));
    header.append(main, remove);
    const frameCanvas = document.createElement("div"); frameCanvas.className = "board-frame-canvas"; frameCanvas.dataset.frameId = frame.id;
    frameCanvas.style.width = `${position.width}px`; frameCanvas.style.height = `${position.height}px`;
    const svg = svgEl("svg", { class: "axis-svg", "aria-hidden": "true" }), layer = document.createElement("div"); layer.className = "art-layer";
    frameCanvas.append(svg, layer);
    modeDimensions(frame).filter(axis => axis.type === "magnet").forEach(magnet => {
      const handle = document.createElement("button"); handle.type = "button"; handle.className = "magnet-handle"; handle.dataset.magnetId = magnet.id;
      handle.style.left = `${magnet.a.x * position.contentWidth}px`; handle.style.top = `${magnet.a.y * position.contentHeight}px`; handle.style.setProperty("--magnet-color", magnet.color);
      handle.textContent = `⊙ ${magnet.high}`; handle.setAttribute("aria-label", `${magnet.high} magnet; drag or use arrow keys to move`);
      handle.addEventListener("keydown", event => {
        const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }, delta = deltas[event.key]; if (!delta) return;
        event.preventDefault(); const step = event.shiftKey ? 30 : 10;
        magnet.a.x = Math.max(.04, Math.min(.96, magnet.a.x + delta[0] * step / position.contentWidth)); magnet.a.y = Math.max(.04, Math.min(.96, magnet.a.y + delta[1] * step / position.contentHeight));
        saveState(); render(); [...boardFrames.querySelectorAll(".magnet-handle")].find(button => button.dataset.magnetId === magnet.id)?.focus();
      }); frameCanvas.append(handle);
    });
    if (!visibleWorks(frame).length) { const empty = document.createElement("div"); empty.className = "empty-frame-hint"; empty.innerHTML = `<b>empty ${frameMode(frame)} frame</b><span>select art, then ${frameMode(frame) === "magnets" ? "place a magnet" : "draw an axis"}</span>`; frameCanvas.append(empty); }
    const resize = document.createElement("button"); resize.type = "button"; resize.className = "frame-resize-handle"; resize.setAttribute("aria-label", `Resize ${frame.name}`); resize.title = "drag to resize"; frameCanvas.append(resize);
    item.append(header, frameCanvas); boardFrames.append(item);
    renderAxes(svg, position.width, position.height, frame); renderArt(layer, frameCanvas, position.width, position.height, frame);
    item.addEventListener("dblclick", event => { if (!event.target.closest("button,input")) focusFrame(frame.id); });
  });
}
function renderFilters() {
  const filtered = filteredWorks(), search = document.querySelector("#collectionSearch");
  const customOptions = document.querySelector("#customFilterOptions");
  const collectionNames = [...new Map(works.filter(work => work.custom).map(work => {
    const name = work.collectionName || "your art"; return [collectionToken(name), name];
  })).values()];
  const collectionSignature = JSON.stringify(collectionNames);
  if (customOptions.dataset.collections !== collectionSignature) {
    customOptions.replaceChildren(); customOptions.dataset.collections = collectionSignature;
    collectionNames.forEach(name => {
      const label = document.createElement("label"); label.className = "user-collection-option";
      const input = document.createElement("input"); input.type = "checkbox"; input.value = collectionToken(name);
      const text = document.createElement("span"); text.textContent = name; text.title = name;
      label.append(input, text); customOptions.append(label);
    });
  }
  const selectedKinds = new Set(state.filter.kinds || []);
  document.querySelectorAll("#kindFilter input").forEach(input => { input.checked = selectedKinds.has(input.value); });
  document.querySelector("#eraFilter").value = state.filter.era;
  if (document.activeElement !== search) search.value = state.filter.query;
  document.querySelector("#collectionCount").textContent = filtered.length;
  document.querySelector("#filterSummary").textContent = `${filtered.length} available for the next ${frameMode() === "magnets" ? "magnet" : "axis"}`;
}
function render() { renderFrames(); renderSidebar(); renderFilters(); }

function openDetail(work) {
  const scores = activeAxes().filter(axis => axisIncludes(axis, work) && axisScore(work, axis) !== null).map(axis => ({ axis, score: axisScore(work, axis) }));
  const provenance = work.custom ? escapeHtml(work.collectionName || "your art") : `Art Institute of Chicago · ${work.id}`;
  const action = work.custom ? `<button class="remove-art-button" type="button" data-remove-art>remove from collection</button>` : `<a class="source-link" href="${work.source}" target="_blank" rel="noreferrer">view museum record ↗</a>`;
  const typeMetadata = work.custom ? "" : `<div><dt>type</dt><dd>${escapeHtml(kindLabels[work.kind])}</dd></div>`;
  document.querySelector("#detailContent").innerHTML = `<img class="detail-image" src="${imageUrl(work)}" alt="${escapeHtml(work.title)} by ${escapeHtml(work.artist)}" /><div class="detail-body"><span class="eyebrow">${provenance}</span><h2>${escapeHtml(work.title)}</h2><p class="artist">${escapeHtml(work.artist)}</p><dl class="metadata"><div><dt>date</dt><dd>${escapeHtml(work.date)}</dd></div><div><dt>origin</dt><dd>${escapeHtml(work.origin)}</dd></div><div><dt>medium</dt><dd>${escapeHtml(work.medium)}</dd></div>${typeMetadata}</dl>${scores.length ? `<span class="eyebrow">current reading</span><div class="score-list">${scores.map(({ axis, score }) => `<div class="score-row"><span>${axis.type === "magnet" ? "attraction to " : `${escapeHtml(axis.low)} ↔ `}${escapeHtml(axis.high)}</span><span class="score-track" style="--axis-color:${axis.color};--score:${(score + 1) * 50}%"><i></i></span></div>`).join("")}</div>` : ""}${action}</div>`;
  document.querySelector("[data-remove-art]")?.addEventListener("click", () => removeArtwork(work));
  detailPanel.classList.add("open"); detailPanel.setAttribute("aria-hidden", "false"); backdrop.hidden = false;
}
async function removeArtwork(work) {
  if (!window.confirm(`remove “${work.title}” from your collection?`)) return;
  try {
    await deleteCustomArtwork(work.id);
    URL.revokeObjectURL(work.imageUrl);
    works = works.filter(item => item !== work);
    state.frames.forEach(frame => {
      frame.memberIds = frame.memberIds.filter(id => id !== work.id);
      frame.axes.forEach(axis => {
        axis.scopeIds = axis.scopeIds.filter(id => id !== work.id);
        delete axis.rawModelScores?.[work.id]; delete axis.modelScores?.[work.id];
        axis.modelScores = normalizeScores(axis.rawModelScores, axis.scopeIds);
      });
    });
    closeDetail(); saveState(); render(); setModelStatus("artwork removed", "success");
  } catch (error) { console.warn("Could not remove artwork", error); setModelStatus("couldn’t remove that artwork", "error"); }
}
function closeDetail() { detailPanel.classList.remove("open"); detailPanel.setAttribute("aria-hidden", "true"); backdrop.hidden = true; }
function setDrawing(on) { state.drawing = on; drawButton.setAttribute("aria-pressed", String(on)); canvas.classList.toggle("drawing", on); document.querySelector("#drawHint").hidden = !on; }
function applyViewport() { worldLayer.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`; zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`; }
function setZoom(next, screenX = canvas.clientWidth / 2, screenY = canvas.clientHeight / 2) {
  const zoom = Math.max(.12, Math.min(4, next)), worldX = (screenX - state.panX) / state.zoom, worldY = (screenY - state.panY) / state.zoom;
  state.panX = screenX - worldX * zoom; state.panY = screenY - worldY * zoom; state.zoom = zoom; applyViewport(); saveState();
}
function resetViewport() { state.zoom = 1; state.panX = 0; state.panY = 0; applyViewport(); saveState(); }
function localFramePoint(event, frameCanvas) {
  const rect = frameCanvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * (frameCanvas.clientWidth / rect.width), y: (event.clientY - rect.top) * (frameCanvas.clientHeight / rect.height) };
}
function showAllFrames() {
  const bounds = boardBounds(), inset = 42;
  state.zoom = Math.max(.12, Math.min(1, (canvas.clientWidth - inset * 2) / bounds.width, (canvas.clientHeight - inset * 2) / bounds.height));
  state.panX = (canvas.clientWidth - bounds.width * state.zoom) / 2;
  state.panY = (canvas.clientHeight - bounds.height * state.zoom) / 2;
  applyViewport(); saveState();
}
function focusFrame(frameId) {
  const index = state.frames.findIndex(frame => frame.id === frameId); if (index < 0) return;
  state.activeFrameId = frameId; const point = frameLayout(index), inset = 70;
  state.zoom = Math.max(.25, Math.min(1.3, (canvas.clientWidth - inset * 2) / point.width, (canvas.clientHeight - inset * 2) / point.height));
  state.panX = canvas.clientWidth / 2 - (point.x + point.width / 2) * state.zoom;
  state.panY = canvas.clientHeight / 2 - (point.y + point.height / 2) * state.zoom;
  applyViewport(); saveState(); render();
}
function refreshDrawingAxis() {
  const frame = state.frames.find(item => item.id === state.drawingFrameId);
  const element = [...boardFrames.querySelectorAll(".board-frame")].find(item => item.dataset.frameId === state.drawingFrameId);
  if (frame && element) { const layout = ensureFrameLayout(frame); renderAxes(element.querySelector(".axis-svg"), layout.width, layout.height, frame); }
}
function updateAxisScopeHint() {
  const count = filteredWorks().length;
  document.querySelector("#axisScopeHint").textContent = count > 60 ? `${count} works · clip will take longer the first time` : `${count} work${count === 1 ? "" : "s"}`;
}

canvas.addEventListener("pointerdown", event => {
  const frameCanvas = event.target.closest(".board-frame-canvas"), frameElement = event.target.closest(".board-frame");
  if (frameElement && frameElement.dataset.frameId !== state.activeFrameId && !event.target.closest("button,input")) {
    state.activeFrameId = frameElement.dataset.frameId; saveState(); renderSidebar(); renderFilters();
    boardFrames.querySelectorAll(".board-frame").forEach(element => { element.dataset.selected = String(element.dataset.frameId === state.activeFrameId); });
  }
  const magnetHandle = event.target.closest(".magnet-handle");
  if (magnetHandle && frameCanvas && event.button === 0) {
    state.draggingMagnet = { frameId: frameCanvas.dataset.frameId, id: magnetHandle.dataset.magnetId };
    canvas.setPointerCapture(event.pointerId); event.preventDefault(); return;
  }
  const resizeHandle = event.target.closest(".frame-resize-handle");
  if (resizeHandle && frameElement) {
    const frame = state.frames.find(item => item.id === frameElement.dataset.frameId), layout = ensureFrameLayout(frame);
    state.activeFrameId = frame.id; renderSidebar(); renderFilters(); state.resizingFrame = { frameId: frame.id, startX: event.clientX, startY: event.clientY, width: layout.width, height: layout.height };
    canvas.setPointerCapture(event.pointerId); event.preventDefault(); return;
  }
  const frameTitle = event.target.closest(".board-frame-title");
  if (frameTitle && frameElement) {
    const frame = state.frames.find(item => item.id === frameElement.dataset.frameId), layout = ensureFrameLayout(frame);
    state.activeFrameId = frame.id; renderSidebar(); renderFilters(); state.draggingFrame = { frameId: frame.id, startX: event.clientX, startY: event.clientY, x: layout.x, y: layout.y, moved: false };
    canvas.setPointerCapture(event.pointerId); return;
  }
  if (frameElement && !frameCanvas) return;
  if (state.drawing) {
    if (!frameCanvas || event.button !== 0) return;
    if (frameMode() === "magnets") { openMagnetDialog(activeFrame(), localFramePoint(event, frameCanvas)); return; }
    state.drawingFrameId = frameCanvas.dataset.frameId; state.activeFrameId = state.drawingFrameId;
    state.dragStart = localFramePoint(event, frameCanvas); state.dragEnd = state.dragStart; canvas.setPointerCapture(event.pointerId); refreshDrawingAxis(); return;
  }
  if (frameCanvas) return;
  if (event.button !== 0 || event.target.closest("button,input,.art-node,.floating-axes,.floating-actions,.model-status")) return;
  state.panning = true; state.panStart = { x: event.clientX - state.panX, y: event.clientY - state.panY }; canvas.classList.add("panning"); canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", event => {
  if (state.draggingMagnet) {
    const drag = state.draggingMagnet, frame = state.frames.find(item => item.id === drag.frameId);
    const element = [...boardFrames.querySelectorAll(".board-frame-canvas")].find(item => item.dataset.frameId === frame.id);
    const point = localFramePoint(event, element), layout = ensureFrameLayout(frame), magnet = frame.axes.find(axis => axis.id === drag.id);
    magnet.a = { x: Math.max(.04, Math.min(.96, point.x / layout.contentWidth)), y: Math.max(.04, Math.min(.96, point.y / layout.contentHeight)) }; render(); return;
  }
  if (state.draggingFrame) {
    const drag = state.draggingFrame, frame = state.frames.find(item => item.id === drag.frameId), layout = ensureFrameLayout(frame);
    const deltaX = event.clientX - drag.startX, deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    drag.moved = true;
    layout.x = Math.max(20, drag.x + (event.clientX - drag.startX) / state.zoom); layout.y = Math.max(20, drag.y + (event.clientY - drag.startY) / state.zoom);
    const element = [...boardFrames.querySelectorAll(".board-frame")].find(item => item.dataset.frameId === frame.id);
    if (element) { element.classList.add("moving"); element.style.left = `${layout.x}px`; element.style.top = `${layout.y}px`; }
    return;
  }
  if (state.resizingFrame) {
    const resize = state.resizingFrame, frame = state.frames.find(item => item.id === resize.frameId), layout = ensureFrameLayout(frame);
    layout.width = Math.max(MIN_FRAME_WIDTH, resize.width + (event.clientX - resize.startX) / state.zoom);
    layout.height = Math.max(MIN_FRAME_HEIGHT, resize.height + (event.clientY - resize.startY) / state.zoom);
    const element = [...boardFrames.querySelectorAll(".board-frame")].find(item => item.dataset.frameId === frame.id);
    if (element) {
      element.style.width = `${layout.width}px`; element.style.height = `${layout.height + 36}px`;
      const inner = element.querySelector(".board-frame-canvas"); inner.style.width = `${layout.width}px`; inner.style.height = `${layout.height}px`;
      inner.querySelector(".axis-svg")?.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
    }
    return;
  }
  if (state.panning) { state.panX = event.clientX - state.panStart.x; state.panY = event.clientY - state.panStart.y; applyViewport(); return; }
  if (!state.dragStart) return;
  const frameCanvas = [...boardFrames.querySelectorAll(".board-frame-canvas")].find(element => element.dataset.frameId === state.drawingFrameId);
  if (!frameCanvas) return; state.dragEnd = localFramePoint(event, frameCanvas); refreshDrawingAxis();
});
canvas.addEventListener("pointerup", event => {
  if (state.draggingMagnet) { state.draggingMagnet = null; saveState(); render(); return; }
  if (state.draggingFrame) {
    const moved = state.draggingFrame.moved; state.draggingFrame = null;
    if (moved) { saveState(); render(); }
    return;
  }
  if (state.resizingFrame) { state.resizingFrame = null; saveState(); render(); return; }
  if (state.panning) { state.panning = false; state.panStart = null; canvas.classList.remove("panning"); saveState(); return; }
  if (!state.dragStart) return;
  const frameCanvas = [...boardFrames.querySelectorAll(".board-frame-canvas")].find(element => element.dataset.frameId === state.drawingFrameId);
  if (!frameCanvas) return;
  const end = localFramePoint(event, frameCanvas), start = state.dragStart, frameId = state.drawingFrameId; state.dragStart = null; state.dragEnd = null; state.drawingFrameId = null;
  if (Math.hypot(end.x - start.x, end.y - start.y) * state.zoom < 70) { render(); return; }
  const drawingFrame = state.frames.find(frame => frame.id === frameId), layout = ensureFrameLayout(drawingFrame);
  state.pendingAxis = { frameId, a: { x: start.x / layout.contentWidth, y: start.y / layout.contentHeight }, b: { x: end.x / layout.contentWidth, y: end.y / layout.contentHeight } };
  setDrawing(false); document.querySelector("#axisForm").reset(); updateAxisScopeHint(); axisDialog.showModal(); setTimeout(() => document.querySelector("#startLabel").focus(), 0); render();
});
canvas.addEventListener("pointercancel", () => { state.draggingMagnet = null; saveState(); state.panning = false; state.panStart = null; state.dragStart = null; state.dragEnd = null; state.drawingFrameId = null; state.draggingFrame = null; state.resizingFrame = null; canvas.classList.remove("panning"); render(); });
canvas.addEventListener("wheel", event => { if (event.target.closest(".floating-axes,.floating-actions")) return; event.preventDefault(); const rect = canvas.getBoundingClientRect(); setZoom(state.zoom * Math.exp(-event.deltaY * .0015), event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });

document.querySelector("#axisForm").addEventListener("submit", event => {
  if (event.submitter?.value === "cancel" || !state.pendingAxis) { state.pendingAxis = null; return; }
  event.preventDefault();
  const low = document.querySelector("#startLabel").value.trim(), high = document.querySelector("#endLabel").value.trim(); if (!low || !high) return;
  const frame = state.frames.find(item => item.id === state.pendingAxis.frameId) || activeFrame(), scoped = filteredWorks(); state.activeFrameId = frame.id;
  if (!scoped.length) { document.querySelector("#axisScopeHint").textContent = "no artworks match this selection"; return; }
  const scopeIds = scoped.map(work => work.id);
  frame.memberIds = [...new Set([...frame.memberIds, ...scopeIds])];
  const axis = { ...state.pendingAxis, id: `axis-${Date.now()}`, low, high, color: palette[frame.axes.length % palette.length], scopeMode: "selection", scopeLabel: "saved selection", scopeIds, rawModelScores: {}, modelScores: {}, scoreSource: "loading" };
  frame.axes.push(axis); state.pendingAxis = null; axisDialog.close(); saveState(); render(); scoreAxisWithClip(axis);
});

document.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => {
  setDrawing(false); activeFrame().mode = button.dataset.mode; state.pendingAxis = null; saveState(); render();
}));
document.querySelector("#magnetForm").addEventListener("submit", event => {
  if (event.submitter?.value === "cancel" || !state.pendingAxis) { state.pendingAxis = null; return; }
  event.preventDefault(); const high = document.querySelector("#magnetLabel").value.trim(); if (!high) return;
  const scoped = filteredWorks(); if (!scoped.length) { document.querySelector("#magnetScopeHint").textContent = "no artworks match this selection"; return; }
  const frame = state.frames.find(item => item.id === state.pendingAxis.frameId);
  const magnet = { ...state.pendingAxis, id: `magnet-${Date.now()}`, low: "artwork", high, color: palette[modeDimensions(frame).length % palette.length], scopeIds: scoped.map(work => work.id), rawModelScores: {}, modelScores: {}, scoreSource: "loading" };
  frame.axes.push(magnet); syncFrameMembers(frame); state.pendingAxis = null; document.querySelector("#magnetDialog").close(); saveState(); render(); scoreAxisWithClip(magnet);
});
[axisDialog, document.querySelector("#magnetDialog")].forEach(dialog => dialog.addEventListener("close", () => { state.pendingAxis = null; }));
drawButton.addEventListener("click", () => setDrawing(!state.drawing));
document.querySelector("#zoomOutButton").addEventListener("click", () => setZoom(state.zoom / 1.25)); document.querySelector("#zoomInButton").addEventListener("click", () => setZoom(state.zoom * 1.25)); zoomLevel.addEventListener("click", resetViewport);
document.querySelector("#showAllFramesButton").addEventListener("click", showAllFrames);
document.querySelector("#resetButton").addEventListener("click", () => {
  const frame = activeFrame(); if (!modeDimensions(frame).length || !window.confirm(`clear all ${frameMode()} from “${frame.name}”?`)) return;
  const removed = new Set(modeDimensions(frame)); frame.axes = frame.axes.filter(axis => !removed.has(axis)); syncFrameMembers(frame); saveState(); render();
});
document.querySelector("#closeDetail").addEventListener("click", closeDetail); backdrop.addEventListener("click", closeDetail);

document.querySelector("#newFrameButton").addEventListener("click", () => {
  document.querySelector("#frameScopeSummary").textContent = "choose how to arrange art in this frame. artworks appear when you add its first axis or magnet.";
  document.querySelector("#frameMode").value = frameMode();
  const name = document.querySelector("#frameName"); name.value = `frame ${state.frames.length + 1}`;
  frameDialog.showModal(); setTimeout(() => name.select(), 0);
});
document.querySelector("#frameForm").addEventListener("submit", event => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const name = document.querySelector("#frameName").value.trim();
  if (!name) return;
  const frame = createFrame(name, [], document.querySelector("#frameMode").value); state.frames.push(frame); state.activeFrameId = frame.id;
  frameDialog.close(); filterPanel.hidden = true; collectionButton.setAttribute("aria-expanded", "false"); saveState(); render(); requestAnimationFrame(() => focusFrame(frame.id));
});
document.querySelector("#deleteFrameForm").addEventListener("submit", event => {
  if (event.submitter?.value === "cancel") { pendingDeleteFrameId = null; return; }
  event.preventDefault(); confirmFrameDeletion(); deleteFrameDialog.close();
});
deleteFrameDialog.addEventListener("close", () => { pendingDeleteFrameId = null; });

collectionButton.addEventListener("click", () => { const open = filterPanel.hidden; filterPanel.hidden = !open; collectionButton.setAttribute("aria-expanded", String(open)); if (open) setTimeout(() => document.querySelector("#collectionSearch").focus(), 0); });
document.addEventListener("pointerdown", event => { if (!filterPanel.hidden && !filterPanel.contains(event.target) && !collectionButton.contains(event.target)) { filterPanel.hidden = true; collectionButton.setAttribute("aria-expanded", "false"); } });
document.querySelector("#collectionSearch").addEventListener("input", event => { state.filter.query = event.target.value; saveState(); render(); });
document.querySelector("#kindFilter").addEventListener("change", () => { state.filter.kinds = [...document.querySelectorAll("#kindFilter input:checked")].map(input => input.value); saveState(); render(); });
document.querySelector("#eraFilter").addEventListener("change", event => { state.filter.era = event.target.value; saveState(); render(); });
document.querySelector("#clearFilters").addEventListener("click", () => { state.filter = { kinds: [], era: "all", query: "" }; saveState(); render(); });
window.addEventListener("keydown", event => { if (event.key === "Escape" && detailPanel.classList.contains("open")) closeDetail(); });

uploadButton.addEventListener("click", () => { clearUploadForm(); uploadDialog.showModal(); });
document.querySelector("#closeUpload").addEventListener("click", () => uploadDialog.close());
document.querySelector("#cancelUpload").addEventListener("click", () => uploadDialog.close());
document.querySelector("#chooseFilesButton").addEventListener("click", () => artFileInput.click());
document.querySelector("#chooseFolderButton").addEventListener("click", () => artFolderInput.click());
document.querySelector(".upload-preview").addEventListener("click", () => artFileInput.click());
artFileInput.addEventListener("change", event => chooseUploadFiles(event.target.files));
artFolderInput.addEventListener("change", event => chooseUploadFiles(event.target.files));
["dragenter", "dragover"].forEach(type => uploadDropzone.addEventListener(type, event => { event.preventDefault(); uploadDropzone.classList.add("dragging"); }));
["dragleave", "drop"].forEach(type => uploadDropzone.addEventListener(type, event => { event.preventDefault(); uploadDropzone.classList.remove("dragging"); }));
uploadDropzone.addEventListener("drop", async event => {
  try { await chooseUploadFiles(await filesFromDrop(event.dataTransfer)); }
  catch (error) { const message = document.querySelector("#uploadError"); message.textContent = error.message; message.hidden = false; }
});
uploadDialog.addEventListener("close", clearUploadForm);
uploadForm.addEventListener("submit", async event => {
  event.preventDefault();
  const errorElement = document.querySelector("#uploadError");
  const customTitle = document.querySelector("#uploadTitle").value.trim();
  if (!selectedUploadItems.length) { errorElement.textContent = "choose images or a zip folder to add"; errorElement.hidden = false; return; }
  if (selectedUploadItems.length === 1 && !customTitle) { errorElement.textContent = "give this artwork a title"; errorElement.hidden = false; return; }
  uploadDialog.dataset.saving = "true"; errorElement.hidden = true;
  try {
    const year = document.querySelector("#uploadYear").value.trim();
    const artist = document.querySelector("#uploadArtist").value.trim() || "unknown artist", kind = "custom";
    const collectionName = document.querySelector("#uploadCollection").value.trim() || "your art";
    const customWorks = works.filter(work => work.custom && work.fingerprint);
    const records = [], updatedRecords = [], knownKeys = new Set(customWorks.map(artworkDedupeKey));
    const legacyByContent = new Map(customWorks.filter(work => (work.collectionName || "your art").toLowerCase() === "your art").map(work => [artworkContentKey(work), work]));
    let skipped = 0, reassigned = 0;
    for (let index = 0; index < selectedUploadItems.length; index++) {
      document.querySelector("#addArtworkButton").textContent = `preparing ${index + 1}/${selectedUploadItems.length}`;
      const item = selectedUploadItems[index], imageBlob = await resizeArtwork(item.blob), fingerprint = await fingerprintBlob(imageBlob);
      const record = {
        id: `custom-${crypto.randomUUID?.() || `${Date.now()}-${index}`}`,
        title: selectedUploadItems.length === 1 ? customTitle : titleFromFilename(item.name), artist,
        date: year || "date unknown", origin: "your collection", medium: "uploaded image",
        classification: "user-uploaded artwork", kind, era: eraFromYear(year), custom: true, collectionName,
        createdAt: Date.now() + index, imageBlob, fingerprint
      };
      const key = artworkDedupeKey(record);
      if (knownKeys.has(key)) skipped++;
      else {
        const legacy = collectionName.toLowerCase() !== "your art" ? legacyByContent.get(artworkContentKey(record)) : null;
        if (legacy) {
          legacy.collectionName = collectionName;
          const storedLegacy = { ...legacy }; delete storedLegacy.imageUrl;
          updatedRecords.push(storedLegacy); legacyByContent.delete(artworkContentKey(record)); reassigned++;
        } else records.push(record);
        knownKeys.add(key);
      }
    }
    if (!records.length && !updatedRecords.length) throw new Error("those artworks are already in this collection");
    await storeCustomArtworks([...records, ...updatedRecords]);
    const addedWorks = records.map(record => ({ ...record, imageUrl: URL.createObjectURL(record.imageBlob) }));
    works.push(...addedWorks);
    uploadDialog.close(); saveState(); render();
    const parts = [];
    if (records.length) parts.push(`${records.length} added`);
    if (reassigned) parts.push(`${reassigned} moved to ${collectionName}`);
    if (skipped) parts.push(`${skipped} duplicate${skipped === 1 ? "" : "s"} skipped`);
    setModelStatus(parts.join(" · "), "success");
  } catch (error) {
    console.warn("Could not add artwork", error);
    errorElement.textContent = error.message || "couldn’t prepare those images";
    errorElement.hidden = false; uploadDialog.dataset.saving = "false";
  }
});

function saveState() {
  const frames = state.frames.map(frame => ({
    ...frame,
    axes: frame.axes.map(({ runToken, ...axis }) => axis)
  }));
  const viewport = { zoom: state.zoom, panX: state.panX, panY: state.panY };
  localStorage.setItem("art-axes-state", JSON.stringify({ version: STORAGE_VERSION, frames, activeFrameId: state.activeFrameId, filter: state.filter, viewport }));
}
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem("art-axes-state")); if (![7, 8, 9, 10, 11, STORAGE_VERSION].includes(saved?.version)) return;
    if (saved.filter) {
      let migratedKinds = Array.isArray(saved.filter.kinds) ? saved.filter.kinds : saved.filter.kind && saved.filter.kind !== "all" ? [saved.filter.kind] : [];
      if (migratedKinds.includes("custom")) {
        const collectionKinds = [...new Set(works.filter(work => work.custom).map(work => collectionToken(work.collectionName)))];
        migratedKinds = [...new Set(migratedKinds.flatMap(kind => kind === "custom" ? collectionKinds : [kind]))];
      }
      const validKinds = new Set(["painting", "paper", "sculpture", "object", "textile", "photography", ...works.filter(work => work.custom).map(work => collectionToken(work.collectionName))]);
      migratedKinds = migratedKinds.filter(kind => validKinds.has(kind));
      state.filter = { kinds: migratedKinds, era: saved.filter.era || "all", query: saved.filter.query || "" };
    }
    if (Array.isArray(saved.frames)) {
      const validIds = new Set(works.map(work => work.id));
      state.frames = saved.frames.map((frame, frameIndex) => {
        const restoredIds = (frame.axes || []).flatMap(axis => axis.scopeIds || []);
        const memberIds = [...new Set(restoredIds.filter(id => validIds.has(id)))];
        const memberSet = new Set(memberIds);
        const axes = (frame.axes || []).map((axis, index) => {
          const scopeIds = (axis.scopeIds || []).filter(id => memberSet.has(id));
          return { ...axis, color: palette[index % palette.length], scopeIds, scopeMode: "selection", scopeLabel: axis.scopeLabel || "saved selection", rawModelScores: axis.rawModelScores || {}, modelScores: normalizeScores(axis.rawModelScores || {}, scopeIds) };
        });
        const restoredFrame = { id: frame.id || `frame-restored-${frameIndex}`, name: frame.name || `frame ${frameIndex + 1}`, mode: frame.mode === "magnets" || (!frame.mode && saved.mode === "magnets") ? "magnets" : "axes", memberIds, axes, layout: frame.layout };
        ensureFrameLayout(restoredFrame, frameIndex); return restoredFrame;
      });
      state.activeFrameId = state.frames.some(frame => frame.id === saved.activeFrameId) ? saved.activeFrameId : state.frames[0]?.id || null;
      const legacyViewport = saved.frames.find(frame => frame.id === state.activeFrameId)?.viewport;
      const viewport = saved.viewport || legacyViewport;
      if (viewport) { state.zoom = viewport.zoom || 1; state.panX = viewport.panX || 0; state.panY = viewport.panY || 0; }
    }
  } catch (error) { console.warn("Could not restore the previous canvas", error); }
}

function registerWebMCP() {
  const context = document.modelContext; if (!context?.registerTool) return;
  const rerender = () => { saveState(); render(); return { frame: activeFrame()?.name, axisCount: activeAxes().length, visibleWorks: visibleWorks().length, collectionSize: works.length }; };
  try {
    context.registerTool({ name: "filter_art_collection", title: "Filter art collection", description: "Choose one or more artwork groups for the next semantic axis. User collections use values beginning with collection:.", inputSchema: { type: "object", properties: { kinds: { type: "array", items: { type: "string" }, uniqueItems: true }, era: { type: "string", enum: ["all", "ancient", "pre1800", "1800s", "modern"] }, query: { type: "string" } }, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(input) { state.filter = { ...state.filter, ...input }; return rerender(); } });
    context.registerTool({ name: "create_art_frame", title: "Create art frame", description: "Create and activate a new empty interpretive frame on the shared board.", inputSchema: { type: "object", properties: { name: { type: "string", minLength: 1 } }, required: ["name"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute({ name }) { const frame = createFrame(name.trim()); state.frames.push(frame); state.activeFrameId = frame.id; return rerender(); } });
    context.registerTool({ name: "add_semantic_axis", title: "Add semantic axis", description: "Add a labeled semantic dimension using the current collection selection. New artworks join the active frame without duplicates.", inputSchema: { type: "object", properties: { startLabel: { type: "string", minLength: 1 }, endLabel: { type: "string", minLength: 1 } }, required: ["startLabel", "endLabel"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, async execute({ startLabel, endLabel }) {
      const frame = activeFrame(), scoped = filteredWorks(), index = frame.axes.length;
      if (!scoped.length) throw new Error("No artworks match the current filter");
      const scopeIds = scoped.map(work => work.id); frame.memberIds = [...new Set([...frame.memberIds, ...scopeIds])];
      const axis = { id: `axis-tool-${Date.now()}`, a: { x: .2 + (index % 3) * .06, y: .22 }, b: { x: .8 - (index % 3) * .04, y: .78 }, low: startLabel.trim(), high: endLabel.trim(), color: palette[index % palette.length], scopeMode: "selection", scopeLabel: "saved selection", scopeIds, rawModelScores: {}, modelScores: {}, scoreSource: "loading" };
      frame.axes.push(axis); rerender(); await scoreAxisWithClip(axis); return rerender();
    } });
  } catch (error) { console.warn("Structured browser tools unavailable", error); }
}

async function initialize() {
  try { works = [...museumWorks, ...await readCustomArtworks()]; }
  catch (error) { console.warn("Could not restore personal artworks", error); works = [...museumWorks]; }
  loadState();
  if (!state.frames.length) {
    const frame = createFrame("frame 1"); state.frames = [frame]; state.activeFrameId = frame.id;
  }
  render();
  if (state.panX === 0 && state.panY === 0) focusFrame(state.activeFrameId); else applyViewport();
  saveState(); registerWebMCP();
  new ResizeObserver(render).observe(canvas);
}

initialize();
