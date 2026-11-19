// Coalesce rapid edits into the latest pending request instead of queuing every old label set.
let extractorPromise;
let pending;
let running = false;
const vectors = new Map();
async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      // Dynamic import keeps import/asset failures inside the error reporting path.
      const { pipeline, env } = await import('./vendor/transformers/transformers.min.js');
      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = new URL('./models/', import.meta.url).href;
      env.backends.onnx.wasm.wasmPaths = new URL('./vendor/transformers/', import.meta.url).href;
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
      return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        dtype: 'q8', device: 'wasm',
        progress_callback: progress => {
          if (pending && progress.status === 'progress') self.postMessage({
            id: pending.id, type: 'status',
            message: `loading label model… ${Math.round(progress.progress || 0)}%`
          });
        }
      });
    })().catch(error => { extractorPromise = null; throw error; });
  }
  return extractorPromise;
}
self.onmessage = ({ data }) => { pending = data; processPending(); };
async function processPending() {
  if (running) return;
  running = true;
  while (pending) {
    const request = pending;
    const { id, labels } = request;
    try {
      self.postMessage({ id, type: 'status', message: 'loading the label model in your browser…' });
      const extractor = await getExtractor();
      self.postMessage({ id, type: 'status', message: 'comparing the meaning of your labels…' });
      const missing = labels.filter(label => !vectors.has(label));
      if (missing.length) {
        const output = await extractor(missing, { pooling: 'mean', normalize: true });
        output.tolist().forEach((vector, i) => vectors.set(missing[i], vector));
      }
      self.postMessage({ id, type: 'result', labels, vectors: labels.map(label => vectors.get(label)) });
    } catch (error) {
      self.postMessage({ id, type: 'error', message: error.message || String(error) || 'The browser label model could not load.' });
    }
    if (pending === request) pending = null;
  }
  running = false;
}
