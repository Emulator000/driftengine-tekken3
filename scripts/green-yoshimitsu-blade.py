"""Recolour the local sword atlas while preserving the fitted mesh and animations."""
import importlib.util
import shutil
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location('fit', Path(__file__).with_name('fit-yoshimitsu-tag.py'))
fit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fit)
source = Path('local-remaster/yoshimitsu/08-tag-smooth')
output = Path('local-remaster/yoshimitsu/08-tag-green')
output.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source/'yoshimitsu_tag.source.json', output/'yoshimitsu_tag.source.json')
p, n, uv, faces = fit.read_obj(Path('.cache/yoshimitsu-tag/raw/Yoshimitsu/Yoshimitsu 1/yosi1u.obj'))
names = sorted({f['material'] for f in faces})
name = 'yosi1u_20'
used = np.array([uv[c[1]] for f in faces if f['material'] == name for c in f['corners']])
low = np.minimum(used.min(0), [0, 0])-.025
high = np.maximum(used.max(0), [1, 1])+.025
i = names.index(name)
mask = Image.new('L', (2048, 2048))
draw = ImageDraw.Draw(mask)
for face in faces:
    if face['material'] != name or np.mean([p[c[0], 2] for c in face['corners']]) < 100:
        continue
    points = []
    for _, t, _ in face['corners']:
        q = (uv[t]-low)/(high-low)
        points.append(((i % 8)*256+q[0]*256, (i//8)*256+(1-q[1])*256))
    draw.polygon(points, fill=255)
pixels = np.array(Image.open(source/'yoshimitsu_diffuse.png').convert('RGBA'))
selected = np.array(mask) > 0
assert 100 < selected.sum() < 256*256
light = pixels[selected, :3].mean(axis=1)/255
pixels[selected, :3] = np.column_stack((70+100*light, 220+35*light, 65+110*light)).astype('uint8')
pixels[~selected] = np.array(Image.open(source/'yoshimitsu_diffuse.png').convert('RGBA'))[~selected]
Image.fromarray(pixels).save(output/'yoshimitsu_diffuse.png')
print({'blade_pixels': int(selected.sum()), 'output': str(output)})
