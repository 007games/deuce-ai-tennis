time.sleep(8)
for k in range(8):
    pg.screenshot(path=f"tools/burst{k}.png", clip={"x":450,"y":250,"width":700,"height":600})
    time.sleep(0.12)
