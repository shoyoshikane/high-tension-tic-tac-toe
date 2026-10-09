import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {EventEmitter} from 'node:events';

const html=await readFile(new URL('./dist/index.html',import.meta.url),'utf8');
const seed=[{type:'place',i:0,player:1},{type:'place',i:2,player:2}];
const realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout;
let counter=0;
test('invite sharing uses the device share menu, falls back to copying, and leaves cancellation alone',async()=>{
  const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  try{
    for(const kind of ['share','unsupported','failed','cancelled','manual']){
      const ui=await setup([]);let shared=null,copied=null;
      try{
        const navigator={clipboard:{writeText:async url=>{if(kind==='manual')throw new Error('Clipboard unavailable');copied=url;}}};
        if(!['unsupported','manual'].includes(kind))navigator.share=async data=>{shared=data;if(kind==='failed')throw new Error('Sharing unavailable');if(kind==='cancelled')throw Object.assign(new Error('Cancelled'),{name:'AbortError'});};
        Object.defineProperty(globalThis,'navigator',{configurable:true,value:navigator});
        const link='https://game.test/#room=host';ui.w.document.getElementById('invite-link').value=link;
        await ui.w.document.getElementById('copy-invite').onclick();
        if(kind==='share'){assert.equal(shared.url,link);assert.equal(shared.title,'ハイテンション三目並べ');assert.equal(copied,null);}
        if(['unsupported','failed'].includes(kind))assert.equal(copied,link);
        if(kind==='cancelled')assert.equal(copied,null);
        if(kind==='manual')assert.equal(ui.w.document.getElementById('invite-link').hidden,false);
      }finally{ui.close();}
    }
  }finally{if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;}
});
async function setup(log=seed,watch=false){
  const dom=new JSDOM(html,{url:watch?'https://game.test/#room=host&watch=1':'https://game.test/'}),w=dom.window;
  const originalPeer=globalThis.Peer;let peer;
  if(watch)globalThis.Peer=class extends EventEmitter{
    constructor(){super();peer=this;}
    connect(){this.conn=new EventEmitter();this.conn.open=true;this.conn.send=()=>{};this.conn.close=()=>this.conn.emit('close');return this.conn;}
  };
  const cpuTimers=[];
  Object.assign(globalThis,{document:w.document,history:w.history,location:w.location,matchMedia:()=>({matches:true}),addEventListener:w.addEventListener.bind(w)});
  globalThis.setTimeout=(fn,ms,...args)=>{if(ms!==600)return realSetTimeout(fn,ms,...args);const timer={cpu:true,fn,cancelled:false};cpuTimers.push(timer);return timer;};
  globalThis.clearTimeout=timer=>{if(timer?.cpu)timer.cancelled=true;else realClearTimeout(timer);};
  const captures=new Set();
  w.Element.prototype.setPointerCapture=id=>captures.add(id);
  w.Element.prototype.hasPointerCapture=id=>captures.has(id);
  w.Element.prototype.releasePointerCapture=id=>captures.delete(id);
  w.Element.prototype.getBoundingClientRect=function(){
    const i=Number(this.dataset.cell??0),x=100+(i%5)*80,y=100+Math.floor(i/5)*80,size=this.id==='board'?400:80;
    return {x,y,left:x,top:y,right:x+size,bottom:y+size,width:size,height:size};
  };
  w.localStorage.setItem('high-tension-v1',JSON.stringify({state:{log},mode:'cpu'}));
  globalThis.localStorage=w.localStorage;
  await import(new URL(`./dist/app.js?events=${++counter}`,import.meta.url));
  if(watch){peer.emit('open','viewer');peer.conn.emit('open');peer.conn.emit('data',{type:'state',version:1,match:'match',rev:seed.length,log:seed,votes:[false,false],playing:true});}
  const cell=i=>w.document.querySelector(`[data-cell="${i}"]`),board=w.document.getElementById('board');
  const pointer=(type,x,y,{touch=false,id=1,target=board}={})=>{
    const event=new w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});
    Object.defineProperties(event,{pointerId:{value:id},isPrimary:{value:true},pointerType:{value:touch?'touch':'mouse'}});
    target.dispatchEvent(event);
  };
  const start=(x=140,y=140,opts={})=>pointer('pointerdown',x,y,{target:cell(0),...opts});
  const saved=()=>JSON.parse(w.localStorage.getItem('high-tension-v1')).state.log;
  return {w,cell,board,pointer,start,saved,peer,runCpu:()=>cpuTimers.findLast(t=>!t.cancelled)?.fn(),close:()=>{peer?.conn.close();globalThis.Peer=originalPeer;dom.window.close();}};
}
test('spectator UI blocks pointer, click and keyboard moves and hides rematch controls',async()=>{
  const ui=await setup([],true);
  try{
    assert.match(ui.w.document.getElementById('turn-label').textContent,/観戦中/);
    assert.equal(ui.w.document.getElementById('spectator-badge').hidden,false);
    assert.equal(ui.w.document.body.classList.contains('spectating'),true);
    assert.equal(ui.w.document.getElementById('copy-watch'),null);
    assert.equal(ui.w.document.getElementById('reset').hidden,true);assert.equal(ui.w.document.getElementById('undo').hidden,true);
    assert.ok([...ui.board.children].every(el=>el.disabled));
    assert.doesNotMatch(ui.w.document.getElementById('players').textContent,/あなた|相手/);
    ui.start();ui.pointer('pointermove',210,140);ui.pointer('pointerup',210,140);ui.cell(12).click();
    ui.cell(0).dispatchEvent(new ui.w.MouseEvent('click',{bubbles:true}));
    for(const key of ['Enter','ArrowRight','Enter'])ui.w.document.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key,bubbles:true}));
    assert.equal(ui.board.querySelectorAll('.stone').length,2);assert.equal(ui.saved().length,0);
    ui.peer.conn.emit('data',{type:'state',version:1,match:'match',rev:2,log:seed,votes:[false,false],playing:false});
    assert.match(ui.w.document.getElementById('turn-label').textContent,/接続待ち/);
  }finally{ui.close();}
});
test('the UI only offers CPU/online and identifies black as first, white as second',async()=>{
  const ui=await setup();
  assert.equal(ui.w.document.querySelectorAll('.modes button').length,2);
  assert.equal(ui.w.document.getElementById('local'),null);
  assert.equal(ui.w.document.getElementById('spectator-badge').hidden,true);
  assert.equal(ui.w.document.body.classList.contains('spectating'),false);
  assert.match(ui.w.document.querySelector('[data-player="1"]').textContent,/先攻/);
  assert.match(ui.w.document.querySelector('[data-player="2"]').textContent,/後攻/);
  assert.ok(ui.cell(0).querySelector('.stone.p1'));assert.ok(ui.cell(2).querySelector('.stone.p2'));ui.close();
});
test('drag previews both pieces in a collision, then release commits a single move',async()=>{
  const ui=await setup();ui.start();ui.pointer('pointermove',210,140);
  assert.equal(ui.w.document.getElementById('drag-guide').hasAttribute('hidden'),false);
  assert.ok(ui.cell(1).querySelector('.p1'));assert.ok(ui.cell(4).querySelector('.p2'));
  assert.equal(ui.saved().length,2);
  ui.pointer('pointerup',210,140);ui.cell(12).click();
  assert.equal(ui.w.document.getElementById('drag-guide').hasAttribute('hidden'),true);
  assert.equal(ui.saved().length,3);assert.deepEqual(ui.saved().at(-1),{type:'flick',i:0,dr:0,dc:1,player:1});
  assert.ok(ui.cell(1).querySelector('.p1'));assert.ok(ui.cell(4).querySelector('.p2'));ui.close();
});
test('tiny, invalid, outside, returned and interrupted gestures leave the board unchanged',async()=>{
  for(const kind of ['tiny','invalid','outside','returned','cancel','escape']){
    const ui=await setup();ui.start();
    if(kind==='tiny'){ui.pointer('pointermove',148,140);ui.pointer('pointerup',148,140);}
    else if(kind==='invalid'){ui.pointer('pointermove',115,140);ui.pointer('pointerup',115,140);}
    else{
      ui.pointer('pointermove',210,140);
      if(kind==='outside'){ui.pointer('pointermove',550,140);ui.pointer('pointerup',550,140);}
      if(kind==='returned'){ui.pointer('pointermove',140,140);ui.pointer('pointerup',140,140);}
      if(kind==='cancel')ui.pointer('pointercancel',210,140);
      if(kind==='escape'){ui.w.document.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));ui.pointer('pointerup',210,140);}
    }
    assert.equal(ui.saved().length,2,kind);assert.ok(ui.cell(0).querySelector('.p1'),kind);assert.ok(ui.cell(2).querySelector('.p2'),kind);ui.close();
  }
});
test('touch drags snap diagonally and cannot move the opponent piece',async()=>{
  const ui=await setup();ui.start(140,140,{touch:true,id:10});ui.pointer('pointermove',210,210,{touch:true,id:10});ui.pointer('pointerup',210,210,{touch:true,id:10});
  assert.deepEqual(ui.saved().at(-1),{type:'flick',i:0,dr:1,dc:1,player:1});assert.ok(ui.cell(24).querySelector('.p1'));
  ui.pointer('pointerdown',300,140,{target:ui.cell(2)});ui.pointer('pointermove',350,140);ui.pointer('pointerup',350,140);assert.equal(ui.saved().length,3);ui.close();
});
test('keyboard selects, previews and commits, while Escape cancels',async()=>{
  const ui=await setup();ui.cell(0).click();
  const press=key=>ui.w.document.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  press('ArrowRight');assert.equal(ui.saved().length,2);press('Escape');assert.ok(ui.cell(0).querySelector('.p1'));
  ui.cell(0).click();press('ArrowRight');press('Enter');assert.equal(ui.saved().length,3);assert.ok(ui.cell(1).querySelector('.p1'));ui.close();
});
test('placing still works with no action-mode switch',async()=>{
  const ui=await setup();ui.cell(12).click();assert.deepEqual(ui.saved().at(-1),{type:'place',i:12,player:1});assert.ok(ui.cell(12).querySelector('.p1'));ui.close();
});
test('CPU plays white and undo restores the human black turn',async()=>{
  const ui=await setup([]);ui.cell(0).click();ui.runCpu();
  assert.equal(ui.saved().length,2);assert.equal(ui.saved()[1].player,2);
  assert.match(ui.w.document.getElementById('turn-label').textContent,/あなたの番/);
  ui.w.document.getElementById('undo').click();assert.equal(ui.saved().length,0);
  assert.match(ui.w.document.getElementById('turn-label').textContent,/あなたの番/);ui.close();
});
