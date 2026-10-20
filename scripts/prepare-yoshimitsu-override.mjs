/** Convert the refined model's retained point skin for the optional gameplay override. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFtr, writeFtr5 } from './lib/ftr.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const folder=process.argv[2]??'08-refined-playable';
if(!/^[a-zA-Z0-9_-]+$/.test(folder))throw new Error('expected a local experiment folder name');
const dir=path.join(root,'local-remaster/yoshimitsu',folder);
const enhanced=JSON.parse(readFileSync(path.join(dir,'yoshimitsu_enhanced.source.json')));
const original=JSON.parse(readFileSync(path.join(root,'local-remaster/yoshimitsu/08-ready/yoshimitsu_rounded.source.json')));
assert.deepEqual(enhanced.skeleton,original.skeleton);
assert.deepEqual(enhanced.clips,original.clips);
assert.deepEqual(enhanced.mesh.indices,original.mesh.indices);
for(let i=0;i<original.mesh.vertices.length;i++){
  const a=original.mesh.vertices[i],b=enhanced.mesh.vertices[i];
  assert.deepEqual(a.uv,b.uv);
  assert.deepEqual(a.influences.map(f=>[f.joint,f.weight]),b.influences.map(f=>[f.joint,f.weight]));
}
for(let g=0;g<original.mesh.shapes.length;g++){
  const a=original.mesh.shapes[g],b=enhanced.mesh.shapes[g];
  assert.deepEqual(a.steps,b.steps);assert.deepEqual(a.vertices,b.vertices);
  for(let s=0;s<a.shapes.length;s++)for(let k=0;k<a.vertices.length;k++){
    const v=a.vertices[k];
    for(let f=0;f<a.shapes[s][k].points.length;f++)for(let c=0;c<3;c++){
      assert.equal(b.shapes[s][k].points[f][c]-enhanced.mesh.vertices[v].influences[f].point[c],a.shapes[s][k].points[f][c]-original.mesh.vertices[v].influences[f].point[c]);
    }
  }
}
const bytes=writeFtr5(enhanced.mesh),mesh=readFtr(bytes);
assert.equal(mesh.indices.length/3,9918);
assert.deepEqual(mesh.vertices,enhanced.mesh.vertices);
writeFileSync(path.join(dir,'yoshimitsu_enhanced.ftr'),bytes);
const target=path.join(root,'public/assets/overrides/yoshimitsu');
mkdirSync(target,{recursive:true});
writeFileSync(path.join(target,'08.ftr'),bytes);
console.log('Prepared optional pack 08 override (?yoshimitsu=refined).');
