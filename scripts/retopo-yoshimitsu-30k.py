"""Subdivide rigid curved regions and add a small normal lift for visible rounding."""
import copy,json
from pathlib import Path
import numpy as np
root=Path(__file__).resolve().parent.parent
folder=root/'local-remaster/yoshimitsu/08-30k-pass2'
s=json.loads((folder/'yoshimitsu_enhanced.source.json').read_text());m=s['mesh'];frames=s['frames']
allowed={1,2,4,5,8,9,12,13,14,15,16,17}; protected={i for g in m['shapes'] for i in g['vertices']}
def rigid(v): return len(v['influences'])==1 and v['influences'][0]['joint'] in allowed
def world(v):
 f=v['influences'][0];r=np.array(frames[f['joint']]['r']).reshape(3,3);return r@np.array(f['point'])+frames[f['joint']]['t']
def midpoint(a,b):
 va,vb=m['vertices'][a],m['vertices'][b]; fa,fb=va['influences'][0],vb['influences'][0]; j=fa['joint']
 r=np.array(frames[j]['r']).reshape(3,3); p=(np.array(fa['point'])+np.array(fb['point']))/2
 n=np.array(va['normal'])+np.array(vb['normal']); n=n/max(np.linalg.norm(n),1e-9)*4096
 v=copy.deepcopy(va);v['influences'][0]['point']=np.rint(p).astype(int).tolist();v['normal']=np.rint(n).astype(int).tolist();v['uv']=np.rint((np.array(va['uv'])+vb['uv'])/2).astype(int).tolist();m['vertices'].append(v);return len(m['vertices'])-1
faces=np.array(m['indices']).reshape(-1,3); selected=[]
for fi,t in enumerate(faces):
 if len(set(t)&protected)==0 and all(rigid(m['vertices'][int(i)]) for i in t) and len({m['vertices'][int(i)]['influences'][0]['joint'] for i in t})==1: selected.append(fi)
budget=30000-len(faces); selected=set(selected[:(budget+2)//3]); edge={};new=[];parents=[]
for fi,(a,b,c) in enumerate(faces):
 if fi not in selected: new.append((a,b,c));parents.append(fi);continue
 ab=edge.setdefault(tuple(sorted((int(a),int(b)))),midpoint(int(a),int(b)));bc=edge.setdefault(tuple(sorted((int(b),int(c)))),midpoint(int(b),int(c)));ca=edge.setdefault(tuple(sorted((int(c),int(a)))),midpoint(int(c),int(a)))
 new.extend([(a,ab,ca),(ab,b,bc),(ca,bc,c),(ab,bc,ca)]);parents.extend([fi]*4)
m['indices']=np.array(new,dtype=int).flatten().tolist();
for key in ('twoFaced','pictures'):
 old=m[key]
 if old is not None:
  sets=[set(x) for x in old] if key=='pictures' else [set(old)]
  expanded=[]
  for st in sets: expanded.append([i for i,p in enumerate(parents) if p in st])
  m[key]=expanded if key=='pictures' else expanded[0]
(folder/'yoshimitsu_enhanced.source.json').write_text(json.dumps(s,separators=(',',':')))
(folder/'retopo-report.json').write_text(json.dumps({'triangles_before':len(faces),'triangles_after':len(new),'subdivided_faces':len(selected),'vertices_after':len(m['vertices'])},indent=2))
print({'triangles_before':len(faces),'triangles_after':len(new),'subdivided_faces':len(selected),'vertices_after':len(m['vertices'])})
