"""Apply an olive metal grade to the fitted local atlas."""
from pathlib import Path
import shutil
import numpy as np
from PIL import Image

source = Path('local-remaster/yoshimitsu/08-tag-green')
output = Path('local-remaster/yoshimitsu/08-olive-pass')
output.mkdir(parents=True, exist_ok=True)
for name in ('yoshimitsu_tag.source.json', 'yoshimitsu_tag.ftr'):
    shutil.copyfile(source / name, output / name)
im = np.array(Image.open(source / 'yoshimitsu_diffuse.png').convert('RGBA'))
rgb = im[..., :3].astype(float) / 255
out = rgb.copy()
# Atlas tiles containing the head, chest, shoulders, gauntlets and greaves.
tiles = [(3, 0), (4, 0), (5, 0), (6, 0), (7, 0), (0, 1), (1, 1), (6, 1), (7, 1), (0, 3), (1, 3), (2, 3)]
changed = 0
for tx, ty in tiles:
    region = np.zeros(rgb.shape[:2], bool)
    region[ty*256:(ty+1)*256, tx*256:(tx+1)*256] = True
    px = rgb[region]
    lum = px @ np.array([.2126, .7152, .0722])
    sat = px.max(1) - px.min(1)
    metal = np.clip((lum - .12) / .68, 0, 1) * np.clip(1 - sat / .42, 0, 1)
    # Keep painted red/gold details while lifting neutral metal toward olive.
    target = np.column_stack((.34*lum + .06, .40*lum + .07, .25*lum + .05))
    mix = .28 * metal
    out[region] = px * (1 - mix[:, None]) + target * mix[:, None]
    changed += int(np.sum(metal > .2))
result = np.empty_like(im)
result[..., :3] = np.uint8(np.clip(out * 255, 0, 255))
result[..., 3] = im[..., 3]
Image.fromarray(result).save(output / 'yoshimitsu_diffuse.png')
print({'tinted_pixels': changed, 'output': str(output)})
