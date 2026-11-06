/** Export the local CPU refinement with the original gameplay clips and point skin. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { fighterGlb } from './lib/fighter-glb.mjs';
import { readFtr, writeFtr5 } from './lib/ftr.mjs';

const folder = process.argv[2] ?? '08-hd-pass';
assert.ok(['08-hd-pass','08-video-refined','08-complete','08-mask-legs'].includes(folder));
const dir = `local-remaster/yoshimitsu/${folder}`;
const source = JSON.parse(readFileSync(`${dir}/yoshimitsu_enhanced.source.json`));
const previousFolder = folder === '08-mask-legs' ? '08-complete' : folder === '08-complete' ? '08-video-refined' : folder === '08-video-refined' ? '08-hd-pass' : '08-refined-playable';
const previous = JSON.parse(readFileSync(`local-remaster/yoshimitsu/${previousFolder}/yoshimitsu_enhanced.source.json`));
assert.deepEqual(source.skeleton, previous.skeleton);
assert.deepEqual(source.clips, previous.clips);
if (folder !== '08-hd-pass' && folder !== '08-mask-legs') {
  assert.deepEqual(source.mesh.indices, previous.mesh.indices);
  assert.equal(source.mesh.vertices.length,previous.mesh.vertices.length);
  source.mesh.vertices.forEach((v,i)=>{
    assert.deepEqual(v.uv,previous.mesh.vertices[i].uv);
    assert.deepEqual(v.influences.map(f=>[f.joint,f.weight]),previous.mesh.vertices[i].influences.map(f=>[f.joint,f.weight]));
  });
} else if(folder==='08-mask-legs') {
  previous.mesh.vertices.forEach((old,i)=>{
    const v=source.mesh.vertices[i];
    assert.deepEqual(v.uv,old.uv);
    assert.deepEqual(v.influences.map(f=>[f.joint,f.weight]),old.influences.map(f=>[f.joint,f.weight]));
    if(!old.influences.every(f=>f.joint===2)) assert.deepEqual(v.influences,old.influences);
    if(!old.influences.every(f=>[2,12,13,14,15,16,17].includes(f.joint))) assert.deepEqual(v,old);
  });
} else assert.deepEqual(source.mesh.vertices.slice(0, previous.mesh.vertices.length), previous.mesh.vertices);
assert.deepEqual(source.mesh.shapes, previous.mesh.shapes);
assert.ok(source.mesh.indices.length / 3 <= 15000);
const bytes = writeFtr5(source.mesh);
assert.deepEqual(readFtr(bytes), source.mesh);
const png = readFileSync(`${dir}/yoshimitsu_diffuse_2k.png`);
const materialMaps = ['08-complete','08-mask-legs'].includes(folder)?{normal:readFileSync(`${dir}/yoshimitsu.normal.png`),orm:readFileSync(`${dir}/yoshimitsu.orm.png`)}:null;
const { glb } = fighterGlb(source.mesh, source.skeleton, png, source.frames, { exactSkin: true, clips: source.clips, materialMaps });
writeFileSync(`${dir}/yoshimitsu_enhanced.glb`, glb);
writeFileSync(`${dir}/yoshimitsu_enhanced.ftr`, bytes);
const target = 'public/assets/overrides/yoshimitsu';
mkdirSync(target, {recursive:true});
writeFileSync(`${target}/08.ftr`, bytes);
copyFileSync(`${dir}/yoshimitsu_diffuse_2k.png`, `${target}/08.png`);
if(materialMaps!==null){writeFileSync(`${target}/08.normal.png`,materialMaps.normal);writeFileSync(`${target}/08.orm.png`,materialMaps.orm);}
console.log({triangles:source.mesh.indices.length/3,vertices:source.mesh.vertices.length,bytes:glb.length});
