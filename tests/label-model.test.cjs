const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLabelEmbedder, validateLabels } = require('../scripts/label-embeddings.cjs');
test('label service validates requests before inference', () => {
  for (const invalid of [null, [], [1], [''], ['a'.repeat(101)]]) assert.throws(() => validateLabels(invalid));
  assert.deepEqual(validateLabels(['nature', 'nature', 'children']), ['nature', 'children']);
});
test('bundled local model embeds uncached labels without remote downloads', async () => {
  const embed = createLabelEmbedder(path.join(__dirname, '../dist/models'));
  const result = await embed(['childhood', 'growing up', 'war', 'nature', 'whimsical worlds', 'fantastical', 'umbrella', 'umbrellas']);
  assert.equal(result.runtime, 'local server');
  assert.equal(result.vectors.length, 8);
  result.vectors.forEach(vector => {
    assert.equal(vector.length, 384);
    assert(vector.every(Number.isFinite));
    const norm = Math.sqrt(vector.reduce((s, value) => s + value * value, 0));
    assert(Math.abs(norm - 1) < .001);
  });
  const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
  assert(dot(result.vectors[0], result.vectors[1]) > dot(result.vectors[0], result.vectors[2]));
  const { buildThemes } = require('../dist/personal-similarity.js');
  const themes = buildThemes(result.labels.slice(4), new Map(result.labels.map((label, i) => [label, result.vectors[i]])), [], .6, [['whimsical worlds', 'fantastical']]);
  assert.equal(themes.length, 2);
  assert.deepEqual(themes.find(theme => theme.labels.includes('fantastical')).labels, ['fantastical', 'whimsical worlds']);
  assert.equal(themes.find(theme => theme.labels.includes('umbrella')).id, 'umbrella');
  const cached = await embed(['nature']);
  assert.deepEqual(cached.vectors[0], result.vectors[3]);
});
