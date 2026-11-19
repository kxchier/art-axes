/* Deterministic metric MDS with optional personal-theme constraints.
   Rendering offsets are kept separate from the semantic coordinates. */
(function (root) {
  const copy = points => points.map(p => ({ x: p.x, y: p.y }));
  const squared = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  function distancesFromScores(scores) {
    return scores.map((row, i) => row.map((value, j) => i === j ? 0 : Math.sqrt(2 * (1 - Math.max(0, Math.min(1, value))))));
  }
  function combineDistances(metadata, synopsis, weights) {
    const total = weights.metadata + weights.synopsis;
    const a = distancesFromScores(metadata), b = distancesFromScores(synopsis);
    return a.map((row, i) => row.map((_, j) => total ? (a[i][j] * weights.metadata + b[i][j] * weights.synopsis) / total : 0));
  }
  function center(points) {
    const x = points.reduce((s,p) => s + p.x, 0) / points.length;
    const y = points.reduce((s,p) => s + p.y, 0) / points.length;
    return points.map(p => ({ x: p.x - x, y: p.y - y }));
  }
  function canonicalize(points) {
    const p = center(points);
    let xx = 0, yy = 0, xy = 0;
    p.forEach(v => { xx += v.x*v.x; yy += v.y*v.y; xy += v.x*v.y; });
    const angle = .5 * Math.atan2(2*xy, xx-yy), c = Math.cos(angle), s = Math.sin(angle);
    const rotated = p.map(v => ({x:c*v.x+s*v.y,y:-s*v.x+c*v.y}));
    for (const axis of ['x','y']) {
      const index = rotated.reduce((best,v,i) => Math.abs(v[axis]) > Math.abs(rotated[best][axis]) ? i : best,0);
      if (rotated[index][axis] < 0) rotated.forEach(v => { v[axis] *= -1; });
    }
    return rotated;
  }
  function eigenSymmetric(matrix) {
    const n = matrix.length, a = matrix.map(row => row.slice());
    const vectors = Array.from({length:n}, (_,i) => Array.from({length:n}, (_,j) => +(i===j)));
    for (let iteration=0;iteration<100*n*n;iteration++) {
      let p=0,q=1,largest=0;
      for (let i=0;i<n;i++) for (let j=i+1;j<n;j++) if (Math.abs(a[i][j])>largest) {largest=Math.abs(a[i][j]);p=i;q=j;}
      if (largest<1e-12) break;
      const angle=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]);
      const c=Math.cos(angle),s=Math.sin(angle),app=a[p][p],aqq=a[q][q],apq=a[p][q];
      for (let k=0;k<n;k++) if(k!==p&&k!==q) {
        const akp=a[k][p],akq=a[k][q];
        a[k][p]=a[p][k]=c*akp-s*akq;
        a[k][q]=a[q][k]=s*akp+c*akq;
      }
      a[p][p]=c*c*app-2*s*c*apq+s*s*aqq;
      a[q][q]=s*s*app+2*s*c*apq+c*c*aqq;
      a[p][q]=a[q][p]=0;
      for(let k=0;k<n;k++){const vkp=vectors[k][p],vkq=vectors[k][q];vectors[k][p]=c*vkp-s*vkq;vectors[k][q]=s*vkp+c*vkq;}
    }
    return Array.from({length:n},(_,i)=>({value:a[i][i],vector:vectors.map(row=>row[i])})).sort((a,b)=>b.value-a.value);
  }
  function classicalStart(distances) {
    const n=distances.length, squares=distances.map(row=>row.map(v=>v*v));
    const means=squares.map(row=>row.reduce((s,v)=>s+v,0)/n),grand=means.reduce((s,v)=>s+v,0)/n;
    const gram=squares.map((row,i)=>row.map((value,j)=>-.5*(value-means[i]-means[j]+grand)));
    const eig=eigenSymmetric(gram);
    return Array.from({length:n},(_,i)=>({x:eig[0].vector[i]*Math.sqrt(Math.max(0,eig[0].value)),y:(eig[1]?.vector[i]||0)*Math.sqrt(Math.max(0,eig[1]?.value||0))}));
  }
  function randomStart(n, seed) {
    let state=seed>>>0;
    const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296-.5;};
    return center(Array.from({length:n},()=>({x:next()*2,y:next()*2})));
  }
  function objective(points, distances, pairWeight=1, anchors=[]) {
    let value=0;
    for(let i=0;i<points.length;i++) for(let j=i+1;j<points.length;j++) value+=pairWeight*(Math.sqrt(squared(points[i],points[j]))-distances[i][j])**2;
    anchors.forEach((anchor,i)=>{if(anchor) value+=anchor.weight*squared(points[i],anchor);});
    return value;
  }
  function cholesky(matrix) {
    const n=matrix.length,l=Array.from({length:n},()=>Array(n).fill(0));
    for(let i=0;i<n;i++) for(let j=0;j<=i;j++) {
      let value=matrix[i][j];for(let k=0;k<j;k++) value-=l[i][k]*l[j][k];
      l[i][j]=i===j?Math.sqrt(Math.max(1e-15,value)):value/l[j][j];
    }
    return rhs=>{
      const y=Array(n).fill(0),x=Array(n).fill(0);
      for(let i=0;i<n;i++){let s=rhs[i];for(let k=0;k<i;k++)s-=l[i][k]*y[k];y[i]=s/l[i][i];}
      for(let i=n-1;i>=0;i--){let s=y[i];for(let k=i+1;k<n;k++)s-=l[k][i]*x[k];x[i]=s/l[i][i];}
      return x;
    };
  }
  function metricMDS(distances, options={}) {
    const n=distances.length;
    if(n<2)return {points:Array.from({length:n},()=>({x:0,y:0})),stress:0,iterations:0,history:[0],start:0};
    const anchors=options.anchors||[], anchored=anchors.some(a=>a&&a.weight>0);
    const pairWeight=options.pairWeight??1;
    if(!pairWeight) return {points:options.initial.map((p,i)=>anchors[i]?{x:anchors[i].x,y:anchors[i].y}:{...p}),stress:0,iterations:0,history:[0],start:0};
    let solve;
    if(anchored) {
      const matrix=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?pairWeight*(n-1)+(anchors[i]?.weight||0):-pairWeight));
      solve=cholesky(matrix);
    }
    let best=null;
    const starts=options.starts??16;
    for(let start=0;start<starts;start++) {
      let points=start===0?(options.initial?copy(options.initial):classicalStart(distances)):randomStart(n,173+start*7919);
      let stress=objective(points,distances,pairWeight,anchors),history=[stress],iterations=0;
      for(let step=0;step<(options.maxIterations??1000);step++) {
        const bx=Array(n).fill(0),by=Array(n).fill(0);
        for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) {
          const d=Math.sqrt(squared(points[i],points[j]));
          const ratio=d>1e-12?pairWeight*distances[i][j]/d:0;
          const x=ratio*(points[i].x-points[j].x),y=ratio*(points[i].y-points[j].y);
          bx[i]+=x;bx[j]-=x;by[i]+=y;by[j]-=y;
        }
        let next;
        if(anchored) {
          anchors.forEach((a,i)=>{if(a){bx[i]+=a.weight*a.x;by[i]+=a.weight*a.y;}});
          const x=solve(bx),y=solve(by);next=x.map((value,i)=>({x:value,y:y[i]}));
        } else next=bx.map((x,i)=>({x:x/(n*pairWeight),y:by[i]/(n*pairWeight)}));
        const nextStress=objective(next,distances,pairWeight,anchors);
        if(nextStress>stress+1e-10)break;
        const improvement=stress-nextStress;
        points=next;stress=nextStress;history.push(stress);iterations=step+1;
        if(improvement<1e-10*Math.max(1,stress))break;
      }
      if(!best||stress<best.stress-1e-12)best={points,stress,history,iterations,start};
    }
    if(!anchored)best.points=canonicalize(best.points);
    return best;
  }
  function fitTransform(points,width,height) {
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const scale=Math.min(Math.max(100,width-160)/Math.max(.1,maxX-minX),Math.max(100,height-240)/Math.max(.1,maxY-minY));
    const center={x:(minX+maxX)/2,y:(minY+maxY)/2};
    return {scale,center,offset:{x:width/2,y:130+(height-240)/2}};
  }
  function displayOffsets(anchors,width=78,height=150) {
    const points=copy(anchors),n=points.length;
    for(let step=0;step<120;step++) {
      let overlaps=0;
      for(let i=0;i<n;i++)for(let j=i+1;j<n;j++) {
        const dx=points[j].x-points[i].x,dy=points[j].y-points[i].y;
        const overlapX=width+10-Math.abs(dx),overlapY=height+10-Math.abs(dy);
        if(overlapX<=0||overlapY<=0)continue;
        overlaps++;
        if(overlapX<overlapY){const move=Math.sign(dx||((i+j)%2?1:-1))*(overlapX+.1)/2;points[i].x-=move;points[j].x+=move;}
        else {const move=Math.sign(dy||((i+j)%2?1:-1))*(overlapY+.1)/2;points[i].y-=move;points[j].y+=move;}
      }
      if(!overlaps)break;
    }
    return points;
  }
  function layoutMovies({metadata,synopsis,weights,targets,width=1180,height=793,cardWidth=78,cardHeight=150,starts=16}) {
    const n=synopsis.length, computationalWeight=weights.metadata+weights.synopsis,total=computationalWeight+weights.personal;
    const distances=combineDistances(metadata,synopsis,weights);
    const neutral=Array.from({length:n},(_,i)=>({x:Math.cos(i/n*2*Math.PI),y:Math.sin(i/n*2*Math.PI)}));
    const computational=computationalWeight?metricMDS(distances,{starts}):{points:neutral,stress:0,iterations:0};
    const transform=fitTransform(computational.points,width,height);
    const anchors=targets.map(target=>target&&weights.personal?{
      x:(target.x*width-transform.offset.x)/transform.scale+transform.center.x,
      y:(target.y*height-transform.offset.y)/transform.scale+transform.center.y,
      weight:weights.personal/(total||1)
    }:null);
    const constrained=anchors.some(Boolean)?metricMDS(distances,{
      initial:computational.points,anchors,pairWeight:computationalWeight/(total||1)/Math.max(1,n-1),starts
    }):computational;
    const semantic=constrained.points.map(point=>({x:(point.x-transform.center.x)*transform.scale+transform.offset.x,y:(point.y-transform.center.y)*transform.scale+transform.offset.y}));
    const display=displayOffsets(semantic,cardWidth,cardHeight);
    const percent=points=>points.map(p=>({x:p.x/width*100,y:p.y/height*100}));
    return {positions:percent(display),anchors:percent(semantic),semanticPoints:constrained.points,displayPixels:display,anchorPixels:semantic,distances,stress:constrained.stress,computationalStress:computational.stress,iterations:constrained.iterations,hasConstraints:anchors.some(Boolean)};
  }
  function evaluateLayout(points, distances, k=2) {
    const n=points.length;
    let dd=0,dt=0,tt=0;
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){const d=Math.sqrt(squared(points[i],points[j])),t=distances[i][j];dd+=d*d;dt+=d*t;tt+=t*t;}
    const scale=dd?dt/dd:1;
    let error=0,matched=0,topOne=0;const neighbors=[];
    for(let i=0;i<n;i++) {
      const expected=distances[i].map((d,j)=>({j,d})).filter(p=>p.j!==i).sort((a,b)=>a.d-b.d||a.j-b.j);
      const actual=points.map((p,j)=>({j,d:squared(points[i],p)})).filter(p=>p.j!==i).sort((a,b)=>a.d-b.d||a.j-b.j);
      const wanted=expected.slice(0,k).map(p=>p.j),seen=actual.slice(0,k).map(p=>p.j);
      const hits=seen.filter(j=>wanted.includes(j)).length;matched+=hits;topOne+=+(actual[0].j===expected[0].j);
      neighbors.push({film:i,expected:wanted,actual:seen,hits});
      for(let j=i+1;j<n;j++)error+=(scale*Math.sqrt(squared(points[i],points[j]))-distances[i][j])**2;
    }
    return {normalizedStress:tt?Math.sqrt(error/tt):0,neighborRecall:matched/(n*Math.min(k,n-1)),topOneRecall:topOne/n,matched,total:n*Math.min(k,n-1),scale,neighbors};
  }
  const api={distancesFromScores,combineDistances,metricMDS,layoutMovies,evaluateLayout,displayOffsets};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MovieLayout=api;
})(globalThis);
