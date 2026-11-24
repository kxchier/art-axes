// Rebuild bundled title / poster similarities from the ten local films and posters.
// Node >=22; CLIP weights download into .cache once, inference stays on this computer.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { pipeline, env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const context={};
vm.runInNewContext(await fs.readFile(path.join(root,'dist/films.js'),'utf8')+'\nthis.films=films;',context);
const films=context.films;
env.cacheDir=path.join(root,'.cache/transformers');
env.localModelPath=path.join(root,'dist/models/');
const normalize=a=>{const norm=Math.hypot(...a);return Array.from(a,v=>norm?v/norm:0);};
const cosine=(a,b)=>Math.max(0,Math.min(1,a.reduce((s,v,i)=>s+v*b[i],0)));
const matrix=vectors=>vectors.map((a,i)=>vectors.map((b,j)=>i===j?1:cosine(a,b)));
const titleModel='Xenova/all-MiniLM-L6-v2';
console.log('Computing title meaning with bundled MiniLM…');
const titles=await pipeline('feature-extraction',titleModel,{dtype:'q8',local_files_only:true});
const titleVectors=(await titles(films.map(f=>f.title),{pooling:'mean',normalize:true})).tolist();
await titles.dispose();
const posterHashes=[],histograms=[],compositions=[];
for(const film of films){
 const file=path.join(root,'dist',film.poster);
 const bytes=await fs.readFile(file);
 posterHashes.push(createHash('sha256').update(bytes).digest('hex'));
 const {data}=await sharp(bytes).resize(32,48,{fit:'fill'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const histogram=Array(64).fill(0), cells=Array(4*4*3).fill(0);
 for(let y=0;y<48;y++)for(let x=0;x<32;x++){
   const i=(y*32+x)*3,r=data[i],g=data[i+1],b=data[i+2];
   histogram[(r>>6)*16+(g>>6)*4+(b>>6)]++;
   const cell=(Math.floor(y/12)*4+Math.floor(x/8))*3;
   for(let c=0;c<3;c++)cells[cell+c]+=data[i+c]/255/96;
 }
 histograms.push(normalize(histogram.map(v=>Math.sqrt(v/(32*48)))));
 compositions.push(cells);
}
const appearance=histograms.map((a,i)=>histograms.map((b,j)=>{
 const mse=compositions[i].reduce((s,v,k)=>s+(v-compositions[j][k])**2,0)/48;
 return i===j?1:.65*cosine(a,b)+.35*Math.exp(-mse/.05);
}));
const clipModel='Xenova/clip-vit-base-patch32';
console.log('Loading CLIP vision model (one-time download)…');
const processor=await AutoProcessor.from_pretrained(clipModel);
const clip=await CLIPVisionModelWithProjection.from_pretrained(clipModel,{dtype:'q8',device:'cpu',progress_callback:p=>{if(p.status==='done')console.log(`Loaded ${p.file}`);}});
const clipVectors=[];
for(let i=0;i<films.length;i++){
 const image=await RawImage.read(path.join(root,'dist',films[i].poster));
 const result=await clip(await processor(image));
 clipVectors.push(normalize(Array.from(result.image_embeds.data)));
 console.log(`Embedded poster ${i+1}/${films.length}: ${films[i].title}`);
}
await clip.dispose();
const payload={filmTitles:films.map(f=>f.title),posterHashes,sources:{
 title:{model:titleModel,method:'Mean-pooled, L2-normalized title embeddings; cosine similarity clamped to [0,1].',scores:matrix(titleVectors)},
 visual:{model:'Local color histogram + spatial color features',method:'65% cosine of square-root 64-bin RGB histograms + 35% exp(-MSE/0.05) of 4×4 RGB spatial means. Posters resized to 32×48.',scores:appearance},
 clip:{model:clipModel,method:'Quantized CLIP vision projection embeddings from the local posters, L2-normalized; cosine similarity clamped to [0,1].',scores:matrix(clipVectors)}
}};
await fs.writeFile(path.join(root,'dist/media-scores.js'),'const mediaData = '+JSON.stringify(payload,null,2)+';\n');
console.log('Built title, poster appearance, and CLIP visual-meaning scores.');
