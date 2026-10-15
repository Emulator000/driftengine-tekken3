"""
The remaster's assets, made on this machine from the imported data into public/assets/remaster/:
the fighters' and stages' atlases enlarged (PBRify's upscaler) with normal, ORM and height maps
(PBRify's material models), each stage's floor at sixteen times with the grain of a material Z-Image
draws (through stable-diffusion.cpp) and some drawn anew, the panoramas and the pictures enlarged,
and the skies of the stages that have their own. A part already written is left as it is, so a run
that stops picks up where it was. `all` makes every part, then lists them in manifest.json, which
the game looks for before it offers the remaster.

    npm run remaster                  (the tools fetched, then all)
    scripts/remaster/py scripts/remaster/generate.py all
    scripts/remaster/py scripts/remaster/generate.py all-stages skies

The weights and the binary come from scripts/remaster/fetch.sh, into .cache/remaster/.
"""
import hashlib
import json
import os
import struct
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageFilter

import pbrify as P

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
DATA = ROOT + '/public/data/'
ASSETS = ROOT + '/public/assets/'
OUT = ROOT + '/public/assets/remaster/'
CACHE = ROOT + '/.cache/remaster/'
DAT = '4x-PBRify_UpscalerV4.pth'
SD = [CACHE + 'bin/sd/sd-cli', '--diffusion-model', CACHE + 'weights/zimage/z_image_turbo-Q4_K.gguf', '--vae', CACHE + 'weights/vae/ae.safetensors',
      '--llm', CACHE + 'weights/qwen3/Qwen3-4B-Instruct-2507-Q4_K_M.gguf', '--cfg-scale', '1.0', '--steps', '8', '--rng', 'cpu', '--vae-tiling', '--backend', 'te=cpu']

GRASS = 'seamless top-down photograph of dense short lush green grass lawn, natural soft daylight, evenly lit, high detail texture'
SAND = 'seamless top-down photograph of pale dry sandy dirt ground with small pebbles and a few dry grass blades, natural soft daylight, evenly lit, high detail texture'


def grain(what):
    return f'seamless macro photograph of {what}, no joints, no tiles, no seams, uniform, evenly lit, high detail texture'


# Each stage's floor: the details its grain is drawn from (two, grass and sand, laid by how green the floor is).
FLOOR_DETAILS = {
    0: [('grain', grain('fine grey-brown gravel and grit'))], 1: [('grain', grain('dry packed brown earth with fine grit'))], 2: [('grass', GRASS)],
    3: [('grain', grain('smooth polished blue stone surface with fine speckles'))], 4: [('grain', grain('a flat weathered grey granite surface, fine grain, pores and grit'))],
    5: [('grain', grain('dark weathered asphalt surface, fine grain'))], 6: [('grain', grain('rough dark volcanic rock surface, fine grain'))],
    7: [('grain', grain('dry packed brown earth with fine grit'))], 8: [('grain', grain('dark stained wood grain close-up'))],
    9: [('grain', grain('worn dark green painted metal surface, fine scratches'))], 10: [('grass', GRASS), ('sand', SAND)],
    11: [('grain', grain('worn grey painted metal surface, fine scratches'))], 12: [('grain', grain('dry earth with fine grit and small pebbles'))],
    13: [('grain', grain('fine pale sand'))], 14: [('grain', grain('dark granite surface, fine grain'))], 15: [('grain', grain('grey stone surface, fine grain and pores'))],
    16: [('grain', grain('dry clay surface, fine grain'))], 17: [('grain', grain('worn copper metal surface, fine scratches'))],
    18: [('grain', grain('reddish brown wood grain close-up'))], 19: [('grain', grain('fine pale sand'))],
}


def log(*a):
    print(f'[{time.strftime("%H:%M:%S")}]', *a, flush=True)


def draw(args, out, label):
    """
    Z-Image's picture, through stable-diffusion.cpp, into `out` (left as it is where it was made):
    the GPU's memory PyTorch holds for PBRify given back first, and the model's weights moved to the
    GPU as it needs them where it lacks room for them all.
    """
    if os.path.exists(out):
        return
    cmd = SD + args + ['-o', out]
    env = {k: v for k, v in os.environ.items() if k != 'LD_LIBRARY_PATH'}
    P.free()
    t = time.time()
    done = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if done.returncode != 0:
        done = subprocess.run(cmd + ['--offload-to-cpu'], env=env, capture_output=True, text=True)
    if done.returncode != 0:
        raise SystemExit('stable-diffusion.cpp failed:\n' + '\n'.join(l for l in (done.stdout + done.stderr).splitlines() if l.startswith(('[E]', '[W]')))[-3000:])
    log(label, os.path.basename(out), f'{time.time() - t:.1f}s')


def diffuse(out, prompt, w, h, seed, circular=None):
    draw(['-p', prompt, '-W', str(w), '-H', str(h), '--seed', str(seed)] + ([circular] if circular is not None else []), out, 'diffused')


def material(rgb, base):
    """A picture's normal, ORM and height maps; the normal's green turned to point up the picture, as the engine reads it (PBRify's points down)."""
    t = time.time()
    n, orm, height = P.maps(rgb)
    n[..., 1] = 1 - n[..., 1]
    P.save(base + '.normal.png', n)
    P.save(base + '.orm.png', orm)
    P.save(base + '.height.png', height)
    log('maps', os.path.basename(base), f'{time.time() - t:.1f}s')


def resize(rgb, w, h):
    return np.asarray(Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)).resize((w, h), Image.LANCZOS)).astype(np.float32) / 255


def enlarge(rgb, alpha, passes):
    """Four times, or eight by a second pass over the first's result at half its size."""
    big = P.run(DAT, rgb)
    a = P.upscale_alpha(alpha, 4)
    if passes == 2:
        h, w, _ = big.shape
        big = P.run(DAT, resize(big, w // 2, h // 2))
        a = P.upscale_alpha(alpha, 8)
    return big, a


def atlas_job(src, base, passes):
    if os.path.exists(base + '.orm.png'):
        return
    t = time.time()
    rgb, a = P.load(src)
    big, alpha = enlarge(rgb, a, passes)
    P.save(base + '.png', np.concatenate([big, alpha[..., None]], axis=2))
    log('enlarged', os.path.basename(src), big.shape, f'{time.time() - t:.1f}s')
    material(big, base)


def floor_regions(stage):
    """A stage's floor regions: the corner, in its atlas, of each distinct cell of its ground, in the order first met."""
    data = open(DATA + f'stages/{stage:02d}.gnd', 'rb').read()
    seen = []
    for c in range(100):
        corners = [struct.unpack_from('<HH', data, 8 + (c * 4 + k) * 4) for k in range(4)]
        corner = (min(u for u, _ in corners), min(v for _, v in corners))
        if corner not in seen:
            seen.append(corner)
    return seen


def floor_block(stage, regions):
    """
    How a stage's ground lays its regions: the smallest block (rows of region indices) its 10 by 10
    cells repeat, where every region shows once in it; else one row of them all.
    """
    data = open(DATA + f'stages/{stage:02d}.gnd', 'rb').read()
    grid = []
    for c in range(100):
        corners = [struct.unpack_from('<HH', data, 8 + (c * 4 + k) * 4) for k in range(4)]
        grid.append(regions.index((min(u for u, _ in corners), min(v for _, v in corners))))
    for rows in range(1, 11):
        for cols in range(1, 11):
            if rows * cols != len(regions):
                continue
            if all(grid[r * 10 + c] == grid[(r % rows) * 10 + c % cols] for r in range(10) for c in range(10)):
                return [[grid[r * 10 + c] for c in range(cols)] for r in range(rows)]
    return [list(range(len(regions)))]


def floors_job(stages):
    """Each stage's floor: its regions enlarged sixteen times, with the grain of the material Z-Image draws for it."""
    os.makedirs(OUT + 'stages', exist_ok=True)
    os.makedirs(CACHE + 'out', exist_ok=True)
    todo = [s for s in stages if not os.path.exists(OUT + f'stages/{s:02d}.floor.orm.png') and os.path.exists(DATA + f'stages/{s:02d}.gnd')]
    # Every floor's details drawn first, while nothing of PBRify's holds the GPU's memory.
    for stage in todo:
        for k, (label, prompt) in enumerate(FLOOR_DETAILS[stage]):
            diffuse(CACHE + f'out/{stage:02d}-{label}.png', prompt, 1024, 1024, 40 + stage * 2 + k, '--circular')
    for stage in todo:
        name = f'{stage:02d}'
        regions = floor_regions(stage)
        details = []
        for k, (label, prompt) in enumerate(FLOOR_DETAILS[stage]):
            path = CACHE + f'out/{name}-{label}.png'
            img = np.asarray(Image.open(path).convert('RGB')).astype(np.float32) / 255
            blur = np.asarray(Image.open(path).convert('RGB').filter(ImageFilter.GaussianBlur(16))).astype(np.float32) / 255
            lum = lambda x: x @ np.array([0.299, 0.587, 0.114], np.float32)
            details.append((lum(img) + 0.02) / (lum(blur) + 0.02))
        rgb, _ = P.load(DATA + f'stages/{name}.png')
        cell = 1024
        columns = 4
        rows = (len(regions) + columns - 1) // columns
        out = np.zeros((rows * cell, columns * cell, 3), np.float32)
        for k, (x, y) in enumerate(regions):
            region = rgb[y:y + 64, x:x + 64]
            big = P.run(DAT, np.pad(region, ((8, 8), (8, 8), (0, 0)), mode='wrap'))[32:-32, 32:-32]
            smooth = resize(big, cell, cell)
            smooth = np.asarray(Image.fromarray((smooth * 255 + 0.5).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2))).astype(np.float32) / 255
            if len(details) == 2:
                r, g, b = smooth[..., 0], smooth[..., 1], smooth[..., 2]
                green = np.clip((g - np.maximum(r, b)) * 6, 0, 1)
                pale = np.clip(((r + g + b) / 3 - 0.35) * 5, 0, 1)
                sandy = np.clip(pale * (1 - green), 0, 1)
                d = details[0] * (1 - sandy) + details[1] * sandy
            else:
                d = details[0]
            row, col = divmod(k, columns)
            out[row * cell:(row + 1) * cell, col * cell:(col + 1) * cell] = np.clip(smooth * d[..., None], 0, 1)
        P.save(OUT + f'stages/{name}.floor.png', out)
        with open(OUT + f'stages/{name}.floor.json', 'w') as f:
            json.dump({'cell': cell, 'columns': columns, 'regions': regions, 'size': 64}, f)
        material(out, OUT + f'stages/{name}.floor')
        log('floor', name)


# Each arcade stage's materials, for the detail Z-Image draws over its atlas; and the tiles it is drawn in (texels), and how much they overlap.
STAGE_DETAILS = {
    '10': 'photograph of a jungle temple ruin: weathered grey granite cliff faces, ancient stone carvings and bas-reliefs, carved stone faces, moss and tropical plants, sharp, high detail, natural daylight',
}
TILE = 1024
OVERLAP = 128


def detail_job(names):
    """A stage's enlarged atlas redrawn by Z-Image at low strength, in overlapping tiles, its transparency kept; its maps made again. The atlas it was drawn from is kept beside it (`.sr.png`)."""
    os.makedirs(CACHE + 'out', exist_ok=True)
    for name in names:
        base = OUT + f'arcade/stages/{name}'
        if os.path.exists(base + '.sr.png') or not os.path.exists(base + '.png'):
            continue
        rgba = np.asarray(Image.open(base + '.png').convert('RGBA')).astype(np.float32) / 255
        h, w, _ = rgba.shape
        out = np.zeros((h, w, 3), np.float32)
        weight = np.zeros((h, w, 1), np.float32)
        th, tw = min(TILE, h), min(TILE, w)
        ys = list(range(0, h - th + 1, th - OVERLAP)) if h > th else [0]
        xs = list(range(0, w - tw + 1, tw - OVERLAP)) if w > tw else [0]
        if ys[-1] + th < h:
            ys.append(h - th)
        if xs[-1] + tw < w:
            xs.append(w - tw)
        ramp = lambda n: np.minimum(1, np.minimum(np.arange(n) + 1, n - np.arange(n)) / OVERLAP).astype(np.float32)
        feather = (ramp(th)[:, None] * ramp(tw)[None, :])[..., None]
        for y in ys:
            for x in xs:
                tile = rgba[y:y + th, x:x + tw, :3]
                src = CACHE + f'out/{name}-tile-{y}-{x}.png'
                dst = CACHE + f'out/{name}-tile-{y}-{x}.detail.png'
                Image.fromarray((tile * 255 + 0.5).astype(np.uint8)).save(src)
                draw(['-p', STAGE_DETAILS[name], '-W', str(tw), '-H', str(th), '--seed', str(7000 + y + x), '-i', src, '--strength', '0.38'], dst, 'detailed')
                drawn = np.asarray(Image.open(dst).convert('RGB')).astype(np.float32) / 255
                out[y:y + th, x:x + tw] += drawn * feather
                weight[y:y + th, x:x + tw] += feather
        detailed = out / np.maximum(weight, 1e-6)
        os.replace(base + '.png', base + '.sr.png')
        P.save(base + '.png', np.concatenate([detailed, rgba[..., 3:]], axis=2))
        material(detailed, base)
        log('detail', name)


# The floors drawn anew from their regions (stone a blur of blotches at the original's size), and how strongly.
FLOOR_REDRAWS = {
    4: ('seamless orthographic top-down albedo texture of a courtyard floor of large light grey granite flagstones, big rectangular slabs of varied lengths laid in neat staggered rows, thin dark straight joints, subtle weathering, flat even diffuse light, no shadows, sharp, high detail', 1.0),
}


def floor_redraw_job():
    """
    A stone floor's regions drawn again by Z-Image as stones with sharp joints, together: laid as
    its ground lays them (`floor_block`), each enlarged so the block is about a million texels, so
    they share one look and run on into each other; the block seamless, enlarged four times and
    cut back into its cells; the floor's maps from that.
    """
    os.makedirs(OUT + 'stages', exist_ok=True)
    os.makedirs(CACHE + 'out', exist_ok=True)
    for stage, (prompt, strength) in FLOOR_REDRAWS.items():
        name = f'{stage:02d}'
        marker = OUT + f'stages/{name}.floor.json'
        drawn = [prompt, strength, 'block']
        if os.path.exists(marker) and json.load(open(marker)).get('drawn') == drawn:
            continue
        regions = floor_regions(stage)
        block = floor_block(stage, regions)
        rows, cols = len(block), len(block[0])
        rgb, _ = P.load(DATA + f'stages/{name}.png')
        cell = 1024
        part = min(512, int((1 << 20) / (rows * cols)) ** 0.5 // 16 * 16)
        columns = 4
        out = np.zeros((((len(regions) + columns - 1) // columns) * cell, columns * cell, 3), np.float32)
        tag = hashlib.sha256(f'{prompt}|{strength}|block'.encode()).hexdigest()[:12]
        src = CACHE + f'out/{name}-floor-block.png'
        dst = CACHE + f'out/{name}-floor-block.{tag}.drawn.png'
        laid = np.zeros((rows * part, cols * part, 3), np.float32)
        for r, row in enumerate(block):
            for c, k in enumerate(row):
                x, y = regions[k]
                big = P.run(DAT, np.pad(rgb[y:y + 64, x:x + 64], ((8, 8), (8, 8), (0, 0)), mode='wrap'))[32:-32, 32:-32]
                laid[r * part:(r + 1) * part, c * part:(c + 1) * part] = resize(big, part, part)
        Image.fromarray((laid * 255 + 0.5).astype(np.uint8)).save(src)
        draw(['-p', prompt, '-W', str(cols * part), '-H', str(rows * part), '--seed', str(9000 + stage * 16), '-i', src, '--strength', str(strength), '--circular'], dst, 'floor drawn')
        drawn_block = np.asarray(Image.open(dst).convert('RGB')).astype(np.float32) / 255
        wide = resize(P.run(DAT, drawn_block), cols * cell, rows * cell)
        for r, row in enumerate(block):
            for c, k in enumerate(row):
                at_row, at_col = divmod(k, columns)
                out[at_row * cell:(at_row + 1) * cell, at_col * cell:(at_col + 1) * cell] = wide[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell]
        P.save(OUT + f'stages/{name}.floor.png', out)
        material(out, OUT + f'stages/{name}.floor')
        with open(marker, 'w') as f:
            json.dump({'cell': cell, 'columns': columns, 'regions': regions, 'size': 64, 'drawn': drawn}, f)
        log('floor redrawn', name)


# The stages with a sky of their own: the sun as the stage's look in src/present/3d/stage/looks.ts has
# it, the clouds' seed and cover, the haze, the picture's brightness; and the panorama's rows and the
# hint `ridge.py` finds its land's top by.
SKIES = {
    '10': ({'sun': [-0.4, 0.8, 0.45], 'seed': 10}, (5, 'sea')),
    '04': ({'sun': [0.42, 0.11, 0.9], 'seed': 4, 'coverage': 0.5, 'mie': 12e-6, 'exposure': 1.6}, (6, 'forest')),
}


def skies_job():
    """Each stage's sky (`sky.mjs`, by single scattering, its clouds ray-marched) and its panorama's ridge."""
    os.makedirs(OUT + 'sky', exist_ok=True)
    for name, (settings, (rows, hint)) in SKIES.items():
        out = OUT + f'sky/{name}.png'
        if not os.path.exists(out):
            subprocess.run(['node', ROOT + '/scripts/remaster/sky.mjs', json.dumps({**settings, 'out': out})], check=True)
        if not os.path.exists(OUT + f'sky/{name}.ridge.json') and os.path.exists(DATA + f'arcade/stages/{name}.sky.png'):
            subprocess.run([sys.executable, '-I', ROOT + '/scripts/remaster/ridge.py', name, str(rows), hint], check=True)


# Every part, in the order the GPU's memory wants: what Z-Image draws before what PBRify enlarges from it.
ALL = ['all-floors', 'floor-redraw', 'all-fighters', 'all-stages', 'detail-stages', 'all-panoramas', 'all-pictures', 'skies']
MANIFEST_FORMAT = 1


def all_job(jobs):
    """Every part, then the list of them the game looks for."""
    for job in ALL:
        log('start', job)
        jobs[job]()
        log('end', job)
    with open(OUT + 'manifest.json', 'w') as f:
        json.dump({'format': MANIFEST_FORMAT, 'made': ALL}, f)
    log('manifest written')


def all_atlases(folder, passes, skip=()):
    """Every atlas in a folder of the imported data (none where it is not there: the arcade's, without a dump of the board)."""
    if not os.path.isdir(DATA + folder):
        return
    os.makedirs(OUT + folder, exist_ok=True)
    for f in sorted(os.listdir(DATA + folder)):
        if not f.endswith('.png') or any(k in f for k in skip):
            continue
        atlas_job(DATA + f'{folder}/{f}', OUT + f'{folder}/{f[:-4]}', passes)


def panoramas_job():
    """The arcade stages' panoramas enlarged (none without a dump of the board)."""
    if not os.path.isdir(DATA + 'arcade/stages'):
        return
    os.makedirs(OUT + 'arcade/stages', exist_ok=True)
    for f in sorted(os.listdir(DATA + 'arcade/stages')):
        if not f.endswith('.sky.png') or os.path.exists(OUT + f'arcade/stages/{f}'):
            continue
        t = time.time()
        rgb, a = P.load(DATA + f'arcade/stages/{f}')
        big = P.run(DAT, rgb)
        P.save(OUT + f'arcade/stages/{f}', np.concatenate([big, P.upscale_alpha(a, 4)[..., None]], axis=2))
        log('panorama', f, big.shape, f'{time.time() - t:.1f}s')


def pictures_job(names):
    """A picture's original texels (every fourth of the imported one, which keeps them), enlarged four times."""
    os.makedirs(OUT + 'pictures', exist_ok=True)
    for name in names:
        if os.path.exists(OUT + f'pictures/{name}.png'):
            continue
        t = time.time()
        rgb, a = P.load(ASSETS + f'pictures/{name}.png')
        big, alpha = enlarge(rgb[::4, ::4], a[::4, ::4], 1)
        P.save(OUT + f'pictures/{name}.png', np.concatenate([big, alpha[..., None]], axis=2))
        log('picture', name, big.shape, f'{time.time() - t:.1f}s')


if __name__ == '__main__':
    every_stage = [s for s in range(20) if os.path.exists(DATA + f'stages/{s:02d}.gnd')]
    jobs = {
        'all-floors': lambda: floors_job(every_stage),
        'all-fighters': lambda: [all_atlases('arcade/fighters', 2), all_atlases('fighters', 2), all_atlases('intro', 1)],
        'all-stages': lambda: [all_atlases(k, 1, skip=('.sky',)) for k in ('arcade/stages', 'stages')],
        'all-panoramas': panoramas_job,
        'all-pictures': lambda: pictures_job(sorted(f[:-4] for f in os.listdir(ASSETS + 'pictures') if f.endswith('.png'))),
        'detail-stages': lambda: detail_job(sorted(STAGE_DETAILS)),
        'floor-redraw': floor_redraw_job,
        'skies': skies_job,
    }
    jobs['all'] = lambda: all_job(jobs)
    log('device', P.DEVICE)
    for job in sys.argv[1:] or ['all']:
        log('start', job)
        jobs[job]()
        log('end', job)
