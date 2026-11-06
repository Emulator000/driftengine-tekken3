/** Export a locally fitted OBJ with the existing gameplay rig and animation clips. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {fighterGlb} from './lib/fighter-glb.mjs';
import {writeFtr5,readFtr} from './lib/ftr.mjs';
const dir=process.argv[2];
if(!/^local-remaster\/yoshimitsu\/[a-z0-9-]+$/.test(dir??''))throw Error('expected a local Yoshimitsu output folder');
const s=JSON.parse(readFileSync(`${dir}/yoshimitsu_tag.source.json`));
const original=JSON.parse(readFileSync('local-remaster/yoshimitsu/08-ready/yoshimitsu_rounded.source.json'));
assert.deepEqual(s.skeleton,original.skeleton);
if(s.clips.length)assert.deepEqual(s.clips,original.clips);
assert.ok(s.mesh.indices.length/3<=15000);
// Store the runtime's byte-normalized weights in the interchange source too.
s.mesh.version=6;
for(const v of s.mesh.vertices){const weights=v.influences.map(f=>Math.max(1,Math.round(f.weight*255)));weights[weights.indexOf(Math.max(...weights))]+=255-weights.reduce((a,b)=>a+b,0);v.influences.forEach((f,i)=>f.weight=weights[i]/255);}
const ftr=writeFtr5(s.mesh);assert.deepEqual(readFtr(ftr),s.mesh);
const png=readFileSync(`${dir}/yoshimitsu_diffuse.png`);
const {glb}=fighterGlb(s.mesh,s.skeleton,png,s.frames,{exactSkin:true,clips:s.clips});
writeFileSync(`${dir}/yoshimitsu_tag.ftr`,ftr);writeFileSync(`${dir}/yoshimitsu_tag.glb`,glb);
writeFileSync(`${dir}/yoshimitsu_tag.source.json`,JSON.stringify(s));
console.log({vertices:s.mesh.vertices.length,triangles:s.mesh.indices.length/3,bytes:glb.length});
