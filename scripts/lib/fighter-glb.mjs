/** A fighter's bind mesh and skeleton as a self-contained glTF 2 binary. */
import { bindPose, bindPosition, bindNormal } from './round/bind.mjs';
import { apply, sub } from './round/vec.mjs';
import { inverseFrame, relativeFrame, glbMatrix, jointTrs } from './glb-pose.mjs';

const turn = ([x, y, z]) => [x / 1000, -y / 1000, -z / 1000];

function surfaceTangents(mesh,positions,normals) {
  const tangents=positions.map(()=>[0,0,0]),bitangents=positions.map(()=>[0,0,0]);
  for(let i=0;i<mesh.indices.length;i+=3){
    const ids=mesh.indices.slice(i,i+3),[a,b,c]=ids;
    const p=sub(positions[b],positions[a]),q=sub(positions[c],positions[a]);
    const uv=ids.map(v=>mesh.vertices[v].uv.map((x,k)=>x/(8*[mesh.width,mesh.height][k])));
    const u=uv[1].map((x,k)=>x-uv[0][k]),v=uv[2].map((x,k)=>x-uv[0][k]),det=u[0]*v[1]-u[1]*v[0];
    if(Math.abs(det)<1e-12)continue;
    for(const at of ids)for(let k=0;k<3;k++){
      tangents[at][k]+=(p[k]*v[1]-q[k]*u[1])/det;
      bitangents[at][k]+=(q[k]*u[0]-p[k]*v[0])/det;
    }
  }
  return normals.map((normal,i)=>{
    const n=normal.map(x=>x/(Math.hypot(...normal)||1));
    const along=tangents[i].reduce((sum,x,k)=>sum+x*n[k],0);
    let t=tangents[i].map((x,k)=>x-along*n[k]);
    if(Math.hypot(...t)<1e-9)t=Math.abs(n[0])<.9?[0,n[2],-n[1]]:[-n[2],0,n[0]];
    const length=Math.hypot(...t);t=t.map(x=>x/length);
    const cross=[n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]];
    return [...t,cross.reduce((sum,x,k)=>sum+x*bitangents[i][k],0)<0?-1:1];
  });
}

export function fighterGlb(mesh, skeleton, png, frames = bindPose(mesh.vertices, skeleton, mesh.indices), { exactSkin = false, clips = [], staticMesh = false, materialMaps = null } = {}) {
  if(staticMesh&&clips.length)throw new Error('a static mesh cannot carry animation clips');
  if (!mesh.vertices.length || mesh.vertices.length > 65536 || !mesh.indices.length || mesh.indices.length % 3) throw new Error('empty, oversized or incomplete fighter mesh');
  if (mesh.indices.some((i) => !Number.isInteger(i) || i < 0 || i >= mesh.vertices.length)) throw new Error('fighter index out of bounds');
  const jointIds = skeleton.map((j) => j.joint);
  const jointSlot = new Map(jointIds.map((j, i) => [j, i]));
  const affine=clips.length>0&&clips[0].poses[0].tracks[jointIds[0]].post!==undefined;
  if (jointSlot.size !== skeleton.length) throw new Error('duplicate joint');
  const positions = mesh.vertices.map((v) => turn(bindPosition(v, frames)));
  const normals = mesh.vertices.map((v) => bindNormal(v, frames).map((n, c) => c === 0 ? n : -n));
  const chunks = [], views = [], accessors = [];
  let size = 0;
  const bytes = (data, target) => {
    const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const index = views.length;
    views.push({ buffer: 0, byteOffset: size, byteLength: b.length, ...(target ? { target } : {}) });
    chunks.push(b, Buffer.alloc((4 - b.length % 4) % 4));
    size += b.length + (4 - b.length % 4) % 4;
    return index;
  };
  const accessor = (rows, type, componentType = 5126, target, bounds = false) => {
    const data = componentType === 5123 ? new Uint16Array(rows.flat()) : new Float32Array(rows.flat());
    if (![...data].every(Number.isFinite)) throw new Error('nonfinite fighter attribute');
    const index = accessors.length;
    accessors.push({ bufferView: bytes(data, target), componentType, count: rows.length, type,
      ...(bounds ? { min: rows[0].map((_, c) => Math.min(...rows.map((p) => p[c]))), max: rows[0].map((_, c) => Math.max(...rows.map((p) => p[c]))) } : {}) });
    return index;
  };
  const joints = [], weights = [];
  const helpers = [];
  const shapeOf = new Map();
  mesh.shapes.forEach((group,g)=>group.vertices.forEach((v,k)=>shapeOf.set(v,{group:g,member:k})));
  const bindMatrices = jointIds.map((j) => glbMatrix(inverseFrame(frames[j])));
  let maxLocalResidualMm = 0;
  mesh.vertices.forEach((v, i) => {
    if (!v.influences.length || v.influences.length > 4) throw new Error('unsupported influence count');
    const js = [], ws = [];
    for (const [influence,f] of v.influences.entries()) {
      if (!jointSlot.has(f.joint) || !Number.isFinite(f.weight) || f.weight < 0) throw new Error('invalid skin influence');
      const inverse = inverseFrame(frames[f.joint]);
      const position = bindPosition(v, frames);
      const local = apply(inverse.r, position).map((x,c)=>x+inverse.t[c]);
      const residual = Math.hypot(...sub(local, f.point));
      maxLocalResidualMm = Math.max(maxLocalResidualMm, residual);
      let slot = jointSlot.get(f.joint);
      if (exactSkin && (residual > 1e-7 || shapeOf.has(i))) {
        slot = skeleton.length + helpers.length;
        helpers.push({ joint: f.joint, vertex: i, influence, form:shapeOf.get(i) });
        bindMatrices.push(glbMatrix({ r: inverse.r, t: sub(f.point, apply(inverse.r, position)) }));
      }
      js.push(slot); ws.push(f.weight);
    }
    if (Math.abs(ws.reduce((a, b) => a + b, 0) - 1) > 1e-6) throw new Error('skin weights must sum to one');
    while (js.length < 4) { js.push(0); ws.push(0); }
    joints.push(js); weights.push(ws);
  });
  if(bindMatrices.length>65536)throw new Error('skin joints do not fit u16 indices');
  const attributes = {
    POSITION: accessor(positions, 'VEC3', 5126, 34962, true),
    NORMAL: accessor(normals, 'VEC3', 5126, 34962),
    TEXCOORD_0: accessor(mesh.vertices.map((v) => [v.uv[0] / (8 * mesh.width), v.uv[1] / (8 * mesh.height)]), 'VEC2', 5126, 34962),
    ...(!staticMesh?{JOINTS_0:accessor(joints,'VEC4',5123,34962),WEIGHTS_0:accessor(weights,'VEC4',5126,34962)}:{}),
  };
  if(materialMaps!==null)attributes.TANGENT=accessor(surfaceTangents(mesh,positions,normals),'VEC4',5126,34962);
  const double = new Set(mesh.twoFaced ?? mesh.indices.map((_, i) => Math.floor(i / 3)));
  const hidden = new Set(mesh.pictures.slice(1).flat());
  const targetNames = [];
  const targets = (exactSkin||staticMesh?[]:mesh.shapes).flatMap((group) => group.shapes.map((shape, s) => {
    const delta = mesh.vertices.map(() => [0, 0, 0]);
    group.vertices.forEach((v, k) => {
      const vertex = mesh.vertices[v];
      const changed = { ...vertex, influences: vertex.influences.map((f, i) => ({ ...f, point: shape[k].points[i] })) };
      delta[v] = sub(turn(bindPosition(changed, frames)), positions[v]);
    });
    targetNames.push(`part_${group.part}_shape_${s}`);
    return { POSITION: accessor(delta, 'VEC3', 5126, 34962, true) };
  }));
  const primitives = [false, true].flatMap((twoSided, material) => {
    const indices = [];
    for (let t = 0; t < mesh.indices.length / 3; t++) if (!hidden.has(t) && double.has(t) === twoSided) indices.push(...mesh.indices.slice(t * 3, t * 3 + 3));
    return indices.length ? [{ attributes, indices: accessor(indices.map((i) => [i]), 'SCALAR', 5123, 34963), material, ...(targets.length ? { targets } : {}) }] : [];
  });
  const nodes = skeleton.map((j) => {
    const f = frames[j.joint];
    const local = relativeFrame(j.parent < 0 ? null : frames[j.parent], f);
    const children = affine?[jointSlot.get(j.joint)+skeleton.length]:skeleton.flatMap((child, i) => child.parent === j.joint ? [i] : []);
    const trs=affine?clips[0].poses[0].tracks[j.joint]:jointTrs(local);
    const {post,...pre}=trs;
    return { name: affine?`affine_${j.joint}`:`joint_${j.joint}`, ...(clips.length ? pre : {matrix:glbMatrix(local)}), ...(children.length ? { children } : {}) };
  });
  if(affine)for(const j of skeleton){
    nodes.push({name:`joint_${j.joint}`,...clips[0].poses[0].tracks[j.joint].post,children:skeleton.flatMap((child,i)=>child.parent===j.joint?[i]:[])});
  }
  const pointNodeStart=nodes.length;
  helpers.forEach(({joint,vertex},i)=>{
    const parent=nodes[jointSlot.get(joint)+(affine?skeleton.length:0)];
    (parent.children??=[]).push(nodes.length);
    nodes.push({name:`point_${vertex}_${joint}`,extras:{sourceJoint:joint}});
  });
  const inverseBindMatrices = staticMesh?null:accessor(bindMatrices, 'MAT4');
  const animations=clips.map((clip)=>{
    const samplers=[],channels=[];
    const input=accessor(clip.poses.map((_,i)=>[i/60]),'SCALAR',5126,undefined,true);
    for(const j of skeleton)for(const post of affine?[false,true]:[false]){
      for(const path of ['translation','rotation','scale']){
        const values=clip.poses.map(p=>(post?p.tracks[j.joint].post:p.tracks[j.joint])[path]);
        if(path==='rotation') for(let i=1;i<values.length;i++) if(values[i].reduce((s,x,c)=>s+x*values[i-1][c],0)<0) values[i]=values[i].map(x=>-x);
        const output=accessor(values,path==='rotation'?'VEC4':'VEC3');
        channels.push({sampler:samplers.length,target:{node:jointSlot.get(j.joint)+(post?skeleton.length:0),path}});
        samplers.push({input,output,interpolation:'STEP'});
      }
    }
    helpers.forEach((helper,h)=>{
      if(!helper.form)return;
      const {group,member}=helper.form;
      const point=mesh.vertices[helper.vertex].influences[helper.influence].point;
      const values=clip.poses.map(p=>{
        const selected=p.forms?.[group]??0;
        const shape=mesh.shapes[group].shapes[selected];
        if(!shape)throw new Error('invalid hand shape');
        return turn(sub(shape[member].points[helper.influence],point));
      });
      channels.push({sampler:samplers.length,target:{node:pointNodeStart+h,path:'translation'}});
      samplers.push({input,output:accessor(values,'VEC3'),interpolation:'STEP'});
    });
    return {name:clip.name,samplers,channels};
  });
  const imageView = bytes(png);
  const images = [{ bufferView: imageView, mimeType: 'image/png' }];
  if (materialMaps !== null) for (const map of [materialMaps.normal,materialMaps.orm]) images.push({bufferView:bytes(map),mimeType:'image/png'});
  nodes.push({ name: 'fighter', mesh: 0, skin: 0 });
  const gltf = {
    asset: { version: '2.0', generator: 'DriftEngine fighter exporter' },
    scene: 0, scenes: [{ nodes: staticMesh?[0]:[...skeleton.flatMap((j, i) => j.parent < 0 ? [i] : []), nodes.length - 1] }], nodes:staticMesh?[{name:'fighter_mesh',mesh:0}]:nodes,
    meshes: [{ primitives, ...(targets.length ? { weights: targets.map(() => 0), extras: { targetNames } } : {}) }],
    ...(!staticMesh?{skins:[{joints:[...jointIds.map((_,i)=>i+(affine?skeleton.length:0)),...helpers.map((_,i)=>pointNodeStart+i)],inverseBindMatrices}]}:{}),
    ...(animations.length?{animations}:{}),
    materials: [false, true].map((doubleSided) => ({ doubleSided, alphaMode: 'MASK', alphaCutoff: 0.5, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: materialMaps===null?0:1, roughnessFactor: 1, ...(materialMaps===null?{}:{metallicRoughnessTexture:{index:2}}) }, ...(materialMaps===null?{}:{normalTexture:{index:1,scale:.8},occlusionTexture:{index:2}}) })),
    textures: images.map((_,source)=>({source,sampler:0})), samplers: [{ magFilter: materialMaps===null?9728:9729, minFilter: materialMaps===null?9728:9987, wrapS: 33071, wrapT: 33071 }],
    images,
    accessors, bufferViews: views, buffers: [{ byteLength: size }],
    extras: { maxLocalResidualMm, auxiliarySkinJoints: helpers.length, affineNodes:affine?skeleton.length:0, skinning: staticMesh?'Static edit input; retain the animated reference locally.':exactSkin?'Auxiliary joints preserve independent joint-space points; affine nodes preserve blended-pose shear.':'Standard linear skinning is approximate for independent joint-space points.' },
  };
  const json = Buffer.from(JSON.stringify(gltf));
  const jsonPad = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + jsonPad.length + bin.length, 8);
  jh.writeUInt32LE(json.length + jsonPad.length); jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(bin.length); bh.writeUInt32LE(0x004e4942, 4);
  return { glb: Buffer.concat([header, jh, json, jsonPad, bh, bin]), maxLocalResidualMm, auxiliarySkinJoints:helpers.length };
}
