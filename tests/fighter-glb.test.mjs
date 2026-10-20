import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fighterGlb } from '../scripts/lib/fighter-glb.mjs';
import { mul, place } from '../scripts/lib/round/vec.mjs';
import { eulerRotation } from '../scripts/lib/round/bind.mjs';
import { affinePose, frameFromTrs, glbPoint, rigidPose } from '../scripts/lib/glb-pose.mjs';

const skeleton = [{ joint: 0, parent: -1, offset: [0, 0, 0] }, { joint: 1, parent: 0, offset: [1000, 0, 0] }];
const vertices = [[0, 0, 0], [100, 0, 0], [0, 100, 0]].map((point) => ({ influences: [{ joint: 1, weight: 1, point }], normalJoint: 1, normal: [0, 0, 4096], uv: [8, 16] }));
const mesh = { vertices, indices: [0, 1, 2], width: 64, height: 32, twoFaced: [0], pictures: [], shapes: [{ part: 12, steps: [0], vertices: [0], shapes: [[{ points: [[0, 50, 0]], normal: [0, 0, 4096] }]] }] };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

test('fighter GLB embeds normal and ORM material maps independently of skin animation',()=>{
  const {glb}=fighterGlb(mesh,skeleton,png,undefined,{materialMaps:{normal:png,orm:png}});
  const length=glb.readUInt32LE(12),g=JSON.parse(glb.subarray(20,20+length));
  assert.equal(g.images.length,3);
  assert.equal(g.materials[0].normalTexture.index,1);
  assert.equal(g.materials[0].pbrMetallicRoughness.metallicRoughnessTexture.index,2);
  assert.equal(g.materials[0].occlusionTexture.index,2);
  assert.equal(g.materials[0].pbrMetallicRoughness.metallicFactor,1);
  assert.equal(g.samplers[0].magFilter,9729);
  assert.ok(Number.isInteger(g.meshes[0].primitives[0].attributes.TANGENT));
  assert.deepEqual(g.skins[0].joints,[0,1]);
});

test('fighter GLB preserves indexed geometry, UVs, hierarchy, skin and hand shapes', () => {
  const { glb, maxLocalResidualMm } = fighterGlb(mesh, skeleton, png);
  assert.equal(glb.readUInt32LE(0), 0x46546c67);
  assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.length);
  const jsonSize = glb.readUInt32LE(12);
  const g = JSON.parse(glb.subarray(20, 20 + jsonSize));
  const bin = glb.subarray(28 + jsonSize);
  const values = (id) => {
    const a = g.accessors[id], v = g.bufferViews[a.bufferView];
    const b = bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
    return Array.from(a.componentType === 5126 ? new Float32Array(b.buffer, b.byteOffset, b.length / 4) : new Uint16Array(b.buffer, b.byteOffset, b.length / 2));
  };
  assert.deepEqual(g.nodes[0].children, [1]);
  assert.equal(g.nodes[1].matrix[12], 1);
  assert.deepEqual(g.skins[0].joints, [0, 1]);
  assert.equal(maxLocalResidualMm, 0);
  const p = g.meshes[0].primitives[0];
  assert.deepEqual(values(p.indices), [0, 1, 2]);
  assert.deepEqual(values(p.attributes.TEXCOORD_0).slice(0, 2), [1 / 64, 2 / 32]);
  assert.deepEqual(values(p.attributes.JOINTS_0).slice(0, 4), [1, 0, 0, 0]);
  assert.deepEqual(values(p.attributes.POSITION).slice(0, 3), [1, -0, -0]);
  assert.equal(g.materials[p.material].doubleSided, true);
  assert.equal(p.targets.length, 1);
  assert.ok(Math.abs(values(p.targets[0].POSITION)[1] + 0.05) < 1e-6);
  const iv = g.bufferViews[g.images[0].bufferView];
  assert.deepEqual(bin.subarray(iv.byteOffset, iv.byteOffset + iv.byteLength), png);
  for (const v of g.bufferViews) { assert.equal(v.byteOffset % 4, 0); assert.ok(v.byteOffset + v.byteLength <= bin.length); }
});

test('fighter GLB rejects invalid topology and weights', () => {
  assert.throws(() => fighterGlb({ ...mesh, indices: [0, 1, 3] }, skeleton, png), /index out of bounds/);
  assert.throws(() => fighterGlb({ ...mesh, vertices: vertices.map((v) => ({ ...v, influences: [{ joint: 1, weight: 0.5, point: [0, 0, 0] }] })) }, skeleton, png), /sum to one/);
});

test('rounded independent points deform correctly when a joint turns across an open seam', () => {
  const verts = vertices.map((v) => ({ ...v, influences: [{joint:0,weight:0.5,point:[0,100,0]}, {joint:1,weight:0.5,point:[-500,200,0]}] }));
  const source = {...mesh,vertices:verts,shapes:[]};
  const bind=[{r:eulerRotation(0,0,0),t:[0,0,0]},{r:eulerRotation(0,0,0),t:[1000,0,0]}];
  const pose=[bind[0],{r:eulerRotation(0,0,16384),t:[1000,0,0]}];
  const {glb}=fighterGlb(source,skeleton,png,bind,{exactSkin:true});
  const n=glb.readUInt32LE(12),g=JSON.parse(glb.subarray(20,20+n)),bin=glb.subarray(28+n);
  const vals=(id)=>{const a=g.accessors[id],v=g.bufferViews[a.bufferView],b=bin.subarray(v.byteOffset,v.byteOffset+v.byteLength);return a.componentType===5123?new Uint16Array(b.buffer,b.byteOffset,b.length/2):new Float32Array(b.buffer,b.byteOffset,b.length/4);};
  const attrs=g.meshes[0].primitives[0].attributes, p=vals(attrs.POSITION), js=vals(attrs.JOINTS_0), ws=vals(attrs.WEIGHTS_0), ib=vals(g.skins[0].inverseBindMatrices);
  let actual=[0,0,0];
  for(let k=0;k<4;k++){
    if(!ws[k])continue;
    const slot=js[k],node=g.skins[0].joints[slot],bone=node<skeleton.length?node:g.nodes[node].extras.sourceJoint;
    const m=ib.subarray(slot*16,slot*16+16);
    const local=[0,1,2].map(c=>m[c]*p[0]+m[4+c]*p[1]+m[8+c]*p[2]+m[12+c]);
    const mm=[local[0]*1000,-local[1]*1000,-local[2]*1000];
    const world=glbPoint(place(pose[bone],mm));
    actual=actual.map((v,c)=>v+ws[k]*world[c]);
  }
  const expected=glbPoint(verts[0].influences.reduce((sum,f)=>sum.map((x,c)=>x+place(pose[f.joint],f.point)[c]*f.weight),[0,0,0]));
  assert.ok(Math.hypot(...actual.map((x,c)=>x-expected[c]))<1e-6,`${actual} versus ${expected}`);
});

test('animated TRS frames preserve a rotated hierarchy and translations', () => {
  const frames=[{r:eulerRotation(1000,2000,3000),t:[20,40,60]},{r:eulerRotation(-2000,5000,9000),t:[500,200,-60]}];
  const out=rigidPose(skeleton,frames);
  for(let j=0;j<2;j++){
    assert.ok(Math.hypot(...out.frames[j].t.map((x,c)=>x-frames[j].t[c]))<1e-8);
    assert.ok(Math.max(...out.frames[j].r.map((x,c)=>Math.abs(x-frames[j].r[c])))<1e-8);
  }
});

test('two-node animation retains the shear and scale in blended gameplay joints', () => {
  const frames=[{r:[1,0.1,0,0,0.98,0.05,0,0,1.02],t:[10,-20,30]},{r:[0.9,0.2,0.1,-0.1,1,0,0,0.03,1.1],t:[500,-400,70]}];
  const {tracks}=affinePose(skeleton,frames);
  const world=[];
  for(let j=0;j<2;j++){
    const pre=frameFromTrs(tracks[j]),post=frameFromTrs(tracks[j].post);
    const local={r:mul(pre.r,post.r),t:pre.t};
    world[j]=j===0?local:{r:mul(world[0].r,local.r),t:place(world[0],local.t)};
    assert.ok(Math.max(...world[j].r.map((x,c)=>Math.abs(x-frames[j].r[c])))<1e-8);
    assert.ok(Math.hypot(...world[j].t.map((x,c)=>x-frames[j].t[c]))<1e-8);
  }
});

test('animated GLB has correctly sized translation, rotation and scale tracks', () => {
  const frames=[{r:eulerRotation(0,0,0),t:[0,0,0]},{r:eulerRotation(0,0,1000),t:[1000,0,0]}];
  const pose=affinePose(skeleton,frames);
  const {glb}=fighterGlb({...mesh,shapes:[]},skeleton,png,frames,{exactSkin:true,clips:[{name:'turn',poses:[pose,pose]}]});
  const n=glb.readUInt32LE(12),g=JSON.parse(glb.subarray(20,20+n));
  for(const channel of g.animations[0].channels){
    const sampler=g.animations[0].samplers[channel.sampler],a=g.accessors[sampler.output];
    const width=channel.target.path==='rotation'?4:3;
    assert.equal(a.type,width===4?'VEC4':'VEC3');
    assert.equal(g.bufferViews[a.bufferView].byteLength,2*width*4);
    assert.equal(sampler.interpolation,'STEP');
  }
  assert.equal(g.extras.affineNodes,2);
  assert.equal(g.nodes[g.skins[0].joints[1]].name,'joint_1');
});

