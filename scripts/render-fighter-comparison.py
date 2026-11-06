"""Make matched CPU renders of two local GLBs with NumPy and Pillow."""
import argparse
import io
import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location('fighter_refinement', Path(__file__).with_name('enhance-yoshimitsu.py'))
refinement = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refinement)
read_glb, attribute, unit = refinement.read_glb, refinement.attribute, refinement.unit


def render(path, target, span, clay=False, size=700):
    document, binary = read_glb(path)
    primitives = document['meshes'][0]['primitives']
    attrs = primitives[0]['attributes']
    positions = attribute(document, binary, attrs['POSITION']).astype(float)
    normals = attribute(document, binary, attrs['NORMAL']).astype(float)
    uvs = attribute(document, binary, attrs['TEXCOORD_0']).astype(float)
    view = document['bufferViews'][document['images'][0]['bufferView']]
    start = view.get('byteOffset', 0)
    atlas = np.array(Image.open(io.BytesIO(binary[start:start+view['byteLength']])).convert('RGBA'))
    direction = unit(np.array([0.75, 0.05, 1.0]))
    right = unit(np.cross([0, 1, 0], direction))
    up = np.cross(direction, right)
    basis = np.array([right, up, direction])
    transformed = (positions - target) @ basis.T
    screen = transformed[:, :2] * (size / span) * [1, -1] + size / 2
    depth = np.full((size, size), -np.inf)
    pixels = np.full((size, size, 3), [34, 38, 47], dtype=np.uint8)
    light = unit(np.array([0.4, 0.8, 1.0]))
    for primitive in primitives:
        triangles = attribute(document, binary, primitive['indices']).reshape(-1, 3)
        for triangle in triangles:
            p = screen[triangle]
            low = np.maximum(np.floor(p.min(0)).astype(int), 0)
            high = np.minimum(np.ceil(p.max(0)).astype(int), size-1)
            if np.any(high < low):
                continue
            denominator = (p[1, 1]-p[2, 1])*(p[0, 0]-p[2, 0]) + (p[2, 0]-p[1, 0])*(p[0, 1]-p[2, 1])
            if abs(denominator) < 1e-10:
                continue
            x, y = np.meshgrid(np.arange(low[0], high[0]+1)+0.5, np.arange(low[1], high[1]+1)+0.5)
            a = ((p[1, 1]-p[2, 1])*(x-p[2, 0]) + (p[2, 0]-p[1, 0])*(y-p[2, 1]))/denominator
            b = ((p[2, 1]-p[0, 1])*(x-p[2, 0]) + (p[0, 0]-p[2, 0])*(y-p[2, 1]))/denominator
            weights = np.stack([a, b, 1-a-b], axis=-1)
            z = weights @ transformed[triangle, 2]
            region = (slice(low[1], high[1]+1), slice(low[0], high[0]+1))
            on = np.all(weights >= -1e-7, axis=-1) & (z > depth[region])
            if not np.any(on):
                continue
            uv = np.clip(weights @ uvs[triangle], 0, 1)
            texels = atlas[np.minimum((uv[:, :, 1]*atlas.shape[0]).astype(int), atlas.shape[0]-1),
                           np.minimum((uv[:, :, 0]*atlas.shape[1]).astype(int), atlas.shape[1]-1)]
            on &= texels[:, :, 3] >= 128
            n = unit(weights @ normals[triangle])
            brightness = 0.32 + 0.68*np.maximum(0, n @ light)
            color = np.full_like(texels[:, :, :3], [183, 190, 197]) if clay else texels[:, :, :3]
            # One small common highlight makes the geometric contour legible in both renders.
            half = unit(light + direction)
            shine = np.maximum(0, n @ half)**32 * 28
            shaded = np.clip(color*brightness[:, :, None] + shine[:, :, None], 0, 255).astype(np.uint8)
            pixels[region][on] = shaded[on]
            depth[region][on] = z[on]
    return Image.fromarray(pixels)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--size', type=int, default=700)
    parser.add_argument('--views', nargs='+', default=['full', 'mask', 'armor', 'blade'])
    parser.add_argument('--before-label', default='BEFORE | validated rounded')
    parser.add_argument('--after-label', default='AFTER | local geometry refinement')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for name, target, span in [('full', [0.1, 1.04, 0], 2.3), ('mask', [0.08, 1.55, 0.02], 0.48),
                               ('armor', [0.05, 1.25, 0.05], 0.7), ('blade', [0.47, 1.78, -0.08], 0.8),
                               ('legs', [0.05, 0.48, 0.02], 1.0)]:
        if name not in args.views:
            continue
        for clay in (False, True):
            images = [render(path, np.array(target), span, clay, args.size) for path in (args.before, args.after)]
            joined = Image.new('RGB', (args.size*2, args.size+40), (20, 23, 30))
            draw = ImageDraw.Draw(joined)
            for i, image in enumerate(images):
                joined.paste(image, (i*args.size, 40))
                draw.text((i*args.size+20, 14), args.before_label if i == 0 else args.after_label, fill='white')
            joined.save(args.output / f'{name}{"-clay" if clay else ""}.png')
