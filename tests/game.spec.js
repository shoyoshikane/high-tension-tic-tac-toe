import {test,expect} from '@playwright/test';
async function localSignaling(page){
  await page.addInitScript(()=>{globalThis.__PEER_OPTIONS__={host:'127.0.0.1',port:9000,path:'/peerjs',secure:false,config:{iceServers:[]}};});
}
async function createPair(browser,cloud=false){
  const a=await browser.newContext({reducedMotion:'reduce'}),b=await browser.newContext({reducedMotion:'reduce'});
  const host=await a.newPage(),guest=await b.newPage();
  if(!cloud){await localSignaling(host);await localSignaling(guest);}
  await host.goto('/');await host.locator('#online').click();
  await expect(host.locator('#invite-link')).not.toHaveValue('',{timeout:15000});
  const invite=await host.locator('#invite-link').inputValue();
  await guest.goto(invite);
  await expect(host.locator('#room-status')).toContainText('接続しました',{timeout:15000});
  await expect(guest.locator('#room-status')).toContainText('接続しました',{timeout:15000});
  return {host,guest,a,b,invite};
}
const cell=(page,i)=>page.locator(`[data-cell="${i}"]`);
test('CPU replies and undo returns to the human turn',async({page})=>{
  await page.goto('/');await page.locator('#cpu').click();await cell(page,0).click();
  await expect(page.locator('.board .stone')).toHaveCount(2);
  await page.locator('#undo').click();await expect(page.locator('.board .stone')).toHaveCount(0);
  await expect(page.locator('#turn-label')).toContainText('あなたの番');
});
test('real WebRTC peers share moves, enforce turns, flick chains, and rematch consent',async({browser})=>{
  const {host,guest,a,b}=await createPair(browser);
  await expect(cell(guest,0)).toBeDisabled();
  await cell(host,0).click();await expect(cell(guest,0).locator('.p1')).toHaveCount(1);
  await expect(cell(host,10)).toBeDisabled();await cell(guest,2).click();
  await expect(cell(host,2).locator('.p2')).toHaveCount(1);
  const origin=await cell(host,0).boundingBox();
  await host.mouse.move(origin.x+origin.width/2,origin.y+origin.height/2);await host.mouse.down();
  await host.mouse.move(origin.x+origin.width/2+55,origin.y+origin.height/2,{steps:5});
  await expect(host.locator('#message')).toContainText('離して弾く');
  await host.mouse.up();
  for(const page of [host,guest]){await expect(cell(page,1).locator('.p1')).toHaveCount(1);await expect(cell(page,4).locator('.p2')).toHaveCount(1);await expect(page.locator('#undo')).toBeHidden();}
  await host.locator('#reset').click();await host.locator('#reset-confirm').click();
  await expect(guest.locator('#room-status')).toContainText('もう一局を希望');
  await expect(guest.locator('.board .stone')).toHaveCount(2);
  await guest.locator('#reset').click();await guest.locator('#reset-confirm').click();
  for(const page of [host,guest])await expect(page.locator('.board .stone')).toHaveCount(0);
  await a.close();await b.close();
});
test('full rooms automatically admit a third player as a spectator and disconnect pauses the board',async({browser})=>{
  const {host,guest,a,b,invite}=await createPair(browser);
  const c=await browser.newContext(),third=await c.newPage();await localSignaling(third);await third.goto(invite);
  await expect(third.locator('#turn-label')).toContainText('観戦中');
  await expect(cell(third,0)).toBeDisabled();await expect(third.locator('#reset')).toBeHidden();
  await expect(third).toHaveURL(/watch=1/);
  await cell(host,0).click();await expect(cell(third,0).locator('.p1')).toHaveCount(1);
  await third.reload();await expect(third.locator('#turn-label')).toContainText('観戦中');
  await expect(cell(third,0).locator('.p1')).toHaveCount(1);
  await b.close();await expect(host.locator('#room-status')).toContainText('接続が切れ',{timeout:12000});
  await expect(cell(host,0)).toBeDisabled();await a.close();await c.close();
});
test('spectators share moves and rematches, reconnect, and cannot operate the board',async({browser})=>{
  const {host,guest,a,b}=await createPair(browser);
  const c=await browser.newContext({reducedMotion:'reduce'}),d=await browser.newContext({reducedMotion:'reduce'});
  try{
    const watch=await host.locator('#watch-link').inputValue();expect(watch).toContain('watch=1');
    const viewers=[await c.newPage(),await d.newPage()];
    for(const viewer of viewers){
      await localSignaling(viewer);await viewer.goto(watch);
      await expect(viewer.locator('#turn-label')).toContainText('観戦中');
      await expect(cell(viewer,0)).toBeDisabled();await expect(viewer.locator('#reset')).toBeHidden();
      await expect(viewer.locator('#undo')).toBeHidden();
    }
    await cell(host,0).click();await expect(cell(guest,0).locator('.p1')).toHaveCount(1);
    await cell(guest,2).click();await expect(cell(host,2).locator('.p2')).toHaveCount(1);
    for(const viewer of viewers){
      await expect(viewer.locator('.board .stone')).toHaveCount(2);
      await expect(viewer.locator('#turn-label')).toContainText('先攻');
      // Even a synthetic event must not bypass the disabled controls.
      await cell(viewer,12).dispatchEvent('click');
    }
    await expect(host.locator('.board .stone')).toHaveCount(2);
    const origin=await cell(host,0).boundingBox();
    await host.mouse.move(origin.x+origin.width/2,origin.y+origin.height/2);await host.mouse.down();
    await host.mouse.move(origin.x+origin.width/2+55,origin.y+origin.height/2,{steps:5});await host.mouse.up();
    for(const viewer of viewers){await expect(cell(viewer,1).locator('.p1')).toHaveCount(1);await expect(cell(viewer,4).locator('.p2')).toHaveCount(1);}
    await viewers[0].reload();await expect(cell(viewers[0],4).locator('.p2')).toHaveCount(1);
    await host.locator('#reset').click();await host.locator('#reset-confirm').click();
    await expect(guest.locator('#room-status')).toContainText('もう一局を希望');
    await guest.locator('#reset').click();await guest.locator('#reset-confirm').click();
    for(const viewer of viewers)await expect(viewer.locator('.board .stone')).toHaveCount(0);
    await b.close();
    for(const viewer of viewers)await expect(viewer.locator('#turn-label')).toContainText('接続待ち',{timeout:12000});
  }finally{await a.close();await b.close();await c.close();await d.close();}
});
test('production PeerJS Cloud connects two browsers and shares a move',async({browser})=>{
  test.skip(!process.env.RUN_CLOUD_SMOKE,'External broker smoke test is enabled in CI.');
  const {host,guest,a,b}=await createPair(browser,true);
  await cell(host,12).click();await expect(cell(guest,12).locator('.p1')).toHaveCount(1);
  await cell(guest,0).click();await expect(cell(host,0).locator('.p2')).toHaveCount(1);
  await a.close();await b.close();
});
test('the same guest can reconnect and resume the authoritative board',async({browser})=>{
  const {host,guest,a,b}=await createPair(browser);
  await cell(host,12).click();await expect(cell(guest,12).locator('.p1')).toHaveCount(1);
  const session=await b.newCDPSession(guest);await session.send('Debugger.enable');await session.send('Debugger.pause');
  await expect(host.locator('#room-status')).toContainText('接続が切れ',{timeout:12000});
  await session.send('Debugger.resume');await session.detach();
  await expect(guest.locator('#room-status')).toContainText('接続が切れ',{timeout:12000});
  await guest.locator('#reconnect').click();
  await expect(guest.locator('#room-status')).toContainText('接続しました',{timeout:15000});
  await expect(cell(guest,12).locator('.p1')).toHaveCount(1);
  await cell(guest,0).click();await expect(cell(host,0).locator('.p2')).toHaveCount(1);
  await a.close();await b.close();
});
