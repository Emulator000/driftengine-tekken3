"""Refine selected surfaces in a local fighter GLB using NumPy, without changing topology."""
import argparse
import copy
import hashlib
import json
import struct
import time
from pathlib import Path

import numpy as np


def read_glb(path):
    data = path.read_bytes()
    magic, version, size = struct.unpack_from('<III', data)
    if magic != 0x46546C67 or version != 2 or size != len(data):
        raise ValueError('invalid GLB')
    length, kind = struct.unpack_from('<II', data, 12)
    if kind != 0x4E4F534A:
        raise ValueError('missing GLB JSON')
    document = json.loads(data[20:20 + length])
    length_bin, kind = struct.unpack_from('<II', data, 20 + length)
    if kind != 0x004E4942:
        raise ValueError('missing GLB binary')
    return document, bytearray(data[28 + length:28 + length + length_bin])


def attribute(document, binary, index):
    a = document['accessors'][index]
    view = document['bufferViews'][a['bufferView']]
    dtype = {5126: '<f4', 5123: '<u2', 5125: '<u4'}[a['componentType']]
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    if 'byteStride' in view or 'sparse' in a:
        raise ValueError('interleaved or sparse data is not supported')
    offset = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.ndarray((a['count'], width), dtype=dtype, buffer=binary, offset=offset)


def write_glb(path, document, binary):
    text = json.dumps(document, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    binary += b'\0' * (-len(binary) % 4)
    total = 28 + len(text) + len(binary)
    path.write_bytes(struct.pack('<IIIII', 0x46546C67, 2, total, len(text), 0x4E4F534A) +
                     text + struct.pack('<II', len(binary), 0x004E4942) + binary)


def unit(values):
    return values / np.maximum(np.linalg.norm(values, axis=-1, keepdims=True), 1e-15)


def refine(positions, normals, triangles, regions):
    # Weld geometric duplicates for displacement only; retain all UV and normal splits.
    lookup, groups, representatives = {}, [], []
    for i, point in enumerate(positions):
        key = tuple(np.round(point, 7))
        if key not in lookup:
            lookup[key] = len(representatives)
            representatives.append(i)
        groups.append(lookup[key])
    groups = np.array(groups)
    points = positions[representatives].copy()
    faces = groups[triangles]
    face_normals = unit(np.cross(points[faces[:, 1]] - points[faces[:, 0]],
                                 points[faces[:, 2]] - points[faces[:, 0]]))
    edges = {}
    for f, triangle in enumerate(faces):
        for a, b in zip(triangle, np.roll(triangle, -1)):
            edges.setdefault(tuple(sorted((int(a), int(b)))), []).append(f)
    adjacency = [set() for _ in points]
    pinned = np.zeros(len(points), dtype=bool)
    for (a, b), attached in edges.items():
        if a == b:
            continue
        adjacency[a].add(b)
        adjacency[b].add(a)
        if len(attached) != 2 or face_normals[attached[0]] @ face_normals[attached[1]] < 0.64:
            pinned[[a, b]] = True
    summed = np.zeros_like(points)
    np.add.at(summed, groups, normals)
    normal = unit(summed)
    gains = np.zeros(len(points))
    for i, group in enumerate(groups):
        if abs(regions[i]) > abs(gains[group]):
            gains[group] = regions[i]
    # Keep a one-ring transition fixed at joints and between edited and unedited surfaces.
    for i, neighbors in enumerate(adjacency):
        if any(gains[n] == 0 for n in neighbors):
            pinned[i] = True
    low = points.copy()
    for _ in range(3):
        next_low = low.copy()
        for i, neighbors in enumerate(adjacency):
            if pinned[i] or not gains[i] or not neighbors:
                continue
            compatible = [n for n in neighbors if normal[i] @ normal[n] > 0.75]
            if compatible:
                next_low[i] = 0.5 * low[i] + 0.5 * low[compatible].mean(axis=0)
        low = next_low
    relief = np.sum((points - low) * normal, axis=1)
    amount = np.clip(relief * gains, -0.0045, 0.0045)
    amount[pinned] = 0
    displacement = normal * amount[:, None]
    candidate = positions + displacement[groups]
    # Back off a whole edit if any face would fold or lose most of its area.
    before = np.cross(positions[triangles[:, 1]] - positions[triangles[:, 0]],
                      positions[triangles[:, 2]] - positions[triangles[:, 0]])
    for _ in range(24):
        after = np.cross(candidate[triangles[:, 1]] - candidate[triangles[:, 0]],
                         candidate[triangles[:, 2]] - candidate[triangles[:, 0]])
        bad = (np.sum(before * after, axis=1) <= 0) | (
            np.linalg.norm(after, axis=1) <= 0.4 * np.linalg.norm(before, axis=1))
        if not np.any(bad):
            return candidate, pinned[groups]
        displacement[np.unique(faces[bad])] *= 0.5
        candidate = positions + displacement[groups]
    raise ValueError('refinement could fold a face')


def transported_normals(before, after, triangles, authored):
    def geometric(points):
        face = np.cross(points[triangles[:, 1]] - points[triangles[:, 0]],
                        points[triangles[:, 2]] - points[triangles[:, 0]])
        result = np.zeros_like(points)
        for c in range(3):
            np.add.at(result, triangles[:, c], face)
        return unit(result)
    a, b = geometric(before), geometric(after)
    axis = np.cross(a, b)
    sine = np.linalg.norm(axis, axis=1)
    cosine = np.clip(np.sum(a * b, axis=1), -1, 1)
    axis = unit(axis)
    rotated = authored * cosine[:, None] + np.cross(axis, authored) * sine[:, None] + axis * (
        np.sum(axis * authored, axis=1) * (1 - cosine))[:, None]
    rotated[sine < 1e-12] = authored[sine < 1e-12]
    return unit(rotated)


def enhance(input_glb, output):
    start = time.perf_counter()
    if output.exists():
        raise ValueError('output directory already exists')
    source_path = input_glb.with_suffix('.source.json')
    source = json.loads(source_path.read_text())
    document, binary = read_glb(input_glb)
    original_document = copy.deepcopy(document)
    original_binary = bytes(binary)
    primitive = document['meshes'][0]['primitives'][0]
    attributes = primitive['attributes']
    position_view = attribute(document, binary, attributes['POSITION'])
    normal_view = attribute(document, binary, attributes['NORMAL'])
    positions, normals = position_view.astype(float).copy(), normal_view.astype(float).copy()
    triangles = np.concatenate([attribute(document, binary, p['indices']).reshape(-1, 3)
                                for p in document['meshes'][0]['primitives']])
    mesh = source['mesh']
    original_points = [[list(f['point']) for f in v['influences']] for v in mesh['vertices']]
    original_normals = [list(v['normal']) for v in mesh['vertices']]
    if len(mesh['vertices']) != len(positions) or len(triangles) != 9918:
        raise ValueError('expected the validated rounded Yoshimitsu mesh')
    regions = np.zeros(len(positions))
    labels = []
    for i, vertex in enumerate(mesh['vertices']):
        joint = vertex['normalJoint']
        rigid = len(vertex['influences']) == 1 and vertex['influences'][0]['joint'] == joint
        label = 'unchanged'
        if rigid and joint == 2:
            regions[i], label = (-0.55 if vertex['influences'][0]['point'][2] > 170 else 1.8), 'mask-and-crest'
        elif rigid and joint in (1, 4, 5, 8, 9):
            regions[i], label = 1.8, 'armor'
        elif rigid and joint == 10 and vertex['influences'][0]['point'][1] < -180:
            regions[i], label = 0.4, 'blade'
        labels.append(label)
    enhanced, pinned = refine(positions, normals, triangles, regions)
    # Flatten only the blade's existing broad surface; retain its boundary, tip and attachment.
    blade = np.array([label == 'blade' for label in labels])
    if blade.sum() >= 3:
        center = positions[blade].mean(axis=0)
        _, _, axes = np.linalg.svd(positions[blade] - center, full_matrices=False)
        plane = axes[-1]
        editable = blade & ~pinned
        distances = (positions[editable] - center) @ plane
        enhanced[editable] -= np.clip(distances * 0.35, -0.0015, 0.0015)[:, None] * plane
    delta = enhanced - positions
    moved = np.linalg.norm(delta, axis=1) > 1e-8
    new_normals = transported_normals(positions, enhanced, triangles, normals)
    new_normals[~moved] = normals[~moved]
    position_view[:] = enhanced
    normal_view[:] = new_normals
    accessor = document['accessors'][attributes['POSITION']]
    accessor['min'], accessor['max'] = position_view.min(0).tolist(), position_view.max(0).tolist()
    # Convert the same bind displacement to each original joint's own point space.
    local_deltas = {}
    for i, vertex in enumerate(mesh['vertices']):
        if not moved[i]:
            continue
        game_delta = delta[i] * [1000, -1000, -1000]
        for k, influence in enumerate(vertex['influences']):
            rotation = np.array(source['frames'][influence['joint']]['r']).reshape(3, 3)
            shift = np.rint(np.linalg.solve(rotation, game_delta)).astype(int)
            influence['point'] = (np.array(influence['point']) + shift).tolist()
            local_deltas[i, k] = shift
        if len(vertex['influences']) != 1:
            raise ValueError('refinement reached a blended skin seam')
        influence = vertex['influences'][0]
        frame = source['frames'][influence['joint']]
        game_point = np.array(frame['r']).reshape(3, 3) @ influence['point'] + frame['t']
        enhanced[i] = game_point * [0.001, -0.001, -0.001]
    # Quantize edits once to the runtime's point precision, then check the actual exported surface.
    for _ in range(32):
        before = np.cross(positions[triangles[:, 1]] - positions[triangles[:, 0]],
                          positions[triangles[:, 2]] - positions[triangles[:, 0]])
        after = np.cross(enhanced[triangles[:, 1]] - enhanced[triangles[:, 0]],
                         enhanced[triangles[:, 2]] - enhanced[triangles[:, 0]])
        bad = (np.sum(before * after, axis=1) <= 0) | (
            np.linalg.norm(after, axis=1) < 0.4 * np.linalg.norm(before, axis=1))
        if not np.any(bad):
            break
        for i in np.unique(triangles[bad]):
            enhanced[i] = positions[i]
            for k, influence in enumerate(mesh['vertices'][i]['influences']):
                influence['point'] = original_points[i][k]
                local_deltas[i, k] = np.zeros(3, dtype=int)
    else:
        raise ValueError('quantization cannot preserve the surface')
    delta = enhanced - positions
    moved = np.linalg.norm(delta, axis=1) > 1e-8
    new_normals = transported_normals(positions, enhanced, triangles, normals)
    new_normals[~moved] = normals[~moved]
    position_view[:] = enhanced
    normal_view[:] = new_normals
    accessor['min'], accessor['max'] = position_view.min(0).tolist(), position_view.max(0).tolist()
    for i, vertex in enumerate(mesh['vertices']):
        if moved[i]:
            rotation = np.array(source['frames'][vertex['normalJoint']]['r']).reshape(3, 3)
            local_normal = np.linalg.solve(rotation, new_normals[i] * [1, -1, -1])
            vertex['normal'] = np.rint(unit(local_normal) * 4096).astype(int).tolist()
    for group in mesh['shapes']:
        for shape in group['shapes']:
            for member, i in enumerate(group['vertices']):
                if not moved[i]:
                    continue
                for k, point in enumerate(shape[member]['points']):
                    shape[member]['points'][k] = (np.array(point) + local_deltas[i, k]).tolist()
                if shape[member]['normal'] == original_normals[i]:
                    shape[member]['normal'] = list(mesh['vertices'][i]['normal'])
    if any(abs(x) > 32767 for v in mesh['vertices'] for f in v['influences'] for x in f['point']):
        raise ValueError('edited joint-space points exceed runtime range')
    # All binary regions other than the two edited attributes must remain byte-identical.
    restored = bytearray(binary)
    attribute(document, restored, attributes['POSITION'])[:] = positions
    attribute(document, restored, attributes['NORMAL'])[:] = normals
    if bytes(restored) != original_binary:
        raise AssertionError('an animation, skin, texture or UV byte changed')
    if document['nodes'] != original_document['nodes'] or document['skins'] != original_document['skins']:
        raise AssertionError('rig changed')
    before_faces = np.cross(positions[triangles[:, 1]] - positions[triangles[:, 0]],
                            positions[triangles[:, 2]] - positions[triangles[:, 0]])
    after_faces = np.cross(enhanced[triangles[:, 1]] - enhanced[triangles[:, 0]],
                           enhanced[triangles[:, 2]] - enhanced[triangles[:, 0]])
    if np.any(np.sum(before_faces * after_faces, axis=1) <= 0):
        raise ValueError('an edited face flipped')
    output.mkdir(parents=True)
    write_glb(output / 'yoshimitsu_enhanced.glb', document, binary)
    (output / 'yoshimitsu_enhanced.source.json').write_text(json.dumps(source, separators=(',', ':')))
    report = dict(input_sha256=hashlib.sha256(input_glb.read_bytes()).hexdigest(),
                  triangles_before=len(triangles), triangles_after=len(triangles), vertices=len(positions),
                  moved_vertices=int(moved.sum()), max_displacement_mm=float(np.linalg.norm(delta, axis=1).max() * 1000),
                  changed_regions={label: int(sum(moved[i] and labels[i] == label for i in range(len(labels))))
                                   for label in ('mask-and-crest', 'armor', 'blade')},
                  binary_preservation='UV, texture, skin, inverse binds, nodes and animation channels unchanged',
                  seconds=time.perf_counter() - start)
    (output / 'refinement.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    enhance(args.input, args.output)
