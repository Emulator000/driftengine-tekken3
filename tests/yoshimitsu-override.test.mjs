import assert from 'node:assert/strict';
import { test } from 'node:test';
import { yoshimitsuOverride } from '../src/app/yoshimitsu.ts';
import { writeFtr5 } from '../scripts/lib/ftr.mjs';

test('the Yoshimitsu override is opt-in and applies to pack 08 alone', async () => {
  const load = () => assert.fail('an unselected override must not load');
  assert.equal(await yoshimitsuOverride(8, null, load), null);
  assert.equal(await yoshimitsuOverride(9, 'refined', load), null);
  assert.equal(await yoshimitsuOverride(0, 'refined', load), null);
});

test('a compatible refined mesh loads, while missing or invalid data falls back', async () => {
  const vertex = { influences: [{ joint: 1, weight: 1, point: [0, 0, 0] }], normalJoint: 1, normal: [0, 4096, 0], uv: [0, 0] };
  const bytes = writeFtr5({width:16,height:16,vertices:Array.from({length:7329},()=>vertex),indices:Array.from({length:9918*3},(_,i)=>i%3)});
  const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  assert.equal(await yoshimitsuOverride(8,'refined',async path=>{assert.equal(path,'overrides/yoshimitsu/08.ftr');return buffer;}),buffer);
  assert.equal(await yoshimitsuOverride(8,'refined',async()=>new ArrayBuffer(8)),null);
  assert.equal(await yoshimitsuOverride(8,'refined',async()=>{throw new Error('not installed');}),null);
});

test('selective refinement may add geometry within the 15000 triangle budget', async () => {
  const vertex = { influences: [{ joint: 2, weight: 1, point: [0, 0, 0] }], normalJoint: 2, normal: [0, 4096, 0], uv: [0, 0] };
  const bytes = writeFtr5({width:16,height:16,vertices:Array.from({length:9604},()=>vertex),indices:Array.from({length:13916*3},(_,i)=>i%3)});
  const buffer = bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  assert.equal(await yoshimitsuOverride(8,'refined',async()=>buffer),buffer);
  const excessive = buffer.slice(0);
  new DataView(excessive).setUint32(12,15001*3,true);
  assert.equal(await yoshimitsuOverride(8,'refined',async()=>excessive),null);
});

test('a fitted Tag mesh may use fewer triangles while keeping the gameplay rig', async () => {
  const vertex={influences:[{joint:2,weight:1,point:[0,0,0]}],normalJoint:2,normal:[0,4096,0],uv:[0,0]};
  const bytes=writeFtr5({width:2048,height:2048,vertices:Array.from({length:3863},()=>vertex),indices:Array.from({length:5691*3},(_,i)=>i%3),twoFaced:[0,1]});
  const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  assert.equal(await yoshimitsuOverride(8,'tag',async path=>{assert.equal(path,'overrides/yoshimitsu-tag/08.ftr');return buffer;}),buffer);
  assert.equal(await yoshimitsuOverride(9,'tag',()=>assert.fail('wrong costume')),null);
  const bad=buffer.slice(0);new DataView(bad).setUint8(28,18);
  assert.equal(await yoshimitsuOverride(8,'tag',async()=>bad),null);
});
