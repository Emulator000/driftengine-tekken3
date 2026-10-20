/** Export a local fighter for a modelling tool: node scripts/export-fighter.mjs [pack]. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFtr } from './lib/ftr.mjs';
import { fighterGlb } from './lib/fighter-glb.mjs';
import { fighterGameplay } from './lib/fighter-gameplay.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pack = process.argv[2] ?? '08';
if (!/^\d{2}$/.test(pack)) throw new Error('pack must be two decimal digits');
const roster = JSON.parse(readFileSync(path.join(root, 'public/assets/tables/roster.json')));
const fighter = roster.codes.find((c) => c.pack === Number(pack));
if (!fighter) throw new Error('pack is not in the playable roster');
const name = fighter.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const outputName = process.argv[3] ?? `${pack}-validated`;
if (!/^[a-zA-Z0-9_-]+$/.test(outputName)) throw new Error('output name must be a directory name');
const output = path.join(root, 'local-remaster', name, outputName);
if (existsSync(output)) throw new Error('export already exists; move it aside before exporting again');
const source = path.join(root, 'public/data/fighters', pack);
const skeletonBytes = readFileSync(`${source}.json`);
const { skeleton } = JSON.parse(skeletonBytes);
const originalBytes = readFileSync(`${source}.ftr`);
const original = readFtr(originalBytes);
const png = readFileSync(`${source}.png`);
const rosterId=Math.floor(roster.codes.indexOf(fighter)/4);
const clips=await fighterGameplay(root,rosterId,skeleton,roster.codes.indexOf(fighter)%4);
const frames=clips[0].poses[0].frames;
const results = ['original', 'rounded'].map((kind) => {
  const bytes = kind === 'original' ? originalBytes : readFileSync(path.join(root, 'public/assets/models/fighters', `${pack}.ftr`));
  const mesh = readFtr(bytes);
  const animated=clips.map(clip=>{
    const selected=mesh.shapes.map(()=>0);
    return {...clip,poses:clip.poses.map(p=>{
      mesh.shapes.forEach((group,g)=>{const s=group.steps[p.hands[group.part]];if(s!==undefined&&s!==255)selected[g]=s;});
      return {...p,forms:[...selected]};
    })};
  });
  const exported = fighterGlb(mesh, skeleton, png, frames,{exactSkin:true,clips:animated});
  return { kind, bytes, mesh, animated, ...exported };
});
mkdirSync(output, { recursive: true });
copyFileSync(`${source}.png`, path.join(output, `${name}_diffuse.png`));
writeFileSync(path.join(output, 'skeleton.json'), skeletonBytes);
const stats = results.map(({ kind, bytes, mesh, animated, glb, maxLocalResidualMm, auxiliarySkinJoints }) => {
  writeFileSync(path.join(output, `${name}_${kind}.glb`), glb);
  if(kind==='rounded')writeFileSync(path.join(output,`${name}_rounded_cloud_input.glb`),fighterGlb(mesh,skeleton,png,frames,{staticMesh:true}).glb);
  writeFileSync(path.join(output, `${name}_${kind}.ftr`), bytes);
  writeFileSync(path.join(output, `${name}_${kind}.source.json`), JSON.stringify({ skeleton, frames, mesh, clips:animated }));
  return { kind, vertices: mesh.vertices.length, triangles: mesh.indices.length / 3, atlas: [mesh.width, mesh.height], joints: skeleton.length, auxiliarySkinJoints, handShapes: mesh.shapes.map((s) => ({ part: s.part, count: s.shapes.length })), naiveSkinResidualMm:maxLocalResidualMm, clips:animated.map(c=>({name:c.name,frames:c.poses.length,moves:c.moves})), bytes: glb.length };
});
writeFileSync(path.join(output, 'statistics.json'), JSON.stringify({ fighter: fighter.name, moveset: fighter.moveset, pack: Number(pack), proposedTriangleCeiling: 15000, enhanced: null, stats }, null, 2));
console.log(JSON.stringify({ output, stats }, null, 2));
