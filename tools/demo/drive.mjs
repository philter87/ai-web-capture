export const HOT_X = 4.6, HOT_Y = 2.3;

export async function cursorTo(page, x, y, ms = 650) {
  await page.evaluate(([x, y, ms, hx, hy]) => {
    const c = document.getElementById('bz-cursor');
    c.style.transition = `transform ${ms}ms cubic-bezier(.35,.05,.2,1)`;
    c.style.transform = `translate(${x - hx}px,${y - hy}px)`;
  }, [x, y, ms, HOT_X, HOT_Y]);
  await page.waitForTimeout(ms + 80);
  await page.mouse.move(x, y);
}

export async function click(page, x, y, { move = true, ms = 650 } = {}) {
  if (move) await cursorTo(page, x, y, ms);
  await page.evaluate(([x, y]) => {
    const r = document.getElementById('bz-ring');
    r.style.left = x + 'px'; r.style.top = y + 'px';
    r.classList.remove('go'); void r.offsetWidth; r.classList.add('go');
  }, [x, y]);
  await page.waitForTimeout(120);
  if (move) {
    await page.mouse.click(x, y);
  } else {
    // press in place: a mousemove here would reset the picker's widened selection
    await page.mouse.down();
    await page.mouse.up();
  }
  await page.waitForTimeout(260);
}

/** Centre of an element inside the stage's iframe, in stage coordinates. */
export async function centreOf(frame, selector) {
  const box = await frame.locator(selector).first().boundingBox();
  if (!box) throw new Error('no box for ' + selector);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

export async function type(page, text, delay = 55) {
  await page.keyboard.type(text, { delay });
}

/** Hold a still frame so the viewer can read what just happened. */
export const beat = (page, ms) => page.waitForTimeout(ms);
