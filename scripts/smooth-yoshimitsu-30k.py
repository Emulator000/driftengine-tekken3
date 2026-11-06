"""Smooth broad fitted surfaces while preserving hard armor creases and skin data."""
import json
from pathlib import Path
import numpy as np

root = Path(__file__).resolve().parent.parent
folder = root / 'local-remaster/yoshimitsu/08-30k-pass2'
s = json.loads((folder / 'yoshimitsu_enhanced.source.json').read_text())
m, frames = s['mesh'], s['frames']
pts = []
for v in m['vertices']:
    pts.append(sum((np.array(frames[f['joint']]['r']).reshape(3, 3) @ f['point'] + frames[f['joint']]['t']) * f['weight'] for f in v['influences']))
pts = np.array(pts, float)
tri = np.array(m['indices']).reshape(-1, 3)
face = np.cross(pts[tri[:, 1]] - pts[tri[:, 0]], pts[tri[:, 2]] - pts[tri[:, 0]])
face /= np.maximum(np.linalg.norm(face, axis=1, keepdims=True), 1e-9)
groups = {}
for i, p in enumerate(pts): groups.setdefault(tuple(np.round(p, 4)), []).append(i)
incident = {k: [] for k in groups}
for fi, t in enumerate(tri):
    for i in t: incident[tuple(np.round(pts[i], 4))].append(fi)
changed = 0
for key, ids in groups.items():
    fs = incident[key]
    avg = face[fs].mean(0); avg /= max(np.linalg.norm(avg), 1e-9)
    for i in ids:
        compatible = [face[f] for f in fs if np.dot(face[f], avg) > .45] or [avg]
        n = np.mean(compatible, axis=0); n /= max(np.linalg.norm(n), 1e-9)
        v = m['vertices'][i]; r = np.array(frames[v['normalJoint']]['r']).reshape(3, 3)
        local = np.linalg.solve(r, n); q = np.rint(local / max(np.linalg.norm(local), 1e-9) * 4096).astype(int).tolist()
        if q != v['normal']: changed += 1; v['normal'] = q
(folder / 'yoshimitsu_enhanced.source.json').write_text(json.dumps(s, separators=(',', ':')))
(folder / 'smooth-report.json').write_text(json.dumps({'vertices_normals_changed': changed, 'triangles': len(tri), 'crease_dot_threshold': .45}, indent=2))
print({'vertices_normals_changed': changed, 'triangles': len(tri)})
