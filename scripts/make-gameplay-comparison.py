from pathlib import Path
from PIL import Image, ImageDraw
root=Path('local-remaster/yoshimitsu')
left=Image.open(root/'08-complete/gameplay.jpg').convert('RGB')
right=Image.open(root/'08-tag-green/gameplay.jpg').convert('RGB')
canvas=Image.new('RGB',(left.width+right.width,left.height+42),(18,20,25))
canvas.paste(left,(0,42)); canvas.paste(right,(left.width,42))
d=ImageDraw.Draw(canvas)
d.text((18,14),'BEFORE | earlier playable pass',fill='white')
d.text((left.width+18,14),'AFTER | current fitted/refined pass',fill='white')
canvas.save(root/'08-30k-pass2/gameplay-side-by-side.jpg',quality=95)
