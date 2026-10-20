/** Capture a fighter's joints and hand steps from local quick fights at 60 fields a second. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadFightTables, loadMoveset } from '../../src/assets/load.ts';
import { Fight } from '../../src/sim/fight/fight.ts';
import { fightDataFor } from '../../src/sim/fight/match.ts';
import { handPart } from '../../src/sim/fight/hands.ts';
import { affinePose } from './glb-pose.mjs';

export async function fighterGameplay(root, roster, skeleton, costume = 0) {
  const json=async name=>JSON.parse(readFileSync(path.join(root,'public/assets',name),'utf8'));
  const {tables}=await loadFightTables(json);
  const id=tables.roster.codes[roster*4].moveset;
  const own=await loadMoveset(json,String(id).padStart(2,'0')), common=await loadMoveset(json,'common');
  const cases=[
    {name:'idle',fields:120,pad:()=>0},
    {name:'walk',fields:120,pad:()=>0x2000},
    {name:'sidestep-input',fields:120,pad:i=>i%40<3?4:0},
    {name:'attack-inputs',fields:480,pad:i=>{const buttons=[0x80,0x10,0x40,0x20,0x90,0x60,0xc0,0x30];return i%30<3?buttons[Math.floor(i/30)%buttons.length]:0;}},
    {name:'cpu-fight',fields:1200,pad:()=>0,cpu:true},
  ];
  const clips=[];
  for(const c of cases){
    const setup={stage:0,difficulty:4,entrants:[{roster,costume,computer:!!c.cpu},{roster,costume,computer:!!c.cpu}]};
    const fight=Fight.quick(fightDataFor(tables,setup,()=>own,common),setup);
    for(let i=0;i<180;i++)fight.field([0,0]);
    const start=fight.state.fighters[0].skeleton.joints[0].world.translation;
    const origin=[start[0],0,start[2]], poses=[], moves=new Set();
    for(let i=0;i<c.fields;i++){
      fight.field([c.pad(i),0]);
      const f=fight.state.fighters[0];
      const raw=skeleton.map(j=>{const w=f.skeleton.joints[j.joint].world;return {r:w.rotation.map(x=>x/4096),t:w.translation.map((x,k)=>x-origin[k])};});
      const hands={};
      for(let hand=0;hand<2;hand++) {const part=handPart(roster,hand);hands[part]=f.hands.drawn[hand];}
      poses.push({...affinePose(skeleton,raw),raw,hands,move:f.moveId});
      moves.add(f.moveId);
    }
    clips.push({name:c.name,poses,moves:[...moves]});
  }
  return clips;
}
