const test = require('node:test');
const assert = require('node:assert/strict');
const { splitLabels, buildProfiles, compareProfiles } = require('../dist/personal-similarity.js');
// Small vectors isolate aggregation behavior; real MiniLM execution is checked in-browser.
const vectors = new Map([
  ['nature', [1, 0, 0]], ['forest', [.95, .05, 0]], ['water', [.8, .2, 0]],
  ['childhood', [0, 0, 1]], ['growing up', [0, .05, .95]], ['war', [0, 1, 0]]
]);
test('labels split into unique phrases without splitting growing up', () => {
  assert.deepEqual(splitLabels(' Nature, nature; growing   up\nwater '), ['nature', 'growing up', 'water']);
});
test('separate statements connect films through meaning, without a direct pair', () => {
  const profiles = buildProfiles([
    { a: 0, b: 1, label: 'nature, water' },
    { a: 2, b: 3, label: 'forest' },
    { a: 4, b: 5, label: 'war' }
  ], 6);
  assert(compareProfiles(profiles[0], profiles[2], vectors).score > .95);
  assert(compareProfiles(profiles[0], profiles[4], vectors).score < .3);
  assert.equal(profiles[0].get('nature')[0].b, 1);
  assert.equal(profiles[2].get('forest')[0].b, 3);
});
test('synonymous labels compare closely and profile comparison is symmetric', () => {
  const profiles = buildProfiles([
    { a: 0, b: 1, label: 'childhood' }, { a: 2, b: 3, label: 'growing up, war' }
  ], 4);
  const a = compareProfiles(profiles[0], profiles[2], vectors);
  const b = compareProfiles(profiles[2], profiles[0], vectors);
  assert.equal(a.score, b.score);
  assert(a.matches[0].score > .99);
  assert(a.score < .8); // Unmatched themes matter; one common theme is not the whole profile.
});
test('repetition does not amplify a theme, while preserving all origins', () => {
  const base = [{ a: 0, b: 1, label: 'nature' }, { a: 2, b: 3, label: 'forest' }];
  const profiles = buildProfiles(base, 4);
  const repeated = buildProfiles([...base, { a: 0, b: 3, label: 'nature, NATURE' }], 4);
  assert.equal(compareProfiles(profiles[0], profiles[2], vectors).score, compareProfiles(repeated[0], repeated[2], vectors).score);
  assert.equal(repeated[0].get('nature').length, 2);
});
test('missing labels and unavailable embeddings are excluded instead of scoring zero', () => {
  const profiles = buildProfiles([{ a: 0, b: 1, label: 'unseen phrase' }], 3);
  assert.equal(compareProfiles(profiles[0], profiles[2], vectors).reason, 'missing');
  assert.equal(compareProfiles(profiles[0], profiles[1], vectors).reason, 'pending');
  assert.equal(compareProfiles(profiles[0], profiles[1], vectors).score, null);
});
test('revising a statement changes profiles and removes old labels', () => {
  const before = buildProfiles([{ a: 0, b: 1, label: 'war' }, { a: 2, b: 3, label: 'forest' }], 4);
  const after = buildProfiles([{ a: 0, b: 1, label: 'nature' }, { a: 2, b: 3, label: 'forest' }], 4);
  assert(compareProfiles(after[0], after[2], vectors).score > compareProfiles(before[0], before[2], vectors).score);
  assert(!after[0].has('war'));
});

test('semantic magnets put related labels nearer and film targets balance their labels', () => {
  const { layoutMagnets, magnetTarget } = require('../dist/personal-similarity.js');
  const themes = new Map([['nature', [1, 0]], ['children', [.95, .05]], ['war', [0, 1]]]);
  const magnets = layoutMagnets([...themes.keys()], themes);
  const distance = (a, b) => Math.hypot(magnets.get(a).x - magnets.get(b).x, magnets.get(a).y - magnets.get(b).y);
  assert(distance('nature', 'children') < distance('war', 'children'));
  const profiles = buildProfiles([
    { a: 0, b: 1, label: 'nature' }, // Ponyo / Mononoke
    { a: 1, b: 2, label: 'war' }, // Mononoke / Fireflies
    { a: 2, b: 0, label: 'children' } // Fireflies / Ponyo
  ], 3);
  const ponyo = magnetTarget(profiles[0], magnets);
  assert.equal(ponyo.x, (magnets.get('nature').x + magnets.get('children').x) / 2);
  assert.equal(ponyo.y, (magnets.get('nature').y + magnets.get('children').y) / 2);
  const fireflies = magnetTarget(profiles[2], magnets);
  assert.equal(fireflies.x, (magnets.get('war').x + magnets.get('children').x) / 2);
  assert.notDeepEqual(ponyo, fireflies);
  const moved = new Map(magnets); moved.set('war', { x: .9, y: .2 });
  assert.notDeepEqual(magnetTarget(profiles[2], moved), fireflies);
  assert.deepEqual(magnetTarget(profiles[0], moved), ponyo);
});
test('magnet layout is stable, excludes unembedded labels, and handles one label', () => {
  const { layoutMagnets, magnetTarget } = require('../dist/personal-similarity.js');
  assert.deepEqual([...layoutMagnets(['water', 'nature'], vectors)], [...layoutMagnets(['nature', 'water'], vectors)]);
  assert.equal(layoutMagnets(['unknown'], vectors).size, 0);
  assert.deepEqual(layoutMagnets(['nature'], vectors).get('nature'), { x: .5, y: .52 });
  assert.equal(magnetTarget(new Map([['unknown', []]]), layoutMagnets(['nature'], vectors)), null);
});

test('theme grouping handles plurals, avoids semantic chains, and respects separation', () => {
  const { buildThemes } = require('../dist/personal-similarity.js');
  const embedding = new Map([
    ['umbrella', [1,0]], ['umbrellas', [1,0]], ['not umbrella', [1,0]],
    ['a', [1,0]], ['b', [.8,.6]], ['c', [0,1]]
  ]);
  const plurals = buildThemes(['umbrella','umbrellas','not umbrella'], embedding);
  assert.equal(plurals.length, 2);
  assert.deepEqual(plurals.find(t=>t.id==='umbrella').labels, ['umbrella','umbrellas']);
  assert.equal(buildThemes(['umbrella','umbrellas'], embedding, [['umbrella','umbrellas']]).length, 2);
  const chain = buildThemes(['a','b','c'], embedding, [], .55);
  assert.equal(chain.length, 2);
  assert(!chain.some(group=>group.labels.includes('a') && group.labels.includes('c')));
});
test('a combined theme pulls a movie once even when it has multiple label variants', () => {
  const { magnetTarget } = require('../dist/personal-similarity.js');
  const profile = new Map([['umbrella', []], ['umbrellas', []], ['nature', []]]);
  const magnets = new Map([['umbrella', {x:.2,y:.2}], ['nature',{x:.8,y:.8}]]);
  const aliases = new Map([['umbrella','umbrella'],['umbrellas','umbrella'],['nature','nature']]);
  assert.deepEqual(magnetTarget(profile,magnets,aliases), {x:.5,y:.5});
});

test('magnet count changes grouping without discarding labels or source themes', () => {
  const { buildThemes, themesAtCount } = require('../dist/personal-similarity.js');
  const labels = ['nature', 'forest', 'water', 'childhood', 'war'];
  const base = buildThemes(labels, vectors, [], 1);
  assert.equal(base.length, 5);
  const two = themesAtCount(base, 2, vectors);
  assert.equal(two.length, 2);
  assert.deepEqual(two.flatMap(t => t.labels).sort(), labels.slice().sort());
  assert.equal(base.length, 5);
  assert.equal(themesAtCount(base, 1, vectors).length, 1);
  assert.equal(themesAtCount(base, 99, vectors).length, 5);
  two.forEach(theme => assert(Math.abs(Math.hypot(...theme.vector) - 1) < 1e-9));
});

test('related magnets form compact clusters instead of stretching across the canvas', () => {
  const { layoutMagnets } = require('../dist/personal-similarity.js');
  const clustered = new Map([
    ['sky',[1,0,0]],['umbrellas',[.96,.04,0]],
    ['war',[0,1,0]],['destruction',[0,.96,.04]],
    ['nature',[0,0,1]],['forest',[.04,0,.96]]
  ]);
  const positions = layoutMagnets([...clustered.keys()],clustered);
  const d=(a,b)=>Math.hypot(positions.get(a).x-positions.get(b).x, positions.get(a).y-positions.get(b).y);
  assert(d('sky','umbrellas') < d('sky','war') * .5);
  assert(d('war','destruction') < d('war','forest') * .5);
  const pair=layoutMagnets(['sky','umbrellas'],clustered);
  assert(Math.hypot(pair.get('sky').x-pair.get('umbrellas').x,pair.get('sky').y-pair.get('umbrellas').y) < .2);
});
test('shared movie associations strengthen proximity without merging theme identities', () => {
  const { layoutMagnets, membershipOverlap } = require('../dist/personal-similarity.js');
  const embedding=new Map([['sky',[1,0]],['umbrellas',[.3,.95]],['war',[-1,0]]]);
  const memberships=new Map([['sky',new Set([0,1])],['umbrellas',new Set([0,1])],['war',new Set([2,3])]]);
  const distance=p=>Math.hypot(p.get('sky').x-p.get('umbrellas').x,p.get('sky').y-p.get('umbrellas').y);
  assert(distance(layoutMagnets([...embedding.keys()],embedding,memberships)) < distance(layoutMagnets([...embedding.keys()],embedding)));
  assert.equal(membershipOverlap(new Set([0,1]),new Set([0,1])),1);
  assert.equal(membershipOverlap(new Set(),new Set([0])),0);
});
test('tightly clustered label boxes remain individually readable', () => {
  const { layoutMagnets } = require('../dist/personal-similarity.js');
  const sizes = new Map([['nature',{width:.15,height:.06}],['forest',{width:.15,height:.06}]]);
  const p = layoutMagnets(['nature','forest'], vectors, new Map(), sizes);
  assert(Math.abs(p.get('nature').x-p.get('forest').x)>=.15 || Math.abs(p.get('nature').y-p.get('forest').y)>=.06);
});
