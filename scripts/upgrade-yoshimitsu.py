"""Build the complete local fighter appearance with CPU mesh and material processing."""
import copy
import importlib.util
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

spec=importlib.util.spec_from_file_location('mesh_tools',Path(__file__).with_name('enhance-yoshimitsu.py'))
base=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def body_delta(joint,point):
    p=np.array(point,dtype=float)
    delta=np.zeros(3)
    if joint==1:
        chest=np.exp(-((p[0]-370)/105)**2)
        waist=np.exp(-((p[0]-155)/65)**2)
        delta[1:]=p[1:]*(.065*chest-.055*waist)
    elif joint in (4,5,8,9,12,13,15,16):
        length=293 if joint in (4,8) else 286 if joint in (5,9) else 431
        taper=np.sin(np.pi*np.clip(p[0]/length,0,1))**2
        amount=.12 if joint in (4,8,13,16) else .09
        delta[1:]=p[1:]*amount*taper
    elif joint in (14,17):
        taper=np.clip(np.linalg.norm(p)/90,0,1)
        delta[1:]=p[1:]*.075*taper
    return delta


def geometry(source,positions,normals,triangles):
    mesh,frames=source['mesh'],source['frames']
    original=copy.deepcopy(mesh['vertices'])
    protected={i for g in mesh['shapes'] for i in g['vertices']}
    groups={}
    for i,p in enumerate(positions): groups.setdefault(tuple(np.round(p,5)),[]).append(i)
    members=list(groups.values())
    slots={i:g for g,ids in enumerate(members) for i in ids}
    shifts=np.zeros((len(members),3))
    for g,ids in enumerate(members):
        if protected.intersection(ids): continue
        shifts[g]=np.mean([sum((np.array(frames[f['joint']]['r']).reshape(3,3)@body_delta(f['joint'],f['point']))*f['weight'] for f in original[i]['influences'])*[.001,-.001,-.001] for i in ids],axis=0)
    original_faces=np.cross(positions[triangles[:,1]]-positions[triangles[:,0]],positions[triangles[:,2]]-positions[triangles[:,0]])
    strength=np.ones(len(members))
    edited=positions.copy()
    for _ in range(64):
        for g,ids in enumerate(members):
            if not np.any(shifts[g]): continue
            for i in ids:
                world=np.zeros(3)
                for k,f in enumerate(original[i]['influences']):
                    frame=frames[f['joint']]
                    r=np.array(frame['r']).reshape(3,3)
                    delta=np.rint(np.linalg.solve(r,shifts[g]*strength[g]*[1000,-1000,-1000])).astype(int)
                    point=np.array(f['point'])+delta
                    mesh['vertices'][i]['influences'][k]['point']=point.tolist()
                    world+=(r@point+frame['t'])*f['weight']
                edited[i]=world*[.001,-.001,-.001]
        faces=np.cross(edited[triangles[:,1]]-edited[triangles[:,0]],edited[triangles[:,2]]-edited[triangles[:,0]])
        bad=(np.sum(original_faces*faces,axis=1)<=0)|(np.linalg.norm(faces,axis=1)<.35*np.linalg.norm(original_faces,axis=1))
        if not np.any(bad): break
        for g in {slots[int(i)] for i in triangles[bad].flatten()}: strength[g]*=.5
    else: raise ValueError('body proportions cannot preserve valid faces')
    # Average geometric surface normals across texture splits, retaining dihedral creases.
    incident=[set() for _ in members]
    own=[[] for _ in original]
    for fi,face in enumerate(triangles):
        for i in face:
            incident[slots[int(i)]].add(fi)
            own[int(i)].append(fi)
    face_normals=base.unit(faces)
    updated=normals.copy()
    for i,v in enumerate(mesh['vertices']):
        if i in protected or any(f['joint'] in (6,10) for f in v['influences']): continue
        axis=base.unit(np.sum(faces[own[i]],axis=0))
        candidates=[f for f in incident[slots[i]] if np.dot(face_normals[f],axis)>.64]
        if candidates: updated[i]=base.unit(np.sum(faces[candidates],axis=0))
        r=np.array(frames[v['normalJoint']]['r']).reshape(3,3)
        v['normal']=np.rint(base.unit(np.linalg.solve(r,updated[i]*[1,-1,-1]))*4096).astype(int).tolist()
    assert all(mesh['vertices'][i]==original[i] for i in protected)
    assert all(v['uv']==original[i]['uv'] and [(f['joint'],f['weight']) for f in v['influences']]==[(f['joint'],f['weight']) for f in original[i]['influences']] for i,v in enumerate(mesh['vertices']))
    moved=np.linalg.norm(edited-positions,axis=1)>1e-6
    return edited,updated,dict(moved_vertices=int(moved.sum()),max_body_displacement_mm=float(np.linalg.norm(edited-positions,axis=1).max()*1000),normals_changed=int(np.sum(np.linalg.norm(updated-normals,axis=1)>.001)),min_face_area_ratio=float(np.min(np.linalg.norm(faces,axis=1)/np.linalg.norm(original_faces,axis=1))),flipped_faces=0,degenerate_faces=0,regions={str(j):sum(bool(moved[i]) and max(v['influences'],key=lambda f:f['weight'])['joint']==j for i,v in enumerate(original)) for j in (1,4,5,8,9,12,13,14,15,16,17)})


def materials(mesh,original_texture,output):
    # Joint coverage keeps trouser recoloring away from silver greaves and the mask.
    layers={name:Image.new('L',(512,512)) for name in ('body','trousers','blade')}
    drawers={name:ImageDraw.Draw(im) for name,im in layers.items()}
    for face in np.array(mesh['indices']).reshape(-1,3):
        vertices=[mesh['vertices'][i] for i in face]
        js=[max(v['influences'],key=lambda f:f['weight'])['joint'] for v in vertices]
        above_knee=np.mean([max(v['influences'],key=lambda f:f['weight'])['point'][0] for v in vertices])<310
        label='trousers' if all(j in (12,15) for j in js) and above_knee else 'blade' if all(j==10 for j in js) else 'body'
        drawers[label].polygon([tuple(c/8 for c in v['uv']) for v in vertices],fill=255)
    coverage={k:np.array(im.filter(ImageFilter.MaxFilter(3)),dtype=float)/255 for k,im in layers.items()}
    rgb=np.array(original_texture.convert('RGB'),dtype=float)/255
    lum=rgb@np.array([.2126,.7152,.0722])
    chroma=rgb.max(2)-rgb.min(2)
    metal=np.clip((lum-.19)/.24,0,1)*np.clip(1-chroma/.30,0,1)*coverage['body']
    gold=np.clip((lum-.30)/.24,0,1)*np.clip(1-chroma/.35,0,1)*coverage['trousers']*(1-coverage['body'])
    rgb=rgb*(1-gold[:,:,None])+lum[:,:,None]*np.array([1.15,.79,.30])*gold[:,:,None]
    # Keep the original painting; use its broad contrast for a shallow surface relief only.
    gray=Image.fromarray(np.uint8(np.clip(lum*255,0,255)))
    soft=np.array(gray.filter(ImageFilter.GaussianBlur(1.4)),dtype=float)/255
    height=(lum-soft)*metal*.6
    height_image=Image.fromarray(np.uint8(np.clip(.5+height,0,1)*255)).resize((2048,2048),Image.Resampling.BICUBIC)
    h=np.array(height_image,dtype=float)/255
    dy,dx=np.gradient(h)
    normal=base.unit(np.stack((-dx*5,-dy*5,np.ones_like(dx)),axis=-1))
    normal=np.uint8(np.clip(normal*.5+.5,0,1)*255)
    Image.fromarray(normal).save(output/'yoshimitsu.normal.png')
    orm=np.stack((np.ones_like(lum),.88-.26*metal-.30*gold,.23*metal+.35*gold),axis=-1)
    Image.fromarray(np.uint8(np.clip(orm,0,1)*255)).resize((2048,2048),Image.Resampling.BILINEAR).save(output/'yoshimitsu.orm.png')
    texture=Image.fromarray(np.uint8(np.clip(rgb,0,1)*255)).resize((2048,2048),Image.Resampling.LANCZOS)
    texture=texture.filter(ImageFilter.UnsharpMask(radius=.9,percent=65,threshold=3)).convert('RGBA')
    texture.putalpha(original_texture.convert('RGBA').getchannel('A').resize((2048,2048),Image.Resampling.LANCZOS))
    texture.save(output/'yoshimitsu_diffuse_2k.png')
    return dict(texture_size=[2048,2048],material_maps=['normal','occlusion-roughness-metallic'],gold_pattern_pixels=int(np.sum(gold>.1)),metal_pixels=int(np.sum(metal>.1)),method='original atlas painting retained, olive gold tint and separate material response; no generated detail')


if __name__=='__main__':
    root=Path(__file__).resolve().parent.parent
    before=root/'local-remaster/yoshimitsu/08-video-refined'
    output=root/'local-remaster/yoshimitsu/08-complete'
    output.mkdir(exist_ok=False)
    source=json.loads((before/'yoshimitsu_enhanced.source.json').read_text())
    doc,binary=base.read_glb(before/'yoshimitsu_enhanced.glb')
    attrs=doc['meshes'][0]['primitives'][0]['attributes']
    p=base.attribute(doc,binary,attrs['POSITION'])
    n=base.attribute(doc,binary,attrs['NORMAL'])
    triangles=np.concatenate([base.attribute(doc,binary,pr['indices']).reshape(-1,3) for pr in doc['meshes'][0]['primitives']])
    edited,normals,report=geometry(source,p.astype(float),n.astype(float),triangles)
    report.update(materials(source['mesh'],Image.open(root/'public/data/fighters/08.png'),output))
    (output/'yoshimitsu_enhanced.source.json').write_text(json.dumps(source,separators=(',',':')))
    report.update(triangles=len(triangles),vertices=len(p),hitboxes='unchanged',gameplay_rig='original 18 joints',uvs_and_weights='unchanged',hand_shape_points='unchanged',sword_geometry='unchanged')
    (output/'refinement.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
