const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const U = require('../dist/umap-layout.js');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync('dist/synopsis-scores.js','utf8')+'\nglobalThis.scores=synopsisData.scores;',ctx);
const scores = ctx.scores;
const args = { metadata:scores, synopsis:scores, weights:{personal:0,metadata:0,synopsis:100}, targets:scores.map(()=>null) };
test('UMAP is finite and repeatable, with dataset-safe settings', () => {
  assert.deepEqual(U.settings({nNeighbors:100,minDist:2}),{nNeighbors:9,minDist:.99,seed:42});
  assert.deepEqual(U.settings({nNeighbors:-3,minDist:-1}),{nNeighbors:2,minDist:0,seed:42});
  const a=U.layoutMovies(args), b=U.layoutMovies(args);
  assert.deepEqual(a.projection,b.projection);
  assert.ok(a.positions.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});
test('neighborhood, packing and seed controls each change the projection', () => {
  const a=U.layoutMovies(args).projection;
  for(const umap of [{nNeighbors:8},{minDist:.8},{seed:43}]) assert.notDeepEqual(a,U.layoutMovies({...args,umap}).projection);
});
test('UMAP uses relative source weights and keeps projection independent of viewport', () => {
  const a=U.layoutMovies({...args,width:700,height:600});
  const b=U.layoutMovies({...args,width:1400,height:900,weights:{personal:0,metadata:0,synopsis:10}});
  assert.deepEqual(a.projection,b.projection);
});
test('personal ratings blend from UMAP to magnets; personal-only reaches target', () => {
  const target={x:.1,y:.2,strength:1};
  const weak=U.layoutMovies({...args,weights:{personal:60,metadata:0,synopsis:40},targets:scores.map(()=>({...target,strength:.1}))});
  const strong=U.layoutMovies({...args,weights:{personal:60,metadata:0,synopsis:40},targets:scores.map(()=>target)});
  const distance=p=>Math.hypot(p.x-.1*1180,p.y-.2*793);
  assert.ok(distance(strong.anchorPixels[0]) < distance(weak.anchorPixels[0]));
  const personal=U.layoutMovies({...args,weights:{personal:100,metadata:0,synopsis:0},targets:scores.map(()=>target)});
  assert.ok(personal.anchors.every(p=>Math.abs(p.x-10)<1e-9 && Math.abs(p.y-20)<1e-9));
  const empty=U.layoutMovies({...args,weights:{personal:0,metadata:0,synopsis:0}});
  assert.ok(empty.positions.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});
test('identical inputs remain finite at control extremes', () => {
 const same=scores.map(()=>scores.map(()=>1));
 for(const nNeighbors of [2,9]) for(const minDist of [0,.99]) assert.ok(U.layoutMovies({...args,synopsis:same,umap:{nNeighbors,minDist}}).positions.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});
test('alignment removes arbitrary rotations and reflections without changing shape',()=>{
 const reference=[{x:-2,y:1},{x:1,y:3},{x:3,y:-2},{x:-1,y:-2}];
 const transformed=reference.map(p=>({x:10-p.y*4,y:20-p.x*4}));
 const aligned=U.alignProjection(transformed,reference),identity=U.alignProjection(reference,reference);
 aligned.forEach((p,i)=>assert.ok(Math.hypot(p.x-identity[i].x,p.y-identity[i].y)<1e-10));
});
test('source sliders blend continuously in a fixed coordinate frame',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),context={};
 vm.runInNewContext(fs.readFileSync('dist/media-scores.js','utf8')+'\nthis.media=mediaData.sources;',context);
 const scoreMatrices=Object.fromEntries(Object.entries(context.media).map(([key,v])=>[key,v.scores]));
 const layout=value=>U.layoutMovies({...args,scoreMatrices,weights:{personal:0,metadata:0,synopsis:100-value,title:value,visual:0,clip:0}});
 const a=layout(20),b=layout(40),c=layout(60);
 b.anchorPixels.forEach((p,i)=>assert.ok(Math.hypot(p.x-(a.anchorPixels[i].x+c.anchorPixels[i].x)/2,p.y-(a.anchorPixels[i].y+c.anchorPixels[i].y)/2)<1e-8));
 // Returning a slider to a prior setting restores the same map, regardless of path.
 assert.deepEqual(layout(20),a);
 for(const key of ['title','visual','clip']) {
  let previous;
  for(let value=0;value<=100;value++) {
   const r=U.layoutMovies({...args,scoreMatrices,weights:{personal:0,metadata:15,synopsis:25,title:0,visual:0,clip:0,[key]:value}});
   if(previous)r.anchorPixels.forEach((p,i)=>assert.ok(Math.hypot(p.x-previous[i].x,p.y-previous[i].y)<20,`${key} jumped at ${value}`));
   previous=r.anchorPixels;
  }
 }
});
test('poster separation resolves overlaps without pinning unrelated films to an old order',()=>{
 const separated=[{x:0,y:0},{x:200,y:0},{x:0,y:300},{x:200,y:300}];
 const reversed=separated.slice().reverse();
 assert.deepEqual(U.separatePosters(separated,78,150),separated);
 assert.deepEqual(U.separatePosters(reversed,78,150),reversed);
 const a=U.separatePosters(Array.from({length:4},()=>({x:100,y:100})),78,150);
 for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)assert.ok(Math.abs(a[i].x-a[j].x)>=88-1e-4 || Math.abs(a[i].y-a[j].y)>=160-1e-4);
});
test('changing the dominant source visibly rearranges displayed posters',()=>{
 const context={};
 vm.runInNewContext(fs.readFileSync('dist/media-scores.js','utf8')+'\nthis.media=mediaData.sources;',context);
 const scoreMatrices=Object.fromEntries(Object.entries(context.media).map(([key,v])=>[key,v.scores]));
 const base=U.layoutMovies({...args,scoreMatrices});
 for(const key of ['title','visual','clip']) {
   const different=U.layoutMovies({...args,scoreMatrices,weights:{personal:0,metadata:0,synopsis:0,[key]:100}});
   const movement=different.positions.map((p,i)=>Math.hypot((p.x-base.positions[i].x)*11.8,(p.y-base.positions[i].y)*7.93));
   assert.ok(movement.reduce((a,b)=>a+b,0)/movement.length>100,`${key} should make a visible difference`);
 }
});
