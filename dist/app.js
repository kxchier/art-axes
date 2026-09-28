let works = Array.isArray(window.ARTWORKS) ? [...window.ARTWORKS] : [];
const museumWorks = [...works];
const palette = ["#91a7ff", "#ff9fc8", "#83d8bd", "#c5a3ff", "#ffbd86"];
const CLIP_MODEL = "Xenova/clip-vit-base-patch32";
const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";
const ZIP_FALLBACK_CDN = "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm";
const STORAGE_VERSION = 6;
const kindLabels = { all: "all works", painting: "paintings", paper: "works on paper", sculpture: "sculpture", object: "objects", textile: "textiles", photography: "photography", custom: "personal collection" };

const state = {
  axes: [], filter: { kinds: [], era: "all", query: "" },
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
const uploadButton = document.querySelector("#uploadButton");
const uploadDialog = document.querySelector("#uploadDialog");
const uploadForm = document.querySelector("#uploadForm");
const artFileInput = document.querySelector("#artFile");
const artFolderInput = document.querySelector("#artFolder");
const uploadDropzone = document.querySelector("#uploadDropzone");
let clipClassifierPromise = null;
let zipInflaterPromise = null;
let statusTimer = null;
let selectedUploadItems = [];
let uploadPreviewUrl = null;

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
  const visibleIds = new Set(visible.map(work => String(work.id))), existing = new Map([...artLayer.children].map(element => [element.dataset.id, element]));
  works.forEach(work => {
    const workId = String(work.id);
    let node = existing.get(workId);
    if (!node) {
      node = document.createElement("button"); node.className = "art-node"; node.dataset.id = workId; node.type = "button"; node.setAttribute("aria-label", `${work.title} by ${work.artist}`);
      const image = document.createElement("img"); image.src = imageUrl(work); image.alt = ""; image.loading = "lazy"; image.draggable = false; node.append(image);
      node.addEventListener("click", () => openDetail(work)); artLayer.append(node);
    }
    node.hidden = !visibleIds.has(workId);
    if (visibleIds.has(workId)) { const point = positions.get(work.id); node.style.left = `${point.x}px`; node.style.top = `${point.y}px`; }
  });
  existing.forEach((node, id) => { if (!works.some(work => String(work.id) === id)) node.remove(); });
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
  document.querySelector("#filterSummary").textContent = `${filtered.length} available for the next axis`;
}
function render() { const rect = canvas.getBoundingClientRect(); renderAxes(rect.width, rect.height); renderArt(rect.width, rect.height); renderSidebar(); renderFilters(); }

function openDetail(work) {
  const scores = state.axes.filter(axis => axisIncludes(axis, work) && axisScore(work, axis) !== null).map(axis => ({ axis, score: axisScore(work, axis) }));
  const provenance = work.custom ? escapeHtml(work.collectionName || "your art") : `Art Institute of Chicago · ${work.id}`;
  const action = work.custom ? `<button class="remove-art-button" type="button" data-remove-art>remove from collection</button>` : `<a class="source-link" href="${work.source}" target="_blank" rel="noreferrer">view museum record ↗</a>`;
  const typeMetadata = work.custom ? "" : `<div><dt>type</dt><dd>${escapeHtml(kindLabels[work.kind])}</dd></div>`;
  document.querySelector("#detailContent").innerHTML = `<img class="detail-image" src="${imageUrl(work)}" alt="${escapeHtml(work.title)} by ${escapeHtml(work.artist)}" /><div class="detail-body"><span class="eyebrow">${provenance}</span><h2>${escapeHtml(work.title)}</h2><p class="artist">${escapeHtml(work.artist)}</p><dl class="metadata"><div><dt>date</dt><dd>${escapeHtml(work.date)}</dd></div><div><dt>origin</dt><dd>${escapeHtml(work.origin)}</dd></div><div><dt>medium</dt><dd>${escapeHtml(work.medium)}</dd></div>${typeMetadata}</dl>${scores.length ? `<span class="eyebrow">current reading</span><div class="score-list">${scores.map(({ axis, score }) => `<div class="score-row"><span>${escapeHtml(axis.low)} ↔ ${escapeHtml(axis.high)}</span><span class="score-track" style="--axis-color:${axis.color};--score:${(score + 1) * 50}%"><i></i></span></div>`).join("")}</div>` : ""}${action}</div>`;
  document.querySelector("[data-remove-art]")?.addEventListener("click", () => removeArtwork(work));
  detailPanel.classList.add("open"); detailPanel.setAttribute("aria-hidden", "false"); backdrop.hidden = false;
}
async function removeArtwork(work) {
  if (!window.confirm(`remove “${work.title}” from your collection?`)) return;
  try {
    await deleteCustomArtwork(work.id);
    URL.revokeObjectURL(work.imageUrl);
    works = works.filter(item => item !== work);
    state.axes.forEach(axis => {
      axis.scopeIds = axis.scopeIds.filter(id => id !== work.id);
      delete axis.rawModelScores?.[work.id]; delete axis.modelScores?.[work.id];
      axis.modelScores = normalizeScores(axis.rawModelScores, axis.scopeIds);
    });
    closeDetail(); saveState(); render(); setModelStatus("artwork removed", "success");
  } catch (error) { console.warn("Could not remove artwork", error); setModelStatus("couldn’t remove that artwork", "error"); }
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
  const axis = { ...state.pendingAxis, id: `axis-${Date.now()}`, low, high, color: palette[state.axes.length % palette.length], scopeMode: "current", scopeLabel: "this filter", scopeFilter: structuredClone(state.filter), scopeIds: scoped.map(work => work.id), rawModelScores: {}, modelScores: {}, scoreSource: "loading" };
  state.axes.push(axis); state.pendingAxis = null; axisDialog.close(); saveState(); render(); scoreAxisWithClip(axis);
});

drawButton.addEventListener("click", () => setDrawing(!state.drawing));
document.querySelector("#zoomOutButton").addEventListener("click", () => setZoom(state.zoom / 1.25)); document.querySelector("#zoomInButton").addEventListener("click", () => setZoom(state.zoom * 1.25)); zoomLevel.addEventListener("click", resetViewport);
document.querySelector("#resetButton").addEventListener("click", () => { state.axes = []; state.filter = { kinds: [], era: "all", query: "" }; resetViewport(); saveState(); render(); });
document.querySelector("#closeDetail").addEventListener("click", closeDetail); backdrop.addEventListener("click", closeDetail);

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
  const axes = state.axes.map(({ runToken, ...axis }) => axis);
  localStorage.setItem("art-axes-state", JSON.stringify({ version: STORAGE_VERSION, axes, filter: state.filter }));
}
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem("art-axes-state")); if (saved?.version !== STORAGE_VERSION) return;
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
    context.registerTool({ name: "filter_art_collection", title: "Filter art collection", description: "Choose one or more artwork groups that the next semantic axis will place. User collections use values beginning with collection:.", inputSchema: { type: "object", properties: { kinds: { type: "array", items: { type: "string" }, uniqueItems: true }, era: { type: "string", enum: ["all", "ancient", "pre1800", "1800s", "modern"] }, query: { type: "string" } }, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(input) { state.filter = { ...state.filter, ...input }; return rerender(); } });
    context.registerTool({ name: "add_semantic_axis", title: "Add semantic axis", description: "Add a labeled semantic dimension scoped to the current artwork filter.", inputSchema: { type: "object", properties: { startLabel: { type: "string", minLength: 1 }, endLabel: { type: "string", minLength: 1 } }, required: ["startLabel", "endLabel"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, async execute({ startLabel, endLabel }) {
      const scoped = filteredWorks(), index = state.axes.length;
      const axis = { id: `axis-tool-${Date.now()}`, a: { x: .2 + (index % 3) * .06, y: .22 }, b: { x: .8 - (index % 3) * .04, y: .78 }, low: startLabel.trim(), high: endLabel.trim(), color: palette[index % palette.length], scopeMode: "current", scopeLabel: "saved filter", scopeFilter: structuredClone(state.filter), scopeIds: scoped.map(work => work.id), rawModelScores: {}, modelScores: {}, scoreSource: "loading" };
      state.axes.push(axis); rerender(); await scoreAxisWithClip(axis); return rerender();
    } });
  } catch (error) { console.warn("Structured browser tools unavailable", error); }
}

async function initialize() {
  try { await clearArtworkDatabase(); }
  catch (error) { console.warn("Could not clear the previous artwork session", error); }
  localStorage.removeItem("art-axes-state");
  works = [...museumWorks];
  saveState(); render(); applyViewport(); registerWebMCP();
  new ResizeObserver(render).observe(canvas);
}

initialize();
