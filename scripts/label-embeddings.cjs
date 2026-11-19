const path = require('node:path');

function validateLabels(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 450 ||
      value.some(label => typeof label !== 'string' || !label.trim() || label.length > 100)) {
    throw new Error('Expected between 1 and 450 nonempty labels, each at most 100 characters.');
  }
  return [...new Set(value)];
}
function createLabelEmbedder(modelDirectory) {
  let extractorPromise;
  let queue = Promise.resolve();
  const cache = new Map();
  async function extractor() {
    if (!extractorPromise) {
      extractorPromise = (async () => {
        const { pipeline, env } = await import('@huggingface/transformers');
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        env.localModelPath = path.resolve(modelDirectory) + path.sep;
        return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
      })().catch(error => { extractorPromise = null; throw error; });
    }
    return extractorPromise;
  }
  return function embed(input) {
    const labels = validateLabels(input);
    const result = queue.then(async () => {
      const missing = labels.filter(label => !cache.has(label));
      if (missing.length) {
        const model = await extractor();
        const output = await model(missing, { pooling: 'mean', normalize: true });
        output.tolist().forEach((vector, i) => cache.set(missing[i], vector));
      }
      return { labels, vectors: labels.map(label => cache.get(label)), runtime: 'local server' };
    });
    queue = result.catch(() => {});
    return result;
  };
}
module.exports = { createLabelEmbedder, validateLabels };
