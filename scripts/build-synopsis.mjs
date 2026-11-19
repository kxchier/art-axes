// Optional offline build step: npm install --no-save @huggingface/transformers@3.8.1
// The running prototype uses the resulting matrix and does not download a model.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = {};
vm.runInNewContext((await fs.readFile(path.join(root, 'dist/films.js'), 'utf8')) + '\nthis.films = films;', context);
const { pipeline } = await import('@huggingface/transformers');
const model = 'Xenova/all-MiniLM-L6-v2';
const extractor = await pipeline('feature-extraction', model, { dtype: 'q8' });
const inputs = context.films.map(film => film.synopsis);
const output = await extractor(inputs, { pooling: 'mean', normalize: true });
const vectors = output.tolist();
const scores = vectors.map(a => vectors.map(b => Math.max(0, Math.min(1, a.reduce((sum, value, i) => sum + value * b[i], 0)))));
await fs.writeFile(path.join(root, 'dist/synopsis-scores.js'), 'const synopsisData = ' + JSON.stringify({
  model, method: 'mean pooling, L2 normalization, cosine similarity clamped to [0, 1]', inputs, scores
}, null, 2) + ';\n');
console.log('Built synopsis similarities for ten films.');
