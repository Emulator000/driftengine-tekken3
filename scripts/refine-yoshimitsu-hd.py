"""Selectively curve existing rigid surfaces and resample their local texture, on CPU."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

spec = importlib.util.spec_from_file_location('refinement', Path(__file__).with_name('enhance-yoshimitsu.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def refine(source, limit=15000, joints=(1, 2, 4, 5, 8, 9)):
    allowed_joints = set(joints)
    mesh = source['mesh']
    old = copy.deepcopy(mesh)
    vertices = mesh['vertices']
    frames = source['frames']
    positions, normals = [], []
    for v in vertices:
        p = sum((np.array(frames[f['joint']]['r']).reshape(3, 3) @ f['point'] + frames[f['joint']]['t']) * f['weight'] for f in v['influences'])
        positions.append(p)
        normals.append(base.unit(np.array(frames[v['normalJoint']]['r']).reshape(3, 3) @ v['normal']))
    positions, normals = np.array(positions), np.array(normals)
    faces = np.array(mesh['indices']).reshape(-1, 3)
    protected = {i for group in mesh['shapes'] for i in group['vertices']}
    # UV splits share an edge selection and displacement, but keep separate texture vertices.
    keys = [tuple(np.round(p, 4)) for p in positions]
    edges = {}
    for fi, face in enumerate(faces):
        for a, b in zip(face, np.roll(face, -1)):
            key = tuple(sorted((keys[a], keys[b])))
            edges.setdefault(key, []).append((fi, int(a), int(b)))
    face_normals = base.unit(np.cross(positions[faces[:, 1]]-positions[faces[:, 0]], positions[faces[:, 2]]-positions[faces[:, 0]]))
    candidates = []
    for key, members in edges.items():
        # Preserve open boundaries, hard corners, hands, sword and every blended skin seam.
        if len(members) != 2 or np.dot(face_normals[members[0][0]], face_normals[members[1][0]]) < .65:
            continue
        ids = {i for _, a, b in members for i in (a, b)}
        if ids & protected:
            continue
        influences = [vertices[i]['influences'] for i in ids]
        if any(len(f) != 1 for f in influences):
            continue
        joints = {f[0]['joint'] for f in influences}
        if len(joints) != 1 or next(iter(joints)) not in allowed_joints:
            continue
        a, b = members[0][1:]
        n0 = base.unit(np.mean([normals[i] for i in ids if keys[i] == keys[a]], axis=0))
        n1 = base.unit(np.mean([normals[i] for i in ids if keys[i] == keys[b]], axis=0))
        d = positions[b]-positions[a]
        bend = (-np.dot(d, n0)*n0 + np.dot(d, n1)*n1)/8
        length = np.linalg.norm(bend)
        if length < .6 or np.linalg.norm(d) < 6:
            continue
        # Make the added support edges visible at gameplay distance while staying below the face-fold check.
        bend *= min(1, 24/max(length, 1e-9))
        score = length * (2 if next(iter(joints)) == 2 else 1)
        candidates.append((score, key, bend, a, b))
    selected, budget = {}, limit-len(faces)
    for _, key, bend, a, b in sorted(candidates, key=lambda row: row[0], reverse=True):
        if budget < len(edges[key]):
            continue
        selected[key] = (bend, keys[a], keys[b])
        budget -= len(edges[key])
    midpoint, additions, displacements = {}, [], []
    def split(a, b):
        edge = tuple(sorted((int(a), int(b))))
        if edge in midpoint:
            return midpoint[edge]
        key = tuple(sorted((keys[a], keys[b])))
        if key not in selected:
            return None
        bend = selected[key][0]
        v = copy.deepcopy(vertices[a])
        joint = v['influences'][0]['joint']
        r = np.array(frames[joint]['r']).reshape(3, 3)
        point = np.rint((np.array(vertices[a]['influences'][0]['point']) + vertices[b]['influences'][0]['point'])/2 + np.linalg.solve(r, bend)).astype(int)
        v['influences'][0]['point'] = point.tolist()
        normal_frame = np.array(frames[v['normalJoint']]['r']).reshape(3, 3)
        v['normal'] = np.rint(base.unit(np.linalg.solve(normal_frame, normals[a]+normals[b]))*4096).astype(int).tolist()
        v['uv'] = np.rint((np.array(vertices[a]['uv'])+vertices[b]['uv'])/2).astype(int).tolist()
        index = len(vertices)
        vertices.append(v)
        midpoint[edge] = index
        additions.append(r @ point + frames[joint]['t'])
        displacements.append(float(np.linalg.norm(additions[-1]-(positions[a]+positions[b])/2)))
        return index
    triangles, parents = [], []
    for fi, (a, b, c) in enumerate(faces):
        ab, bc, ca = split(a, b), split(b, c), split(c, a)
        count = sum(x is not None for x in (ab, bc, ca))
        if count == 0: children = [(a,b,c)]
        elif count == 3: children = [(a,ab,ca),(ab,b,bc),(ca,bc,c),(ab,bc,ca)]
        elif count == 1:
            if ab is not None: children = [(a,ab,c),(ab,b,c)]
            elif bc is not None: children = [(b,bc,a),(bc,c,a)]
            else: children = [(c,ca,b),(ca,a,b)]
        elif ab is None: children = [(c,ca,bc),(ca,a,b),(ca,b,bc)]
        elif bc is None: children = [(a,ab,ca),(ab,b,c),(ab,c,ca)]
        else: children = [(b,bc,ab),(ab,bc,c),(ab,c,a)]
        triangles.extend(children)
        parents.extend([fi]*len(children))
    p = np.concatenate((positions, additions)) if additions else positions
    triangles = np.array(triangles)
    after = np.cross(p[triangles[:,1]]-p[triangles[:,0]], p[triangles[:,2]]-p[triangles[:,0]])
    # Reject the whole result if point quantization introduced a folded or collapsed face.
    assert np.all(np.linalg.norm(after, axis=1) > .01)
    assert np.all(np.sum(after*face_normals[parents], axis=1) > 0)
    assert len(triangles) <= limit
    assert vertices[:len(old['vertices'])] == old['vertices']
    mesh['indices'] = triangles.flatten().tolist()
    if old['twoFaced'] is not None:
        two = set(old['twoFaced'])
        mesh['twoFaced'] = [i for i, parent in enumerate(parents) if parent in two]
    mesh['pictures'] = [[i for i, parent in enumerate(parents) if parent in set(picture)] for picture in old['pictures']]
    return dict(triangles_before=len(faces), triangles_after=len(triangles), vertices_before=len(old['vertices']), vertices_after=len(vertices), selected_edges=len(selected), new_vertices=len(additions), max_curvature_offset_mm=max(displacements, default=0), original_vertices_unchanged=True, hand_shapes_unchanged=mesh['shapes']==old['shapes'], flipped_faces=0, degenerate_faces=0)


if __name__ == '__main__':
    root = Path(__file__).resolve().parent.parent
    original = root/'local-remaster/yoshimitsu/08-refined-playable/yoshimitsu_enhanced.source.json'
    output = root/'local-remaster/yoshimitsu/08-hd-pass'
    output.mkdir(exist_ok=True)
    source = json.loads(original.read_text())
    report = refine(source)
    (output/'yoshimitsu_enhanced.source.json').write_text(json.dumps(source, separators=(',',':')))
    texture = Image.open(root/'public/data/fighters/08.png').convert('RGBA')
    enlarged = texture.resize((2048,2048), Image.Resampling.LANCZOS)
    rgb = enlarged.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1.2, percent=85, threshold=4))
    rgb.putalpha(enlarged.getchannel('A'))
    rgb.save(output/'yoshimitsu_diffuse_2k.png')
    report.update(texture_before=list(texture.size), texture_after=list(rgb.size), texture_method='CPU Lanczos resampling and mild unsharp mask; no recovered or invented detail', source_sha256=hashlib.sha256(original.read_bytes()).hexdigest())
    (output/'refinement.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
