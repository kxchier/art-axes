const fs=require('node:fs'),vm=require('node:vm');
const M=require('../dist/movie-layout.js'),{legacyLayout}=require('./legacy-layout.cjs');
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync('dist/films.js','utf8')+';globalThis.movies=films',context);vm.runInContext(fs.readFileSync('dist/synopsis-scores.js','utf8')+';globalThis.synopsis=synopsisData',context);
const films=JSON.parse(JSON.stringify(context.movies)),synopsis=JSON.parse(JSON.stringify(context.synopsis.scores));
const metadata=films.map(a=>films.map(b=>((a.director===b.director?1:0)+Math.max(0,1-Math.abs(a.year-b.year)/30))/2));
const cases=[];
for(const [name,weights] of [['synopsis only',{personal:0,metadata:0,synopsis:100}],['metadata only',{personal:0,metadata:100,synopsis:0}],['computational blend',{personal:0,metadata:15,synopsis:25}]])for(const [width,height] of [[1180,793],[720,650],[1500,900]]){
 const input={metadata,synopsis,weights,targets:films.map(()=>null),width,height};
 const old=legacyLayout(input).map(p=>({x:p.x*width/100,y:p.y*height/100})),next=M.layoutMovies(input);
 const oldTarget=synopsis.map((row,i)=>row.map((v,j)=>i===j?0:.16+.54*(1-(metadata[i][j]*weights.metadata+v*weights.synopsis)/(weights.metadata+weights.synopsis))));
 cases.push({name,width,height,weights,old:M.evaluateLayout(old,next.distances),new:M.evaluateLayout(next.anchorPixels,next.distances),posters:M.evaluateLayout(next.displayPixels,next.distances),legacyTarget:{old:M.evaluateLayout(old,oldTarget),new:M.evaluateLayout(next.anchorPixels,oldTarget)},positions:{old,new:next.anchorPixels,posters:next.displayPixels}});
}
const report={method:'All 45 pairs. Normalized stress after optimal uniform scaling; Recall@2 counts retained true nearest neighbors out of 20. Same target distances for both layouts: sqrt(2*(1-similarity)), weighted across enabled sources. Baseline target transform also evaluated. No personal data used.',films:films.map(f=>f.title),cases};
fs.writeFileSync('reports/layout-comparison.json',JSON.stringify(report,null,2)+'\n');
console.table(cases.map(c=>({case:c.name,size:`${c.width}x${c.height}`,oldError:c.old.normalizedStress.toFixed(4),newError:c.new.normalizedStress.toFixed(4),posterError:c.posters.normalizedStress.toFixed(4),oldNeighbors:c.old.matched,newNeighbors:c.new.matched,posterNeighbors:c.posters.matched})));
module.exports={report,metadata,synopsis,films};
