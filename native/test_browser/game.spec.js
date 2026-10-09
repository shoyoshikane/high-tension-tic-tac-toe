import {test, expect} from '@playwright/test';
const read = page => page.evaluate(() => JSON.parse(window.gameTest.state));
const act = (page, method, arg) => page.evaluate(([method, arg]) => window.gameTest[method](arg), [method, arg]);
const move = (page, action) => act(page, 'move', JSON.stringify(action));
async function load(page, hash = '') {
  await page.goto('/' + hash);
  await page.waitForFunction(() => window.gameTest);
}
async function linked(host, guest) {
  await expect.poll(async () => (await read(host)).ready).toBe(true);
  await expect.poll(async () => (await read(guest)).ready).toBe(true);
}
async function hostRoom(page) {
  await load(page); await act(page, 'host');
  await expect.poll(async () => (await read(page)).invite).not.toBe('');
  return new URLSearchParams(new URL((await read(page)).invite).hash.slice(1)).get('room');
}
const cell = (page, label) => page.getByRole('button', {name: label, exact: true});

test('Flutter CPU responds and undo restores the human turn', async ({page}) => {
  await load(page);
  await cell(page, 'A1 空きマス').click();
  await expect.poll(async () => (await read(page)).moves).toBe(2);
  await page.getByRole('button', {name: '一手戻す'}).click();
  await expect.poll(async () => (await read(page)).moves).toBe(0);
});

test('Flutter peers synchronize drags, full-room spectators, reload, rematch and reconnect', async ({browser}) => {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [host, guest, viewer] = await Promise.all(contexts.map(c => c.newPage()));
  try {
    const target = await hostRoom(host);
    await load(guest, '#room=' + target); await linked(host, guest);
    await cell(host, 'A1 空きマス').click();
    await expect.poll(async () => (await read(guest)).moves).toBe(1);
    await cell(guest, 'C1 空きマス').click();
    await expect.poll(async () => (await read(host)).moves).toBe(2);
    await load(viewer, '#room=' + target);
    await expect.poll(async () => (await read(viewer)).spectator).toBe(true);
    await expect(viewer).toHaveURL(/watch=1/);
    await expect(viewer.getByText('観戦モード', {exact: true})).toBeVisible();
    expect(await move(viewer, {type: 'place', i: 12})).toBe(false);
    const origin = await cell(host, 'A1 黒のコマ').boundingBox();
    const x = origin.x + origin.width / 2, y = origin.y + origin.height / 2;
    await host.mouse.move(x, y); await host.mouse.down();
    await host.mouse.move(x + 60, y, {steps: 5}); await host.mouse.up();
    for (const page of [host, guest, viewer]) {
      await expect.poll(async () => (await read(page)).board).toEqual([0, 1, 0, 0, 2, ...Array(20).fill(0)]);
    }
    await viewer.reload(); await viewer.waitForFunction(() => window.gameTest);
    await expect.poll(async () => (await read(viewer)).moves).toBe(3);
    expect((await read(viewer)).spectator).toBe(true);
    await act(host, 'rematch');
    await expect.poll(async () => (await read(guest)).remoteVote).toBe(true);
    expect((await read(guest)).moves).toBe(3);
    await act(guest, 'rematch');
    for (const page of [host, guest, viewer]) await expect.poll(async () => (await read(page)).moves).toBe(0);
    await act(guest, 'disconnect');
    await expect.poll(async () => (await read(host)).ready, {timeout: 15000}).toBe(false);
    await expect.poll(async () => (await read(viewer)).playing).toBe(false);
    await expect.poll(async () => (await read(guest)).ready, {timeout: 15000}).toBe(false);
    await act(guest, 'retry'); await linked(host, guest);
    expect((await read(guest)).spectator).toBe(false);
  } finally { await Promise.all(contexts.map(c => c.close())); }
});

for (const flutterHost of [true, false]) {
  test(`Flutter interoperates with the previous Web version as ${flutterHost ? 'host' : 'guest'}`, async ({browser}) => {
    const a = await browser.newContext(), b = await browser.newContext();
    const flutter = await a.newPage(), legacy = await b.newPage();
    try {
      await legacy.addInitScript(() => { window.__PEER_OPTIONS__ = {host: '127.0.0.1', port: 9000, path: '/peerjs', secure: false, config: {iceServers: []}}; });
      let target;
      if (flutterHost) {
        target = await hostRoom(flutter);
        await legacy.goto('http://127.0.0.1:4173/#room=' + target);
      } else {
        await legacy.goto('http://127.0.0.1:4173/'); await legacy.locator('#online').click();
        await expect(legacy.locator('#invite-link')).not.toHaveValue('');
        target = new URLSearchParams(new URL(await legacy.locator('#invite-link').inputValue()).hash.slice(1)).get('room');
        await load(flutter, '#room=' + target);
      }
      await expect.poll(async () => (await read(flutter)).ready).toBe(true);
      await expect(legacy.locator('#room-status')).toContainText('接続しました');
      if (flutterHost) {
        await move(flutter, {type: 'place', i: 0});
        await expect(legacy.locator('[data-cell="0"] .p1')).toHaveCount(1);
        await legacy.locator('[data-cell="2"]').click();
      } else {
        await legacy.locator('[data-cell="0"]').click();
        await expect.poll(async () => (await read(flutter)).moves).toBe(1);
        await move(flutter, {type: 'place', i: 2});
      }
      await expect.poll(async () => (await read(flutter)).moves).toBe(2);
      await expect(legacy.locator('.board .stone')).toHaveCount(2);
    } finally { await a.close(); await b.close(); }
  });
}
