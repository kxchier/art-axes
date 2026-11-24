const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const U=require('../dist/umap-layout.js');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync('dist/films.js','utf8')+'\n'+fs.readFileSync('dist/media-scores.js','utf8')+'\nglobalThis.bundle={films,mediaData};',context);
const {films,mediaData}=context.bundle;
test('bundled media scores match the exact films and poster files',()=>{
 assert.equal(mediaData.filmTitles.length,films.length);
 films.forEach((film,i)=>{
  assert.equal(mediaData.filmTitles[i],film.title);
  assert.equal(mediaData.posterHashes[i],crypto.createHash('sha256').update(fs.readFileSync('dist/'+film.poster)).digest('hex'));
 });
 for(const source of Object.values(mediaData.sources)){
  const scores=source.scores;
  assert.equal(scores.length,films.length);
  scores.forEach((row,i)=>{
   assert.equal(row.length,films.length); assert.equal(row[i],1);
   row.forEach((score,j)=>{assert.ok(Number.isFinite(score)&&score>=0&&score<=1); assert.ok(Math.abs(score-scores[j][i])<1e-12);});
  });
  assert.ok(Math.max(...scores[0].slice(1))-Math.min(...scores[0].slice(1))>.01);
 }
});
test('every new slider independently controls UMAP distances and the layout',()=>{
 const matrices=Object.fromEntries(Object.entries(mediaData.sources).map(([key,v])=>[key,v.scores]));
 const projections=[];
 for(const key of ['title','visual','clip']){
  const weights={personal:0,metadata:0,synopsis:0,title:0,visual:0,clip:0,[key]:100};
  const result=U.layoutMovies({metadata:matrices.title,synopsis:matrices.title,scoreMatrices:matrices,weights,targets:films.map(()=>null)});
  assert.ok(Math.abs(result.distances[0][1]-Math.sqrt(2*(1-matrices[key][0][1])))<1e-10);
  assert.ok(result.positions.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
  projections.push(result.projection);
 }
 assert.notDeepEqual(projections[0],projections[1]); assert.notDeepEqual(projections[1],projections[2]);
});
test('mixing modalities uses relative weights and ignores disabled sources',()=>{
 const matrices=Object.fromEntries(Object.entries(mediaData.sources).map(([key,v])=>[key,v.scores]));
 const a=U.combineSources(matrices,{title:20,visual:0,clip:80},10);
 const b=U.combineSources(matrices,{title:2,visual:0,clip:8},10);
 assert.deepEqual(a.distances,b.distances);
 const expected=.2*Math.sqrt(2*(1-matrices.title[0][1]))+.8*Math.sqrt(2*(1-matrices.clip[0][1]));
 assert.ok(Math.abs(a.distances[0][1]-expected)<1e-10);
 assert.equal(U.combineSources(matrices,{title:0,visual:0,clip:0},10).total,0);
});
