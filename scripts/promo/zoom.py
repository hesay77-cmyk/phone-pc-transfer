# zoom.py <in_dir> <out_dir> <cx> <cy> <zoom> <t0> <t1> [fps]
# Smooth sub-pixel camera push-in on a high-res capture, output 1920x1080.
import sys, os
from PIL import Image
src, dst, cx, cy, Z, t0, t1 = sys.argv[1], sys.argv[2], *map(float, sys.argv[3:8])
fps = float(sys.argv[8]) if len(sys.argv) > 8 else 30
os.makedirs(dst, exist_ok=True)
files = sorted(f for f in os.listdir(src) if f.endswith('.jpg'))
def ease(u): return u * u * u * (u * (u * 6 - 15) + 10)  # smootherstep
for i, f in enumerate(files):
    t = i / fps
    u = ease(min(1, max(0, (t - t0) / (t1 - t0))))
    z = 1 + (Z - 1) * u
    im = Image.open(os.path.join(src, f)); W, H = im.size
    w, h = W / z, H / z
    # move centre from frame centre to (cx, cy) fractions, clamped inside the frame
    x = (0.5 + (cx - 0.5) * u) * W; y = (0.5 + (cy - 0.5) * u) * H
    x0 = min(max(x - w / 2, 0), W - w); y0 = min(max(y - h / 2, 0), H - h)
    out = im.transform((1920, 1080), Image.Transform.EXTENT, (x0, y0, x0 + w, y0 + h), Image.Resampling.BICUBIC) if False else \
        im.resize((1920, 1080), Image.Resampling.LANCZOS, box=(x0, y0, x0 + w, y0 + h))
    out.save(os.path.join(dst, f), quality=94)
