/** Affine frames and glTF joint tracks, in game coordinates. */
import { apply, mul, sub } from './round/vec.mjs';
import { symmetricEigen } from './round/bind.mjs';

export function inverseFrame({ r, t }) {
  const [a,b,c,d,e,f,g,h,i] = r;
  const q = [e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
  const determinant = a*q[0]+b*q[3]+c*q[6];
  if (Math.abs(determinant) < 1e-10) throw new Error('singular joint frame');
  const rotation = q.map((x) => x/determinant);
  return { r: rotation, t: apply(rotation,t).map((x) => -x) };
}

export function relativeFrame(parent, child) {
  if (!parent) return child;
  const inverse = inverseFrame(parent);
  return { r: mul(inverse.r,child.r), t: apply(inverse.r,sub(child.t,parent.t)) };
}

export const glbPoint = ([x,y,z]) => [x/1000,-y/1000,-z/1000];
export const glbMatrix = ({r,t}) => [r[0],-r[3],-r[6],0,-r[1],r[4],r[7],0,-r[2],r[5],r[8],0,...glbPoint(t),1];

/** Rigid approximation for glTF's animated quaternion joints; keep the error measurable. */
export function jointTrs(frame) {
  const m = glbMatrix(frame);
  const x = [m[0],m[1],m[2]], y = [m[4],m[5],m[6]];
  const norm = (v) => { const n=Math.hypot(...v); return v.map((c)=>c/n); };
  const u=norm(x), dot=u.reduce((s,c,i)=>s+c*y[i],0), v=norm(y.map((c,i)=>c-dot*u[i]));
  const w=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const r=[u[0],v[0],w[0],u[1],v[1],w[1],u[2],v[2],w[2]];
  const q=[0,0,0,0], trace=r[0]+r[4]+r[8];
  if(trace>0){const s=Math.sqrt(trace+1)*2;q[3]=s/4;q[0]=(r[7]-r[5])/s;q[1]=(r[2]-r[6])/s;q[2]=(r[3]-r[1])/s;}
  else {
    const k=r[0]>r[4]?(r[0]>r[8]?0:2):(r[4]>r[8]?1:2), a=(k+1)%3,b=(k+2)%3;
    const s=Math.sqrt(1+r[k*3+k]-r[a*3+a]-r[b*3+b])*2;
    q[k]=s/4;q[3]=(r[b*3+a]-r[a*3+b])/s;q[a]=(r[a*3+k]+r[k*3+a])/s;q[b]=(r[b*3+k]+r[k*3+b])/s;
  }
  const scale=[Math.hypot(...x),y.reduce((s,c,i)=>s+c*v[i],0),[m[8],m[9],m[10]].reduce((s,c,i)=>s+c*w[i],0)];
  return { translation:glbPoint(frame.t), rotation:norm(q), scale };
}

export function frameFromTrs({translation,rotation:[x,y,z,w],scale=[1,1,1]}) {
  const r=[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)];
  return {r:r.map((c,i)=>([1,2,3,6].includes(i)?-c:c)*scale[i%3]),t:[translation[0]*1000,-translation[1]*1000,-translation[2]*1000]};
}

export function rigidPose(skeleton, frames) {
  const out=[], tracks=[];
  const solve=(joint)=>{
    if(out[joint]) return out[joint];
    const node=skeleton.find((j)=>j.joint===joint);
    if(!node) throw new Error('missing skeleton joint');
    const parent=node.parent<0?null:solve(node.parent);
    const local=relativeFrame(node.parent<0?null:frames[node.parent],frames[joint]);
    const trs=jointTrs(local); tracks[joint]=trs;
    const f=frameFromTrs(trs);
    return out[joint]=parent?{r:mul(parent.r,f.r),t:apply(parent.r,f.t).map((x,i)=>x+parent.t[i])}:f;
  };
  skeleton.forEach((j)=>solve(j.joint));
  return {frames:out,tracks};
}

/** Two glTF TRS nodes retain a joint's full affine transform, including blended-pose shear. */
export function affinePose(skeleton, frames) {
  const tracks=[];
  const det=r=>r[0]*(r[4]*r[8]-r[5]*r[7])-r[1]*(r[3]*r[8]-r[5]*r[6])+r[2]*(r[3]*r[7]-r[4]*r[6]);
  const transpose=r=>[r[0],r[3],r[6],r[1],r[4],r[7],r[2],r[5],r[8]];
  for(const node of skeleton){
    const f=relativeFrame(node.parent<0?null:frames[node.parent],frames[node.joint]);
    const ata=mul(transpose(f.r),f.r);
    const eigen=symmetricEigen([ata.slice(0,3),ata.slice(3,6),ata.slice(6,9)]);
    const v=eigen.vectors.flat(),scale=eigen.values.map(x=>Math.sqrt(Math.max(0,x)));
    if(scale.some(x=>x<1e-8))throw new Error('singular animated joint');
    if(det(v)<0) for(let row=0;row<3;row++)v[row*3]=-v[row*3];
    const u=mul(f.r,v).map((x,i)=>x/scale[i%3]);
    if(det(u)<0){for(let row=0;row<3;row++)u[row*3]=-u[row*3];scale[0]=-scale[0];}
    const pre=jointTrs({r:u,t:f.t});pre.scale=scale;
    const post=jointTrs({r:transpose(v),t:[0,0,0]});post.scale=[1,1,1];
    tracks[node.joint]={...pre,post};
  }
  return {frames,tracks};
}
