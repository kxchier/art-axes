/* UMAP proposes computational positions; personal magnets then pull those positions.
   Poster collision offsets never change the underlying semantic coordinates. */
(function(root) {
  const UMAPClass = typeof module !== 'undefined' && module.exports ? require('umap-js').UMAP : root.UMAP.UMAP;
  const layout = typeof module !== 'undefined' && module.exports ? require('./movie-layout.js') : root.MovieLayout;
  function settings(value = {}, count = 10) {
    return {
      nNeighbors: Math.max(2, Math.min(count - 1, Math.round(Number(value.nNeighbors) || 4))),
      minDist: Math.max(0, Math.min(.99, Number.isFinite(value.minDist) ? value.minDist : .2)),
      seed: Number.isInteger(value.seed) ? value.seed >>> 0 : 42
    };
  }
  function seededRandom(seed) {
    let state = seed >>> 0;
    return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  }
  const cache = new Map();
  function project(distances, options) {
    const n = distances.length;
    if (n < 3) return Array.from({length:n}, (_, i) => ({x:i, y:0}));
    const config = settings(options, n);
    const key = JSON.stringify([distances, config]);
    if (!cache.has(key)) {
      // Supply exact neighbors from our combined distances, not Euclidean distances
      // between rows of a similarity matrix. Include self as expected by umap-js.
      const neighbors = distances.map((row, i) => row.map((d,j) => ({d,j})).sort((a,b) => a.d-b.d || (a.j === i ? -1 : b.j === i ? 1 : a.j-b.j)).slice(0,config.nNeighbors));
      const umap = new UMAPClass({...config, nComponents:2, nEpochs:400, random:seededRandom(config.seed)});
      umap.setPrecomputedKNN(neighbors.map(row=>row.map(v=>v.j)), neighbors.map(row=>row.map(v=>v.d)));
      const points = umap.fit(distances.map((_,i)=>[i])).map(([x,y])=>({x,y}));
      if (!points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error('UMAP returned invalid positions');
      if (cache.size >= 24) cache.delete(cache.keys().next().value);
      cache.set(key, points);
    }
    return cache.get(key).map(p => ({...p}));
  }
  function normalizeProjection(points) {
    const cx=points.reduce((s,p)=>s+p.x,0)/points.length,cy=points.reduce((s,p)=>s+p.y,0)/points.length;
    const radius=Math.sqrt(points.reduce((s,p)=>s+(p.x-cx)**2+(p.y-cy)**2,0)/points.length)||1;
    return points.map(p=>({x:(p.x-cx)/radius,y:(p.y-cy)/radius}));
  }
  // Remove arbitrary UMAP rotation/reflection without altering neighborhood geometry.
  function alignProjection(points, reference) {
    const input=normalizeProjection(points), target=normalizeProjection(reference);
    let best=null;
    for (const reflection of [1,-1]) {
      let dot=0,cross=0;
      input.forEach((p,i)=>{ const y=p.y*reflection; dot+=p.x*target[i].x+y*target[i].y; cross+=p.x*target[i].y-y*target[i].x; });
      const length=Math.hypot(dot,cross),c=length>1e-12?dot/length:1,s=length>1e-12?cross/length:0;
      const aligned=input.map(p=>({x:c*p.x-s*p.y*reflection,y:s*p.x+c*p.y*reflection}));
      const error=aligned.reduce((sum,p,i)=>sum+(p.x-target[i].x)**2+(p.y-target[i].y)**2,0);
      if (!best || error<best.error) best={points:aligned,error};
    }
    return best.points;
  }
  function blendProjections(matrices, weights, options) {
    const entries=Object.entries(matrices).filter(([,scores])=>Array.isArray(scores));
    const reference=normalizeProjection(project(layout.distancesFromScores(matrices.synopsis || entries[0][1]),options));
    const aligned=entries.map(([key,scores])=>({key,points:alignProjection(project(layout.distancesFromScores(scores),options),reference)}));
    const total=aligned.reduce((sum,{key})=>sum+Math.max(0,weights[key]||0),0);
    const points=reference.map((p,i)=>total ? aligned.reduce((sum,source)=>{
      const fraction=Math.max(0,weights[source.key]||0)/total;
      return {x:sum.x+source.points[i].x*fraction,y:sum.y+source.points[i].y*fraction};
    },{x:0,y:0}) : p);
    // Fixed bounds across weights: moving one slider cannot resize the entire map.
    return {points,frame:aligned.flatMap(source=>source.points)};
  }
  function separatePosters(anchors, width, height) {
    // Resolve actual overlaps only. Fixed ordering constraints across every pair
    // pinned posters to the synopsis layout even when other sources disagreed.
    return layout.displayOffsets(anchors,width,height);
  }
  function combineSources(matrices, weights, count) {
    const enabled = Object.entries(matrices).filter(([key, scores]) => Array.isArray(scores) && Number.isFinite(weights[key]) && weights[key] > 0);
    const total = enabled.reduce((sum,[key])=>sum+weights[key],0);
    const distances = Array.from({length:count},(_,i)=>Array.from({length:count},(_,j)=>{
      if (i === j || !total) return 0;
      const distance = enabled.reduce((sum,[key,scores])=>sum+weights[key]*Math.sqrt(2*(1-Math.max(0,Math.min(1,scores[i][j])))),0)/total;
      return Number(distance.toFixed(12));
    }));
    return {distances, total};
  }
  function layoutMovies({metadata,synopsis,scoreMatrices={},weights,targets,umap,width=1180,height=793,cardWidth=78,cardHeight=150}) {
    const n = synopsis.length;
    const {distances, total:computationalWeight} = combineSources({metadata,synopsis,...scoreMatrices},weights,n);
    const matrices={metadata,synopsis,...scoreMatrices};
    const blended=blendProjections(matrices,weights,umap);
    const points=computationalWeight ? blended.points : Array.from({length:n},(_,i)=>({x:Math.cos(i/n*2*Math.PI),y:Math.sin(i/n*2*Math.PI)}));
    const frame=computationalWeight ? blended.frame : points;
    const xs=frame.map(p=>p.x),ys=frame.map(p=>p.y);
    const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
    const scale=Math.min(Math.max(100,width-160)/Math.max(.1,Math.max(...xs)-Math.min(...xs)),Math.max(100,height-240)/Math.max(.1,Math.max(...ys)-Math.min(...ys)));
    const pixels=points.map((p,i)=>{
      const base={x:(p.x-cx)*scale+width/2,y:(p.y-cy)*scale+height/2};
      const personal=targets[i] ? weights.personal*(targets[i].strength ?? 1) : 0;
      const pull=personal ? personal/(personal+computationalWeight) : 0;
      return {x:base.x*(1-pull)+(targets[i]?.x || 0)*width*pull,y:base.y*(1-pull)+(targets[i]?.y || 0)*height*pull};
    });
    const percent=items=>items.map(p=>({x:p.x/width*100,y:p.y/height*100}));
    return {positions:percent(separatePosters(pixels,cardWidth,cardHeight)),anchors:percent(pixels),projection:points,anchorPixels:pixels,distances};
  }
  const api={settings,project,layoutMovies,combineSources,alignProjection,blendProjections,separatePosters};
  if(typeof module !== 'undefined' && module.exports) module.exports=api; else root.UmapLayout=api;
})(globalThis);
