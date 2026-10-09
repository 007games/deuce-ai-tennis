# Record the watch view frame-by-frame (capture mode) and build docs/deuce.gif from the best rally.
import time, os, glob
from playwright.sync_api import sync_playwright
from PIL import Image
FPS, SECONDS, CLIP = 15, 75, 7
W, H = 960, 540
os.makedirs("tools/frames", exist_ok=True)
states = []
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": W, "height": H})
    pg.goto("http://localhost:8452/?capture=1")
    time.sleep(6)
    pg.evaluate("window.__advance(0.016)")
    for i in range(FPS * SECONDS):
        pg.evaluate(f"window.__advance({1 / FPS})")
        st = pg.evaluate("window.__state()")
        states.append(st)
        pg.screenshot(path=f"tools/frames/f{i:04d}.png")
    b.close()
# pick the clip window with the most rally shots in it
n = len(states)
win = FPS * CLIP
hits = [s["hits"] if s else 0 for s in states]
best, best_i = -1, 0
for i in range(0, n - win, 3):
    seg = hits[i:i + win]
    score = sum(1 for k in range(1, len(seg)) if seg[k] > seg[k - 1])
    if score > best:
        best, best_i = score, i
print("best window starts at frame", best_i, "with", best, "shots")
frames = [Image.open(f"tools/frames/f{k:04d}.png").convert("RGB").resize((720, 405), Image.LANCZOS) for k in range(best_i, best_i + win)]
pal = frames[len(frames) // 2].quantize(colors=128, method=Image.Quantize.MEDIANCUT)
q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
q[0].save("docs/deuce.gif", save_all=True, append_images=q[1:], duration=int(1000 / FPS), loop=0, optimize=True)
print("gif size", os.path.getsize("docs/deuce.gif") // 1024, "KB")
Image.open(f"tools/frames/f{best_i + win // 2:04d}.png").convert("RGB").save("docs/screenshot.jpg", quality=86)
