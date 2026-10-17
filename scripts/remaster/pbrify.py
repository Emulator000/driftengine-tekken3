"""
PBRify's upscaler and material models over a picture in tiles, on the GPU where PyTorch has one
(CUDA's, ROCm's, which PyTorch names alike, or a Mac's through Metal), else the CPU; on the CPU
alone where REMASTER_DEVICE is `cpu`.
"""
import os

# On a Mac, an operation Metal's PyTorch lacks runs on the CPU rather than stopping the run.
os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')

import numpy as np
import torch
from PIL import Image, ImageFilter
from spandrel import ModelLoader

W = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.cache', 'remaster', 'weights', 'pbrify') + os.sep
DEVICE = ('cpu' if os.environ.get('REMASTER_DEVICE') == 'cpu' else 'cuda' if torch.cuda.is_available()
          else 'mps' if torch.backends.mps.is_available() else 'cpu')
# The tile's side by device: a Mac's GPU shares its memory with everything else.
TILE = {'cuda': 512, 'mps': 256}.get(DEVICE, 192)
_models = {}


def model(name):
    if name not in _models:
        m = ModelLoader().load_from_file(W + name)
        m.model.eval()
        m.to(DEVICE)
        _models[name] = m
    return _models[name]


@torch.inference_mode()
def run(name, rgb, tile=None, pad=16):
    """rgb: float32 HxWx3 in 0..1. Returns float32 (H*s)x(W*s)xC."""
    m = model(name)
    s = m.scale
    tile = tile or TILE
    h, w, _ = rgb.shape
    src = np.pad(rgb, ((pad, pad), (pad, pad), (0, 0)), mode='reflect')
    out = None
    for y in range(0, h, tile):
        for x in range(0, w, tile):
            th, tw = min(tile, h - y), min(tile, w - x)
            block = src[y:y + th + 2 * pad, x:x + tw + 2 * pad]
            t = torch.from_numpy(np.ascontiguousarray(block.transpose(2, 0, 1)))[None].to(DEVICE)
            r = m(t)[0].clamp(0, 1).cpu().numpy().transpose(1, 2, 0)
            if out is None:
                out = np.zeros((h * s, w * s, r.shape[2]), np.float32)
            out[y * s:(y + th) * s, x * s:(x + tw) * s] = r[pad * s:(pad + th) * s, pad * s:(pad + tw) * s]
    return out


def free():
    """The GPU memory PyTorch keeps cached, given back."""
    if DEVICE == 'cuda':
        torch.cuda.empty_cache()
    elif DEVICE == 'mps':
        torch.mps.empty_cache()


def load(path):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).astype(np.float32) / 255
    return a[..., :3], a[..., 3]


def save(path, arr):
    arr = np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8)
    if arr.ndim == 3 and arr.shape[2] == 1:
        arr = arr[..., 0]
    Image.fromarray(arr).save(path)


def upscale_alpha(alpha, s):
    im = Image.fromarray((alpha * 255).astype(np.uint8))
    return np.asarray(im.resize((im.width * s, im.height * s), Image.BICUBIC)).astype(np.float32) / 255


def maps(rgb):
    """Normal, ORM (occlusion from the height's cavities, roughness, no metal) and height for an albedo."""
    n = run('1x-PBRify_NormalV3.pth', rgb)
    rough = run('1x-PBRify_RoughnessV2.pth', rgb)[..., :1]
    height = run('1x-PBRify_Height.pth', rgb)[..., :1]
    hi = Image.fromarray((height[..., 0] * 255).astype(np.uint8))
    blur = np.asarray(hi.filter(ImageFilter.GaussianBlur(6))).astype(np.float32)[..., None] / 255
    occ = np.clip(1 - 2.0 * np.maximum(blur - height, 0), 0, 1)
    orm = np.concatenate([occ, rough, np.zeros_like(rough)], axis=2)
    return n[..., :3], orm, height

