k = 0
for attempt in range(40):
    time.sleep(1.0)
    f = pg.evaluate("window.__frozen || 0")
    if f > k:
        time.sleep(0.6)
        pg.screenshot(path=f"tools/hit{k}.png")
        k = f
        if k >= 4: break
        pg.evaluate("document.querySelector('#speeds button[data-s=\"1\"]').click()")
