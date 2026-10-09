import sys, time
from playwright.sync_api import sync_playwright
# usage: shot.py out.png [wait_s] [width] [height] [actions]
out = sys.argv[1]; wait = float(sys.argv[2]) if len(sys.argv) > 2 else 15
w = int(sys.argv[3]) if len(sys.argv) > 3 else 1600; h = int(sys.argv[4]) if len(sys.argv) > 4 else 900
act = sys.argv[5] if len(sys.argv) > 5 else ""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": w, "height": h})
    logs = []
    pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
    pg.on("pageerror", lambda e: logs.append("PAGEERROR " + str(e)))
    pg.goto("http://localhost:8452/" + (sys.argv[6] if len(sys.argv) > 6 else ""))
    if act:
        exec(open(act).read())
    time.sleep(wait)
    pg.screenshot(path=out)
    for l in logs: print("LOG", l[:300])
    b.close()
