const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { candidateGroups } = require('../dist/grouping.js');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('dist/synopsis-scores.js', 'utf8') + '\nglobalThis.scores = synopsisData.scores;', context);
test('candidate groups cover each film once, stay small, and are deterministic', () => {
  for (const count of [3, 5]) {
    const groups = candidateGroups(context.scores, count);
    assert.equal(groups.length, count);
    assert.deepEqual([...groups.flat()].sort((a,b) => a-b), Array.from({length:10},(_,i)=>i));
    assert.ok(groups.every(g => g.length <= Math.ceil(10/count)));
    assert.deepEqual(groups, candidateGroups(context.scores, count));
  }
});
test('film ratings weight magnet targets and absolute personal strength', () => {
  vm.runInContext(fs.readFileSync('dist/grouping.js', 'utf8'), context);
  const rated = context.ratedMagnetTarget;
  const magnets = new Map([['soft', {x:0, y:0}], ['dark', {x:1, y:1}]]);
  const target = rated(new Map([['soft', [{magnet:'a', rating:75}]], ['dark', [{magnet:'b',rating:25}]]]), magnets, new Map());
  assert.equal(target.x, .25);
  assert.equal(target.y, .25);
  assert.equal(target.strength, .75);
  assert.equal(rated(new Map(), magnets, new Map()), null);
  assert.equal(rated(new Map([['soft', [{magnet:'a',rating:10}]]]), magnets, new Map()).strength, .1);
});
test('group ranking seeds increasing strengths without changing other films', () => {
  const { ratingsFromRanking } = require('../dist/grouping.js');
  const before = [0, 70, 70, 0, 70, 70, 0, 0, 0, 0];
  const result = ratingsFromRanking(before, [5, 2, 1, 4]);
  assert.deepEqual([5,2,1,4].map(i => result[i]), [25,50,75,100]);
  assert.equal(result[0], 0);
  assert.deepEqual(before, [0,70,70,0,70,70,0,0,0,0]);
  assert.deepEqual(ratingsFromRanking([90,12,0], [2,0]), [100,12,25]);
});
