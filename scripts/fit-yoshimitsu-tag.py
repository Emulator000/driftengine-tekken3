"""Prepare a locally supplied OBJ fighter on the existing gameplay point skin."""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
import numpy as np
from PIL import Image


def unit(a):
    a=np.asarray(a,dtype=float)
    return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-12)


def read_obj(path):
    positions=[]; normals=[]; uvs=[]; faces=[]; material=None; group=-1
    for line in path.read_text().splitlines():
        a=line.split()
        if not a: continue
        if a[0]=='v': positions.append(list(map(float,a[1:4])))
        elif a[0]=='vn': normals.append(list(map(float,a[1:4])))
        elif a[0]=='vt': uvs.append(list(map(float,a[1:3])))
        elif a[0]=='g': group+=1
        elif a[0]=='usemtl': material=a[1]
        elif a[0]=='f':
            corners=[]
            for token in a[1:]:
                v,t,n=map(int,token.split('/'))
                corners.append((v-1 if v>0 else len(positions)+v,t-1 if t>0 else len(uvs)+t,n-1 if n>0 else len(normals)+n))
            for k in range(1,len(corners)-1): faces.append({'corners':[corners[0],corners[k],corners[k+1]],'material':material,'group':group})
    p,n,t=map(np.array,(positions,normals,uvs))
    assert np.isfinite(p).all() and np.isfinite(n).all() and np.isfinite(t).all()
    return p,n,t,faces


def clean_faces(p,n,t,faces):
    kept=[]; seen=set(); geometry=set(); duplicate=degenerate=geometric_overlap=0
    for face in faces:
        ids=[c[0] for c in face['corners']]
        if np.linalg.norm(np.cross(p[ids[1]]-p[ids[0]],p[ids[2]]-p[ids[0]]))<1e-8:
            degenerate+=1; continue
        corners=[(tuple(p[v]),tuple(t[uv]),tuple(n[nr])) for v,uv,nr in face['corners']]
        # Retain opposite-facing shells and different-material overlays.
        key=(face['material'],min(tuple(corners[k:]+corners[:k]) for k in range(3)))
        if key in seen: duplicate+=1; continue
        seen.add(key)
        gkey=tuple(sorted(tuple(p[i]) for i in ids))
        geometric_overlap+=gkey in geometry; geometry.add(gkey)
        kept.append(face)
    return kept,{'raw_triangles':len(faces),'exact_duplicate_faces_removed':duplicate,'degenerate_faces_removed':degenerate,'coincident_geometry_with_distinct_surface_attributes':geometric_overlap,'clean_triangles':len(kept)}


def soften_shoulders(p,n,faces):
    selected={tuple(p[v]) for f in faces if f['material'].endswith(('_13','_11')) for v,_,_ in f['corners'] if abs(p[v,0])>(110 if f['material'].endswith('_11') else 180) and p[v,1]>465}
    edited=p.copy(); derivatives={}
    for i,point in enumerate(p):
        if tuple(point) not in selected:continue
        h=(point[1]-465)/12
        edited[i,1]=465+12*np.tanh(h)
        derivatives[i]=max(.025,1-np.tanh(h)**2)
    normals=n.tolist();mapped={}
    for face in faces:
        corners=[]
        for vi,uv,ni in face['corners']:
            if vi in derivatives:
                key=(vi,ni)
                if key not in mapped:
                    mapped[key]=len(normals)
                    normal=n[ni].copy();normal[1]/=derivatives[vi]
                    normals.append(unit(normal).tolist())
                ni=mapped[key]
            corners.append((vi,uv,ni))
        face['corners']=corners
    return edited,np.array(normals),{'vertices_lowered':len(derivatives),'max_tip_lowering_mm':float(np.max(p[:,1]-edited[:,1]))}


def atlas(path,t,faces,output):
    names=sorted({f['material'] for f in faces})
    width,height=2048,2048;tile=256
    image=Image.new('RGBA',(width,height),(32,32,32,255)); rects={}
    for i,name in enumerate(names):
        used=np.array([t[c[1]] for f in faces if f['material']==name for c in f['corners']])
        low=np.minimum(used.min(0),[0,0])-.025;high=np.maximum(used.max(0),[1,1])+.025
        original=np.array(Image.open(path.parent/(name+'.png')).convert('RGB'))
        yy,xx=np.mgrid[0:tile,0:tile]
        u=low[0]+(xx+.5)/tile*(high[0]-low[0]);v=high[1]-(yy+.5)/tile*(high[1]-low[1])
        pixels=original[(np.mod(1-v,1)*original.shape[0]).astype(int),(np.mod(u,1)*original.shape[1]).astype(int)]
        x,y=(i%8)*tile,(i//8)*tile
        image.paste(Image.fromarray(pixels),(x,y))
        rects[name]=(x,y,low,high)
    image.save(output/'yoshimitsu_diffuse.png')
    def remap(name,uv):
        x,y,low,high=rects[name]
        q=(uv-low)/(high-low)
        return np.rint([(x+q[0]*tile)*8,(y+(1-q[1])*tile)*8]).astype(int).tolist()
    return remap


def canonical():
    torso=np.array([[0,0,1],[1,0,0],[0,1,0]],dtype=float)
    leg=np.array([[0,0,1],[-1,0,0],[0,-1,0]],dtype=float)
    head=np.array([[0,1,0],[0,0,1],[1,0,0]],dtype=float)
    foot=np.array([[0,0,1],[0,-1,0],[1,0,0]],dtype=float)
    origins={0:[0,0,0],1:[0,0,0],2:[0,410,0],11:[0,0,0]}
    bases={0:torso,1:torso,2:head,11:leg}
    scales={0:[1,1,1],1:[442/410,.95,.85],2:[1.0,1.05,.95],11:[1,.95,.88]}
    for sign,joints in [(-1,(3,4,5,6,12,13,14)),(1,(7,8,9,10,15,16,17))]:
        a,b,c,d,thigh,shin,boot=joints
        arm=np.array([[sign,0,0],[0,0,sign],[0,-1,0]],dtype=float)
        for j,origin,scale in [(a,[sign*120,365,0],[137/185,1,1]),(b,[sign*300,410,0],[293/255,1,1]),(c,[sign*555,410,0],[286/250,1,1]),(d,[sign*805,410,0],[.92,1,1])]:
            origins[j]=origin;bases[j]=arm;scales[j]=scale
        for j,origin,basis,scale in [(thigh,[sign*110,-156,0],leg,[431/464,.95,.9]),(shin,[sign*110,-620,0],leg,[431/380,.95,.9]),(boot,[sign*110,-1000,0],foot,[1,.9,.9])]:
            origins[j]=origin;bases[j]=basis;scales[j]=scale
    return {j:(np.array(origins[j]),bases[j],np.array(scales[j])) for j in range(18)}


def weights(p,is_head=False,is_sword=False):
    x,y,z=p; side=1 if x>=0 else -1;ax=abs(x)
    if is_sword:return {10:1.}
    if is_head or (y>350 and ax<230):
        q=np.clip((y-350)/150,0,1);q=q*q*(3-2*q)
        if is_head:q=max(q,np.clip((z-60)/70,0,1)*np.clip((y-330)/70,0,1))
        return {1:1-q,2:q}
    if ax>265 and y>250:
        a,b,c,d=(3,4,5,6) if side<0 else (7,8,9,10)
        if ax<330: q=np.clip((ax-265)/65,0,1);return {a:1-q,b:q}
        if ax<510:return {b:1.}
        if ax<600:q=(ax-510)/90;return {b:1-q,c:q}
        if ax<770:return {c:1.}
        if ax<815:q=(ax-770)/45;return {c:1-q,d:q}
        return {d:1.}
    if y>400 and ax<160 and z>50:
        q=np.clip((y-400)/100,0,1);return {1:1-q,2:q}
    if y>25:return {1:1.}
    if y>-80:q=np.clip((25-y)/105,0,1);return {1:1-q,11:q}
    thigh,shin,foot=(12,13,14) if side<0 else (15,16,17)
    if y>-200:q=np.clip((-y-80)/120,0,1);return {11:1-q,thigh:q}
    if y>=-570:
        # Continuous inner-cloth weights avoid a hard left/right split at the crotch.
        right=np.clip((x+70)/140,0,1);right=right*right*(3-2*right)
        center=.95*(1-np.clip(ax/95,0,1)**1.5)
        return {11:center,12:(1-center)*(1-right),15:(1-center)*right}
    if y>-680:q=(-y-570)/110;return {thigh:1-q,shin:q}
    if y>-960:return {shin:1.}
    if y>-1020:q=(-y-960)/60;return {shin:1-q,foot:q}
    return {foot:1.}


def hand_shapes(mesh,original,frames):
    def position(v,points=None):
        return sum((np.array(frames[f['joint']]['r']).reshape(3,3)@point+frames[f['joint']]['t'])*f['weight'] for f,point in zip(v['influences'],points if points is not None else [a['point'] for a in v['influences']]))
    groups=[]
    for old in original['shapes']:
        members=[i for i,v in enumerate(mesh['vertices']) if any(f['joint']==6 for f in v['influences'])]
        reference=np.array([position(original['vertices'][i],old['shapes'][0][at]['points']) for at,i in enumerate(old['vertices'])])
        target=np.array([position(mesh['vertices'][i]) for i in members])
        distances=np.linalg.norm(target[:,None,:]-reference[None,:,:],axis=2)
        nearest=np.argsort(distances,axis=1)[:,:4]
        w=1/np.maximum(np.take_along_axis(distances,nearest,axis=1),2)**2;w/=w.sum(1,keepdims=True)
        forms=[]
        for old_form in old['shapes']:
            delta=np.array([position(original['vertices'][i],old_form[at]['points']) for at,i in enumerate(old['vertices'])])-reference
            movements=np.sum(delta[nearest]*w[:,:,None],axis=1)
            form=[]
            for k,i in enumerate(members):
                v=mesh['vertices'][i]
                points=[(np.array(f['point'])+np.rint(np.linalg.solve(np.array(frames[f['joint']]['r']).reshape(3,3),movements[k])).astype(int)).tolist() for f in v['influences']]
                form.append({'points':points,'normal':v['normal']})
            forms.append(form)
        groups.append({'part':old['part'],'steps':old['steps'],'vertices':members,'shapes':forms})
    return groups


def fit(path,baseline,output,static=False):
    p,n,t,raw=read_obj(path);faces,report=clean_faces(p,n,t,raw)
    if not static:p,n,report['shoulder_softening']=soften_shoulders(p,n,faces)
    source=baseline; original=source.get('mesh'); frames=source['frames']; transforms=canonical()
    remap=atlas(path,t,faces,output)
    head_materials={'yosi1u_'+str(i) for i in (14,17,18,19,21)}
    heads={tuple(p[c[0]]) for f in faces if f['material'] in head_materials for c in f['corners']}
    vertices=[]; indices=[]; lookup={}
    for face in faces:
        for vi,ti,ni in face['corners']:
            key=(vi,ti,ni,face['material'])
            if key not in lookup:
                influences=[]; normal=np.zeros(3)
                ws=weights(p[vi],tuple(p[vi]) in heads,face['material']=='yosi1u_20')
                ws={j:w for j,w in ws.items() if w>.001}
                # Quantize to the same byte weights used by the runtime.
                total=sum(ws.values());iw={j:max(1,int(round(w/total*255))) for j,w in ws.items()}
                iw[max(iw,key=iw.get)]+=255-sum(iw.values());total=255
                for j,byte in iw.items():
                    origin,basis,scale=transforms[j]
                    local=(basis.T@(p[vi]-origin))*scale
                    if j==11 and p[vi][1]<-220:
                        local[0]=220+(-p[vi][1]-220)*.25
                    local=np.rint(local).astype(int)
                    r=np.array(frames[j]['r']).reshape(3,3)
                    weight=byte/total
                    influences.append({'joint':j,'weight':weight,'point':local.tolist()})
                    normal+=r@unit((basis.T@n[ni])/scale)*weight
                joint=max(iw,key=iw.get);r=np.array(frames[joint]['r']).reshape(3,3)
                v={'influences':influences,'normalJoint':joint,'normal':np.rint(unit(np.linalg.solve(r,unit(normal)))*4096).astype(int).tolist(),'uv':remap(face['material'],t[ti])}
                if static:
                    v['influences']=[{'joint':0,'weight':1,'point':np.rint(p[vi]*[1,-1,-1]).astype(int).tolist()}]
                    v['normalJoint']=0;v['normal']=np.rint(n[ni]*[1,-1,-1]*4096).astype(int).tolist()
                lookup[key]=len(vertices);vertices.append(v)
            indices.append(lookup[key])
    mesh={'version':6,'width':2048,'height':2048,'garment':0,'vertices':vertices,'indices':indices,'shapes':[],'pictures':[],'twoFaced':list(range(len(faces)))}
    source['mesh']=mesh
    if static:
        source['frames']=[{'r':np.eye(3).flatten().tolist(),'t':[0,0,0]} for _ in range(18)]
        source['clips']=[]
    else:
        mesh['shapes']=hand_shapes(mesh,original,frames)
        assert all(len(pose['forms'])==len(mesh['shapes']) for clip in source['clips'] for pose in clip['poses'])
    assert len(vertices)<65535 and len(faces)<15000
    assert all(abs(sum(f['weight'] for f in v['influences'])-1)<1e-10 for v in vertices)
    assert all(-32768<=x<=32767 for v in vertices for f in v['influences'] for x in f['point'])
    report.update(vertices=len(vertices),fitted_triangles=len(faces),hand_shapes=[{'part':g['part'],'vertices':len(g['vertices']),'forms':len(g['shapes'])} for g in mesh['shapes']],joint_usage=dict(Counter(f['joint'] for v in vertices for f in v['influences'])),source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),static=static)
    (output/'yoshimitsu_tag.source.json').write_text(json.dumps(source,separators=(',',':')))
    (output/'mesh-report.json').write_text(json.dumps(report,indent=2))
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('obj',type=Path);parser.add_argument('output',type=Path);parser.add_argument('--static',action='store_true');args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=False)
    baseline=json.loads(Path('local-remaster/yoshimitsu/08-ready/yoshimitsu_rounded.source.json').read_text())
    print(json.dumps(fit(args.obj,baseline,args.output,args.static),indent=2))
