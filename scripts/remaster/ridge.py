"""
A panorama's ridge: per column of the picture, the row its land's top reaches, and the row taken as
the horizon (`sea`: over the light band of a sea; `forest`: over the dark band of land in front).

    python3 scripts/remaster/ridge.py 10 5 sea
"""
import json
import os
import statistics
import sys
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

stage, rows, horizon_hint = sys.argv[1], int(sys.argv[2]), sys.argv[3]
im = Image.open(f'{ROOT}/public/data/arcade/stages/{stage}.sky.png').convert('RGB')
w, _ = im.size
px = im.load()
bottom = rows * 64 - 1
luma = lambda c: 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
sky = lambda c: (c[2] - c[0] > 30 and luma(c) > 80) or c[2] - c[0] > 60
land = lambda c: luma(c) < 110 and c[2] < 150
tops, bases = [], []
for x in range(w):
    if horizon_hint == 'sea':
        # the land's base: the lowest dark row above the sea's light band
        y = min(bottom, 300)
        while y > 0 and not land(px[x, y]):
            y -= 1
    else:
        # the land's base: the first row up from the bottom out of the dark band in front
        y = bottom
        while y > 0 and luma(px[x, y]) < 56:
            y -= 1
    bases.append(y)
    while y > 0 and not sky(px[x, y]) and (horizon_hint != 'sea' or land(px[x, y])):
        y -= 1
    tops.append(y)
horizon = int(statistics.median(bases))
# a column the scan ran away in takes its neighbours' top
for i, t in enumerate(tops):
    if horizon - t > 150:
        tops[i] = tops[i - 1] if i > 0 else horizon - 10
json.dump({'tops': tops, 'horizon': horizon}, open(f'{ROOT}/public/assets/remaster/sky/{stage}.ridge.json', 'w'))
