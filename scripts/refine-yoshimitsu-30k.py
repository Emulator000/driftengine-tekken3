"""Create a selective 30k-triangle playable pass from the validated 9,918-triangle mesh."""
import copy, hashlib, importlib.util, json
from pathlib import Path
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('refine', Path(__file__).with_name('refine-yoshimitsu-hd.py'))
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
before = root / 'local-remaster/yoshimitsu/08-refined-playable'
out = root / 'local-remaster/yoshimitsu/08-30k-pass4'
out.mkdir(exist_ok=True)
source = json.loads((before/'yoshimitsu_enhanced.source.json').read_text())
report = mod.refine(source, limit=30000, joints=(1, 2, 4, 5, 8, 9, 12, 13, 14, 15, 16, 17))
if report['triangles_after'] < 28000:
    second = mod.refine(source, limit=30000, joints=(1, 2, 4, 5, 8, 9, 12, 13, 14, 15, 16, 17))
    report.update({f'second_{k}': v for k, v in second.items()})
    report['triangles_after'] = second['triangles_after']
assert source['mesh']['indices'].__len__() // 3 <= 30000
(out/'yoshimitsu_enhanced.source.json').write_text(json.dumps(source, separators=(',', ':')))
texture = Image.open(root/'public/assets/overrides/yoshimitsu/08.png').convert('RGBA')
texture.resize((4096, 4096), Image.Resampling.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.1, percent=70, threshold=3)).save(out/'yoshimitsu_diffuse_4k.png')
report.update(texture_before=[2048,2048], texture_after=[4096,4096], texture_method='CPU Lanczos 4k resample with restrained sharpening', source_sha256=hashlib.sha256((before/'yoshimitsu_enhanced.source.json').read_bytes()).hexdigest())
(out/'refinement.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
