const test=require('node:test'),assert=require('node:assert/strict'),M=require('../dist/movie-layout.js');
const points=[{x:0,y:0},{x:1,y:0},{x:0,y:2},{x:2,y:3}];
const distances=points.map(a=>points.map(b=>Math.hypot(a.x-b.x,a.y-b.y)));
test('MDS recovers known planar distances deterministically with descending stress',()=>{
 const a=M.metricMDS(distances),b=M.metricMDS(distances);
 assert.ok(M.evaluateLayout(a.points,distances).normalizedStress<1e-7);assert.deepEqual(a.points,b.points);
 a.history.forEach((v,i)=>{if(i)assert.ok(v<=a.history[i-1]+1e-10)});
});
test('personal constraints pull toward anchors and personal-only reaches them',()=>{
 const initial=M.metricMDS(distances).points,anchors=points.map(p=>({...p,x:p.x+10,weight:1}));
 const a=M.metricMDS(distances,{initial,anchors});
 assert.ok(a.points.reduce((s,p,i)=>s+Math.hypot(p.x-anchors[i].x,p.y-anchors[i].y),0)<1e-4);
 assert.deepEqual(M.metricMDS(distances,{initial,anchors,pairWeight:0}).points,anchors.map(({x,y})=>({x,y})));
});
test('poster collision offsets leave semantic points intact',()=>{
 const input=[{x:0,y:0},{x:0,y:0},{x:0,y:0}],snapshot=JSON.stringify(input),p=M.displayOffsets(input);
 assert.equal(JSON.stringify(input),snapshot);
 for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++)assert.ok(Math.abs(p[i].x-p[j].x)>=87.99||Math.abs(p[i].y-p[j].y)>=159.99);
});
test('relative source weights preserve geometry and empty sources remain finite',()=>{
 const scores=distances.map(row=>row.map(d=>Math.max(0,1-d*d/32)));
 const args={metadata:scores,synopsis:scores,targets:points.map(()=>null)};
 const a=M.layoutMovies({...args,weights:{personal:0,metadata:1,synopsis:2}}),b=M.layoutMovies({...args,weights:{personal:0,metadata:10,synopsis:20}});
 a.semanticPoints.forEach((p,i)=>assert.ok(Math.hypot(p.x-b.semanticPoints[i].x,p.y-b.semanticPoints[i].y)<1e-10));
 assert.ok(M.layoutMovies({...args,weights:{personal:0,metadata:0,synopsis:0}}).positions.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});
test('semantic geometry is independent of viewport aspect ratio',()=>{
 const scores=distances.map(row=>row.map(d=>Math.max(0,1-d*d/32)));
 const args={metadata:scores,synopsis:scores,targets:points.map(()=>null),weights:{personal:0,metadata:0,synopsis:100}};
 const a=M.layoutMovies({...args,width:720,height:650}),b=M.layoutMovies({...args,width:1500,height:900});
 assert.deepEqual(a.semanticPoints,b.semanticPoints);
 assert.ok(Math.abs(M.evaluateLayout(a.anchorPixels,a.distances).normalizedStress-M.evaluateLayout(b.anchorPixels,b.distances).normalizedStress)<1e-10);
});
