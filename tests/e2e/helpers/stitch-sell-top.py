from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

dir = Path("/workspace/shots3")
labels = [
    ("v2u-sell-top-open.png", "Open"),
    ("v2u-sell-top-busy.png", "Busy"),
    ("v2u-sell-top-closed.png", "Closed"),
]
imgs = [(Image.open(dir / n).convert("RGB"), cap) for n, cap in labels]
gap, label_h, pad = 16, 28, 16
w = max(im.width for im, _ in imgs) + pad * 2
h = pad + sum(im.height + label_h + gap for im, _ in imgs) - gap + pad
canvas = Image.new("RGB", (w, h), (245, 244, 241))
draw = ImageDraw.Draw(canvas)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
except OSError:
    font = ImageFont.load_default()
y = pad
for im, cap in imgs:
    draw.text((pad, y), cap, fill=(33, 33, 33), font=font)
    y += label_h
    canvas.paste(im, (pad, y))
    y += im.height + gap
canvas.save(dir / "v2u-sell-top.png")
