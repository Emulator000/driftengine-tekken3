"""Refine head and leg curvature, retaining the local fighter's point skin."""
import copy
import importlib.util
import json
import shutil
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('adaptive', Path(__file__).with_name('refine-yoshimitsu-hd.py'))
adaptive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adaptive)


def detail(source):
    old = copy.deepcopy(source['mesh'])
    # Spend the remaining budget on curved head and leg edges only.
    report = adaptive.refine(source, 15000, (2, 12, 13, 14, 15, 16, 17))
    report['original_vertices_unchanged_by_subdivision'] = report.pop('original_vertices_unchanged')
    mesh = source['mesh']
    regions = {}
    for v in mesh['vertices'][len(old['vertices']):]:
        j = v['influences'][0]['joint']
        regions[str(j)] = regions.get(str(j), 0) + 1
    # Original vertices, hands, UV seams, sword and all animation data stay exact.
    assert mesh['vertices'][:len(old['vertices'])] == old['vertices']
    assert mesh['shapes'] == old['shapes']
    assert all(len(v['influences']) == 1 for v in mesh['vertices'][len(old['vertices']):])
    assert all(v['influences'][0]['weight'] == 1 for v in mesh['vertices'][len(old['vertices']):])
    report['new_vertices_by_joint'] = regions
    return report


def materials(before, output):
    texture = Image.open(before/'yoshimitsu_diffuse_2k.png').convert('RGBA')
    layer = Image.new('RGBA', texture.size)
    draw = ImageDraw.Draw(layer)
    # Existing half-face UV island: keep its painted landmarks and mirrored layout.
    # Paint the mask's red sockets and its rows of metal teeth.
    draw.polygon([(88, 82), (105, 85), (122, 93), (115, 106), (101, 104), (91, 95)], fill=(116, 24, 24, 165))
    draw.ellipse((102, 91, 109, 97), fill=(215, 224, 196, 235))
    draw.line([(115, 179), (126, 185), (140, 187)], fill=(26, 27, 23, 210), width=2)
    draw.line([(116, 198), (128, 204), (141, 205)], fill=(43, 42, 33, 160), width=2)
    for x, y in [(118, 177), (125, 180), (132, 182), (139, 182)]:
        draw.rounded_rectangle((x, y, x+4, y+8), radius=1, fill=(202, 205, 182, 190))
        draw.line((x, y+1, x, y+7), fill=(239, 239, 215, 180), width=1)
        draw.rounded_rectangle((x, y+13, x+4, y+19), radius=1, fill=(178, 184, 165, 175))
    layer = layer.filter(ImageFilter.GaussianBlur(.55))
    Image.alpha_composite(texture, layer).save(output/'yoshimitsu_diffuse_2k.png')
    for name in ('yoshimitsu.normal.png', 'yoshimitsu.orm.png'):
        shutil.copyfile(before/name, output/name)


def head_relief(source, texture_path):
    mesh, frames = source['mesh'], source['frames']
    original = copy.deepcopy(mesh['vertices'])
    points, normals = [], []
    for v in original:
        points.append(sum((np.array(frames[f['joint']]['r']).reshape(3, 3)@f['point']+frames[f['joint']]['t'])*f['weight'] for f in v['influences']))
        normals.append(adaptive.base.unit(np.array(frames[v['normalJoint']]['r']).reshape(3, 3)@v['normal']))
    points, normals = np.array(points), np.array(normals)
    gray = Image.open(texture_path).convert('L')
    # Broad existing painted relief, not noise or invented new helmet symbols.
    broad = np.array(gray.filter(ImageFilter.GaussianBlur(3)), dtype=float)/255
    background = np.array(gray.filter(ImageFilter.GaussianBlur(18)), dtype=float)/255
    groups = {}
    for i, p in enumerate(points): groups.setdefault(tuple(np.round(p, 4)), []).append(i)
    delta = np.zeros_like(points)
    for ids in groups.values():
        if not all(len(original[i]['influences']) == 1 and original[i]['influences'][0]['joint'] == 2 for i in ids): continue
        samples = []
        for i in ids:
            u, v = np.rint(np.array(original[i]['uv'])/2).astype(int)
            u, v = np.clip(u, 0, 2047), np.clip(v, 0, 2047)
            samples.append(np.clip((broad[v, u]-background[v, u])*10, -1.5, 1.5))
        direction = adaptive.base.unit(normals[ids].mean(0))
        delta[ids] = direction*np.mean(samples)
    triangles = np.array(mesh['indices']).reshape(-1, 3)
    before = np.cross(points[triangles[:, 1]]-points[triangles[:, 0]], points[triangles[:, 2]]-points[triangles[:, 0]])
    edited = points.copy()
    r = np.array(frames[2]['r']).reshape(3, 3)
    active = np.where(np.linalg.norm(delta, axis=1)>.05)[0]
    strength = np.ones(len(points))
    group_for = {i: ids for ids in groups.values() for i in ids}
    for _ in range(24):
        for i in active:
            p = np.array(original[i]['influences'][0]['point'])+np.rint(np.linalg.solve(r, delta[i]*strength[i])).astype(int)
            mesh['vertices'][i]['influences'][0]['point'] = p.tolist()
            edited[i] = r@p+frames[2]['t']
        after = np.cross(edited[triangles[:, 1]]-edited[triangles[:, 0]], edited[triangles[:, 2]]-edited[triangles[:, 0]])
        bad = (np.sum(before*after, axis=1)<=0)|(np.linalg.norm(after, axis=1)<.3*np.linalg.norm(before, axis=1))
        if not np.any(bad): break
        for i in {i for index in triangles[bad].flatten() for i in group_for[int(index)]}: strength[i] *= .5
    else: raise ValueError('head relief folds geometry')
    transported = adaptive.base.transported_normals(points, edited, triangles, normals)
    for i in active:
        v = mesh['vertices'][i]
        nr = np.array(frames[v['normalJoint']]['r']).reshape(3, 3)
        v['normal'] = np.rint(adaptive.base.unit(np.linalg.solve(nr, transported[i]))*4096).astype(int).tolist()
    active_set = set(active)
    assert all(v == original[i] for i, v in enumerate(mesh['vertices']) if i not in active_set)
    # Smooth welded geometry across UV islands; preserve steep armor creases.
    faces = np.cross(edited[triangles[:,1]]-edited[triangles[:,0]], edited[triangles[:,2]]-edited[triangles[:,0]])
    face_normals = adaptive.base.unit(faces)
    welded = {}
    for i, p in enumerate(edited): welded.setdefault(tuple(np.round(p,4)), []).append(i)
    slots = {i: key for key, ids in welded.items() for i in ids}
    incident = {key:set() for key in welded}
    own = [[] for _ in edited]
    for fi, face in enumerate(triangles):
        for i in face: incident[slots[int(i)]].add(fi); own[int(i)].append(fi)
    changed = 0
    for i, v in enumerate(mesh['vertices']):
        if not all(f['joint'] in (2,12,13,14,15,16,17) for f in v['influences']): continue
        axis = adaptive.base.unit(np.sum(faces[own[i]],axis=0))
        threshold = .5 if v['normalJoint'] in (2,14,17) else .2
        candidates = [fi for fi in incident[slots[i]] if np.dot(face_normals[fi],axis)>threshold]
        if not candidates: continue
        n = adaptive.base.unit(np.sum(faces[candidates],axis=0))
        nr = np.array(frames[v['normalJoint']]['r']).reshape(3,3)
        v['normal'] = np.rint(adaptive.base.unit(np.linalg.solve(nr,n))*4096).astype(int).tolist()
        changed += 1
    return {'moved_vertices': int(np.sum(np.linalg.norm(edited-points, axis=1)>.01)), 'max_displacement_mm': float(np.linalg.norm(edited-points, axis=1).max()), 'smoothed_head_leg_normals': changed, 'flipped_faces': 0, 'source': 'existing painted relief, bounded to 1.5 mm before point quantization; welded normal smoothing on head and legs'}


if __name__ == '__main__':
    before = ROOT/'local-remaster/yoshimitsu/08-complete'
    output = ROOT/'local-remaster/yoshimitsu/08-mask-legs'
    output.mkdir(exist_ok=False)
    source = json.loads((before/'yoshimitsu_enhanced.source.json').read_text())
    report = detail(source)
    report['head_relief'] = head_relief(source, before/'yoshimitsu_diffuse_2k.png')
    materials(before, output)
    (output/'yoshimitsu_enhanced.source.json').write_text(json.dumps(source, separators=(',', ':')))
    (output/'refinement.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
