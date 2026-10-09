import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
const cell=(page,i)=>page.locator(`[data-cell="${i}"]`);
const center=async locator=>{const r=await locator.boundingBox();return {x:r.x+r.width/2,y:r.y+r.height/2};};
const startDrag=async(page,i,dx,dy)=>{
  const p=await center(cell(page,i));await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+dx,p.y+dy,{steps:5});await page.clock.runFor(32);return p;
};
const log=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('high-tension-v1')).state.log);
const expectMove=async(page,action)=>{
  // Flush queued input/timers without reaching the CPU's 600 ms response.
  await page.clock.runFor(32);
  try{await expect.poll(async()=> (await log(page)).at(-1)).toMatchObject(action);}
  catch(error){
    console.error('Gesture diagnostics:',JSON.stringify(await page.evaluate(()=>({
      events:window.__gestureEvents,errors:window.__gestureErrors,
      reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
      turn:document.getElementById('turn-label').textContent,
      message:document.getElementById('message').textContent,
      guideHidden:document.getElementById('drag-guide').hasAttribute('hidden'),
      saved:localStorage.getItem('high-tension-v1')
    }))));
    throw error;
  }
};
async function setup(page,seed=[{type:'place',i:0,player:1},{type:'place',i:2,player:2}]){
  await page.route('https://game.test/**',async route=>{
    const url=new URL(route.request().url()),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root)){await route.abort();return;}
    try{const body=await readFile(file),ext=path.extname(file);await route.fulfill({body,contentType:ext==='.js'?'text/javascript':ext==='.css'?'text/css':'text/html'});}catch{await route.fulfill({status:404,body:''});}
  });
  await page.addInitScript(seed=>localStorage.setItem('high-tension-v1',JSON.stringify({state:{log:seed},mode:'cpu'})),seed);
  await page.addInitScript(()=>{
    window.__gestureEvents=[];window.__gestureErrors=[];
    window.addEventListener('error',event=>window.__gestureErrors.push(event.message));
    window.addEventListener('unhandledrejection',event=>window.__gestureErrors.push(String(event.reason)));
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture']){
      document.addEventListener(type,event=>{
        if(!event.target.closest?.('#board'))return;
        const board=document.getElementById('board'),rect=board.getBoundingClientRect();
        window.__gestureEvents.push({type,id:event.pointerId,target:event.target.id||event.target.dataset.cell,
          x:event.clientX,y:event.clientY,captured:board.hasPointerCapture(event.pointerId),
          board:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom}});
      },true);
    }
  });
  await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.goto('https://game.test/');
  await expect(page.locator('.board .stone')).toHaveCount(seed.length);
}
test('two modes, black and white pieces, compact layout and rules',async({page},testInfo)=>{
  await setup(page,[{type:'place',i:0,player:1},{type:'place',i:2,player:2},{type:'place',i:12,player:1},{type:'place',i:24,player:2},{type:'place',i:10,player:1},{type:'place',i:14,player:2}]);
  await expect(page.locator('.modes button')).toHaveCount(2);
  await expect(page.locator('.modes')).toHaveText('CPU対戦オンライン対戦');
  await expect(page.locator('.player[data-player="1"]')).toContainText('先攻');
  await expect(page.locator('.player[data-player="2"]')).toContainText('後攻');
  const color=await page.locator('.stone.p1').first().evaluate(el=>getComputedStyle(el).backgroundImage);
  expect(color).toContain('23, 23, 23');
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:testInfo.outputPath('desktop.png')});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('mobile.png')});
  await page.locator('#rules-open').click();await expect(page.locator('#rules')).toBeVisible();await page.locator('#rules-close').click();
});
test('drag previews a chain and releasing commits exactly one move',async({page})=>{
  await setup(page);await startDrag(page,0,55,0);
  await expect(page.locator('#message')).toContainText('離して弾く');
  await expect(cell(page,1).locator('.p1')).toHaveCount(1);await expect(cell(page,4).locator('.p2')).toHaveCount(1);
  expect((await log(page)).length).toBe(2);
  await page.mouse.up();await expectMove(page,{type:'flick',i:0,dr:0,dc:1});expect((await log(page)).length).toBe(3);
  await expect(cell(page,1).locator('.p1')).toHaveCount(1);await expect(cell(page,4).locator('.p2')).toHaveCount(1);
  await expect(page.locator('#turn-label')).toContainText('CPU');
});
test('short, invalid, outside-board and cancelled drags do not change the game',async({page})=>{
  await setup(page);await startDrag(page,0,8,0);await page.mouse.up();expect((await log(page)).length).toBe(2);
  await startDrag(page,0,-25,0);await page.mouse.up();expect((await log(page)).length).toBe(2);
  await startDrag(page,0,55,0);const board=await page.locator('#board').boundingBox();await page.mouse.move(board.x+board.width+30,board.y+20);await page.mouse.up();expect((await log(page)).length).toBe(2);
  await startDrag(page,0,55,0);await page.keyboard.press('Escape');await page.mouse.up();expect((await log(page)).length).toBe(2);
  await startDrag(page,0,55,0);await page.locator('#board').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();expect((await log(page)).length).toBe(2);
  await expect(cell(page,0).locator('.p1')).toHaveCount(1);await expect(cell(page,2).locator('.p2')).toHaveCount(1);
});
test('diagonal drag, keyboard operation and touch gestures',async({page})=>{
  await setup(page);await startDrag(page,0,50,50);await page.mouse.up();await expectMove(page,{type:'flick',dr:1,dc:1});await expect(cell(page,24).locator('.p1')).toHaveCount(1);
  await page.reload();await cell(page,0).focus();await page.keyboard.press('Enter');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await expectMove(page,{type:'flick',dr:0,dc:1});
  await page.reload();const p=await center(cell(page,0));
  const session=await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+55,y:p.y}]});
  await page.clock.runFor(32);
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await session.detach();
  await expectMove(page,{type:'flick',dr:0,dc:1});
});
