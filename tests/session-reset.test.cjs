const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const app = fs.readFileSync('dist/app.js','utf8');
const bootstrap = app.slice(0, app.indexOf('let session = storage.active'));
function boot(entries) {
  const data = new Map(entries);
  const context = vm.createContext({
    films: Array.from({length:10},()=>({})),
    UmapLayout: require('../dist/umap-layout.js'),
    localStorage: { getItem:key=>data.get(key) ?? null, removeItem:key=>data.delete(key) }
  });
  vm.runInContext(bootstrap+'\nglobalThis.restored=storage;',context);
  return {data, restored:JSON.parse(JSON.stringify(context.restored))};
}
test('old participant maps reset instead of mixing pairwise and group evidence', () => {
  const old = {active:'participant:kate',sessions:{
    'participant:kate':{name:'kate',answers:{'0-1':{label:'old pair'}},magnets:[{id:'old',label:'old theme',ratings:Array(10).fill(70)}]},
    'participant:eli':{name:'eli',answers:{}}
  }};
  const {data,restored} = boot([['art-axes-film-sessions-v2',JSON.stringify(old)]]);
  assert.equal(data.has('art-axes-film-sessions-v2'),false);
  assert.deepEqual(restored,{active:'',sessions:{}});
});
test('fresh group sessions survive reloads and never restore pairwise answers', () => {
  const fresh = {active:'participant:kate',sessions:{'participant:kate':{
    name:'kate',view:'map',answers:{'0-1':{label:'must not enter map'}},
    magnets:[{id:'group-3-0',label:'fluffy',ratings:[25,50,75,100,0,0,0,0,0,0],groupMembers:[0,1,2,3],rankOrder:[0,1,2,3]}],
    weights:{personal:60,metadata:15,synopsis:25,title:30,visual:40,clip:50},
    groupCursor:1,umap:{nNeighbors:5,minDist:.3,seed:43}
  }}};
  const {restored} = boot([['art-axes-film-sessions-v3',JSON.stringify(fresh)]]);
  const session = restored.sessions['participant:kate'];
  assert.equal(restored.active,'participant:kate');
  assert.equal(session.view,'map');
  assert.deepEqual(session.answers,{});
  assert.deepEqual(session.magnets,fresh.sessions['participant:kate'].magnets);
  assert.equal(session.groupCursor,1);
  assert.equal(session.umap.nNeighbors,5);
  assert.equal(session.weights.title,30);
  assert.equal(session.weights.visual,40);
  assert.equal(session.weights.clip,50);
});
