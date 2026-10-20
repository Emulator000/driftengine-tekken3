"""Adjust rigid surfaces of a local fitted mesh."""
import copy
import importlib.util
import json
import shutil
from pathlib import Path
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('refinement', Path(__file__).with_name('enhance-yoshimitsu.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def sculpt(source, positions, normals, triangles, atlas):
    vertices, frames = source['mesh']['vertices'], source['frames']
    original = copy.deepcopy(vertices)
    protected = {v for g in source['mesh']['shapes'] for v in g['vertices']}
    groups = {}
    for i, p in enumerate(positions):
        groups.setdefault(tuple(np.round(p, 6)), []).append(i)
    keys = list(groups)
    members = list(groups.values())
    slot = {v:g for g, ids in enumerate(members) for v in ids}
    neighbors = [set() for _ in members]
    for a,b,c in triangles:
        for x,y in ((a,b),(b,c),(c,a)):
            if slot[x] != slot[y]:
                neighbors[slot[x]].add(slot[y])
                neighbors[slot[y]].add(slot[x])
    shifts, labels, joints = np.zeros((len(members),3)), [], []
    for g, ids in enumerate(members):
        fs = [vertices[i]['influences'] for i in ids]
        js = {f[0]['joint'] for f in fs}
        eligible = not protected.intersection(ids) and all(len(f)==1 for f in fs) and len(js)==1
        joint = next(iter(js)) if eligible else -1
        joints.append(joint)
        label = 'unchanged'
        if joint == 2:
            p = np.array(fs[0][0]['point'],dtype=float)
            if p[2] > 140:
                # Lower the dome and broaden the flange.
                t = np.clip((p[2]-140)/100,0,1)
                t = t*t*(3-2*t)
                local = np.array([0, p[1]*.045*t, -(p[2]-140)*.19*t])
                shifts[g] = (np.array(frames[joint]['r']).reshape(3,3) @ local)*[.001,-.001,-.001]
                label = 'crest-profile'
        elif joint in (1,4,5,8,9):
            colors = []
            for i in ids:
                u,v = vertices[i]['uv']
                x = min(atlas.shape[1]-1,int(u/(8*source['mesh']['width'])*atlas.shape[1]))
                y = min(atlas.shape[0]-1,int(v/(8*source['mesh']['height'])*atlas.shape[0]))
                colors.append(atlas[max(0,y),max(0,x),:3]/255)
            color = np.mean(colors,axis=0)
            metal = np.clip(1-(color.max()-color.min())/.22,0,1)*np.clip((color.mean()-.12)/.25,0,1)
            point = np.array(fs[0][0]['point'])
            envelope = np.clip((point[0]-220)/65,0,1) if joint==1 else 1
            amount = (.012 if joint==1 else .010 if joint in (4,8) else .006)*metal*envelope
            shifts[g] = base.unit(normals[ids].mean(0))*amount
            label = 'armor-volume'
        labels.append(label)
    # Average only within the same selected surface, and taper into unchanged skin seams.
    for _ in range(5):
        smoothed = shifts.copy()
        for g, near in enumerate(neighbors):
            if labels[g]!='armor-volume' or not near:
                continue
            compatible = [h for h in near if joints[h]==joints[g]]
            if compatible:
                smoothed[g] = .5*shifts[g]+.5*shifts[compatible].mean(0)
            if any(joints[h]!=joints[g] for h in near):
                smoothed[g] *= .5
        shifts = smoothed
    before = np.cross(positions[triangles[:,1]]-positions[triangles[:,0]],positions[triangles[:,2]]-positions[triangles[:,0]])
    strength = np.ones(len(members))
    edited = positions.copy()
    local_shifts = {}
    for attempt in range(64):
        for g,ids in enumerate(members):
            if not np.any(shifts[g]): continue
            joint = joints[g]
            r = np.array(frames[joint]['r']).reshape(3,3)
            delta = np.rint(np.linalg.solve(r,shifts[g]*strength[g]*[1000,-1000,-1000])).astype(int)
            for i in ids:
                point = np.array(original[i]['influences'][0]['point'])+delta
                vertices[i]['influences'][0]['point'] = point.tolist()
                edited[i] = (r@point+frames[joint]['t'])*[.001,-.001,-.001]
                local_shifts[i] = delta
        after = np.cross(edited[triangles[:,1]]-edited[triangles[:,0]],edited[triangles[:,2]]-edited[triangles[:,0]])
        bad = (np.sum(before*after,axis=1)<=0)|(np.linalg.norm(after,axis=1)<.3*np.linalg.norm(before,axis=1))
        if not np.any(bad): break
        for g in {slot[int(i)] for i in triangles[bad].flatten()}:
            strength[g] *= .5
    else: raise ValueError('sculpt cannot preserve face orientation')
    updated_normals = base.transported_normals(positions,edited,triangles,normals)
    moved = np.linalg.norm(edited-positions,axis=1)>.000001
    updated_normals[~moved]=normals[~moved]
    for i in np.where(moved)[0]:
        v = vertices[i]
        r = np.array(frames[v['normalJoint']]['r']).reshape(3,3)
        v['normal']=np.rint(base.unit(np.linalg.solve(r,updated_normals[i]*[1,-1,-1]))*4096).astype(int).tolist()
    assert all(vertices[i]==original[i] for i in protected)
    assert all(v['uv']==original[i]['uv'] and [(f['joint'],f['weight']) for f in v['influences']]==[(f['joint'],f['weight']) for f in original[i]['influences']] for i,v in enumerate(vertices))
    assert np.all(np.isfinite(edited))
    report = dict(triangles=len(triangles),vertices=len(vertices),moved_vertices=int(moved.sum()),max_displacement_mm=float(np.linalg.norm(edited-positions,axis=1).max()*1000),regions={label:sum(bool(moved[i]) for g,ids in enumerate(members) if labels[g]==label for i in ids) for label in ('crest-profile','armor-volume')},flipped_faces=0,degenerate_faces=0,min_face_area_ratio=float(np.min(np.linalg.norm(after,axis=1)/np.linalg.norm(before,axis=1))),hand_shapes_unchanged=True,weights_and_uvs_unchanged=True)
    return edited,updated_normals,report


if __name__=='__main__':
    root=Path(__file__).resolve().parent.parent
    before=root/'local-remaster/yoshimitsu/08-hd-pass'
    output=root/'local-remaster/yoshimitsu/08-video-refined'
    output.mkdir(exist_ok=False)
    source=json.loads((before/'yoshimitsu_enhanced.source.json').read_text())
    doc,binary=base.read_glb(before/'yoshimitsu_enhanced.glb')
    primitives=doc['meshes'][0]['primitives']
    attrs=primitives[0]['attributes']
    p=base.attribute(doc,binary,attrs['POSITION'])
    n=base.attribute(doc,binary,attrs['NORMAL'])
    triangles=np.concatenate([base.attribute(doc,binary,pr['indices']).reshape(-1,3) for pr in primitives])
    atlas=np.array(Image.open(before/'yoshimitsu_diffuse_2k.png').convert('RGBA'))
    edited,normals,report=sculpt(source,p.astype(float).copy(),n.astype(float).copy(),triangles,atlas)
    p[:],n[:]=edited,normals
    doc['accessors'][attrs['POSITION']]['min']=p.min(0).tolist()
    doc['accessors'][attrs['POSITION']]['max']=p.max(0).tolist()
    base.write_glb(output/'yoshimitsu_enhanced.glb',doc,binary)
    (output/'yoshimitsu_enhanced.source.json').write_text(json.dumps(source,separators=(',',':')))
    shutil.copyfile(before/'yoshimitsu_diffuse_2k.png',output/'yoshimitsu_diffuse_2k.png')
    (output/'refinement.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
