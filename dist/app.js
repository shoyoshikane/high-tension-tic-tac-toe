import {initial,canPlace,preview,play,actions,choose,lines} from './engine.js';
import {restore} from './protocol.js';
import {Room} from './network.js';

const $=id=>document.getElementById(id);
const names={1:'先攻',2:'後攻'};
const coord=i=>'ABCDE'[i%5]+(Math.floor(i/5)+1);
let s=initial(),mode='cpu',selected=null,ghost=null,aim=null,drag=null;
let busy=false,timer=null,epoch=0,undo=[],room=null,roomText='',requestedMode=null,suppressClick=false;
try {
  const saved=JSON.parse(localStorage.getItem('high-tension-v1'));
  const state=saved&&restore(saved.state?.log);
  if(state){s=state;mode='cpu';}
}catch{}

function persist(){
  if(mode==='online')return;
  try{localStorage.setItem('high-tension-v1',JSON.stringify({state:s,mode}));}catch{}
}
function blocked(){return mode==='online'?!room?.canMove:s.turn===2&&!s.result;}
const stone=(p,extra='')=>`<span class="stone p${p} ${extra}" aria-hidden="true"></span>`;
function render(display=s.board){
  const focusedCell=document.activeElement?.closest('[data-cell]')?.dataset.cell;
  const locked=busy||blocked()||!!s.result;
  document.body.classList.toggle('spectating',mode==='online'&&!!room?.spectator);
  for(const m of ['cpu','online']){
    $(m).classList.toggle('active',mode===m);
    $(m).setAttribute('aria-pressed',String(mode===m));
  }
  $('online-panel').hidden=mode!=='online'||(room?.ready&&!room.invite&&!room.localVote&&!room.remoteVote&&!room.pending);
  $('room-status').hidden=!!room?.ready&&!room.localVote&&!room.remoteVote&&!room.pending;
  $('room-status').textContent=roomText;
  $('invite-link').value=room?.invite??'';
  $('invite-wrap').hidden=!room?.invite;
  $('copy-invite').disabled=!room?.invite;
  $('spectator-badge').hidden=mode!=='online'||!room?.spectator;
  $('reconnect').hidden=!!room?.ready;
  $('reset').textContent=mode==='online'?'もう一局':'新しい対局';
  $('reset').disabled=mode==='online'&&(!room?.ready||room.localVote);
  $('reset').hidden=mode==='online'&&!!room?.spectator;
  $('undo').disabled=!undo.length||busy||mode==='online';
  $('undo').hidden=mode==='online';
  $('turn-dot').dataset.player=s.result&&s.result!=='draw'?s.result:s.turn;
  $('turn-label').textContent=s.result?(s.result==='draw'?'引き分け':`${names[s.result]}の勝ち`):
    mode==='online'&&!room?.ready?'接続待ち':
    mode==='cpu'&&s.turn===2?'CPUの番':
    mode==='online'?(room.spectator?(room.playing?`観戦中 · ${names[s.turn]}の番`:'観戦中 · 接続待ち'):room.role===s.turn?'あなたの番':'相手の番'):'あなたの番';
  $('players').innerHTML=[1,2].map(p=>{
    const remaining=5-s.board.filter(v=>v===p).length;
    const tag=mode==='online'?(room?.spectator?'':p===room?.role?'あなた':'相手'):(p===1?'あなた':'CPU');
    return `<div class="player ${s.turn===p&&!s.result?'current':''}" data-player="${p}"><span class="player-name">${names[p]}<small>${tag}</small></span><div class="reserve" aria-label="${names[p]}の残りのコマ ${remaining}個">${Array.from({length:5},(_,i)=>`<span class="reserve-dot p${p} ${i<remaining?'':'used'}"></span>`).join('')}</div></div>`;
  }).join('');
  if(focusedCell!==undefined)$('board').querySelector(`[data-cell="${focusedCell}"]`)?.focus({preventScroll:true});
  const winCells=s.result?lines(s.board).flatMap(l=>l.cells):[];
  const b=ghost?.board??display;
  $('board').innerHTML=b.map((p,i)=>{
    const legal=canPlace(s,i)&&!locked;
    const changed=ghost&&b[i]!==s.board[i];
    const own=s.board[i]===s.turn&&!locked;
    return `<button class="cell ${legal?'legal':''} ${own?'draggable':''} ${selected===i?'selected':''} ${changed?'changed':''} ${winCells.includes(i)?'winning':''}" data-cell="${i}" aria-label="${coord(i)} ${s.board[i]?(s.board[i]===1?'黒':'白')+'のコマ'+(own?'。ドラッグで弾く。Enterで選択':''):legal?'タップして置く':'空きマス'}" aria-pressed="${selected===i}" ${locked?'disabled':''}>${p?stone(p,changed?'preview':''):''}</button>`;
  }).join('');
  renderGuide();
}
function renderGuide(){
  const guide=$('drag-guide');
  const hidden=!aim||selected===null;
  guide.toggleAttribute('hidden',hidden);
  if(hidden)return;
  const x=(selected%5+.5)*100,y=(Math.floor(selected/5)+.5)*100;
  const length=drag?Math.min(115,Math.max(55,drag.distance*500/$('board').getBoundingClientRect().width)):85;
  const scale=length/Math.hypot(aim.dr,aim.dc);
  guide.dataset.valid=String(!!ghost);
  $('aim-line').setAttribute('x1',x);$('aim-line').setAttribute('y1',y);
  $('aim-line').setAttribute('x2',x+aim.dc*scale);$('aim-line').setAttribute('y2',y+aim.dr*scale);
}
function clearSelection(){
  const active=drag;drag=null;selected=null;ghost=null;aim=null;
  if(active&&$('board').hasPointerCapture(active.pointerId))$('board').releasePointerCapture(active.pointerId);
}
function reach(){
  if(s.result)return '';
  return actions(s).some(a=>play(s,a).state.result===s.turn)?`${names[s.turn]}がリーチ`:'';
}
function hint(){
  if(s.result)return s.result==='draw'?'もう一局、どうぞ。':'3つ、揃いました。';
  if(mode==='online'&&!room?.ready)return room?.host?'招待リンクで相手を呼ぶ':room?.spectator?'観戦の接続を確認してください':'対戦の接続を確認してください';
  if(mode==='online'&&room?.spectator)return room.playing?'観戦中':'対戦相手の接続を待っています';
  if(blocked())return mode==='cpu'?'考えています…':'相手の手を待っています';
  return reach()||'空きマスをタップ · コマをドラッグ';
}
function settle(){persist();render();$('message').textContent=hint();schedule();}
function schedule(){
  clearTimeout(timer);
  if(mode==='cpu'&&s.turn===2&&!s.result&&!busy)timer=setTimeout(()=>{const a=choose(s);if(a)commit(a);},600);
}
async function animate(state,steps){
  const token=++epoch;busy=true;clearSelection();
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
    for(const step of steps){render(step.board);await new Promise(r=>setTimeout(r,160));if(token!==epoch)return;}
  }
  s=state;busy=false;settle();
}
function commit(a){
  if(busy||(mode==='online'&&blocked()))return;
  if(mode==='online'){clearSelection();room.move(a);return;}
  const out=play(s,a);if(!out)return;
  undo.push(structuredClone(s));animate(out.state,out.steps);
}

// Capture the stable board: preview cells may be replaced while dragging.
$('board').addEventListener('pointerdown',event=>{
  const cell=event.target.closest('[data-cell]');
  if(!cell||drag||busy||blocked()||s.result||event.button!==0||!event.isPrimary)return;
  const i=Number(cell.dataset.cell);if(s.board[i]!==s.turn)return;
  event.preventDefault();clearSelection();selected=i;
  drag={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,i,revision:s.moves,epoch,distance:0,moved:false};
  $('board').setPointerCapture(event.pointerId);render();
});
$('board').addEventListener('pointermove',event=>{
  if(!drag||drag.pointerId!==event.pointerId)return;
  const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;
  drag.distance=Math.hypot(dx,dy);
  if(drag.distance<18){aim=null;ghost=null;render();$('message').textContent='コマをドラッグして弾く';return;}
  drag.moved=true;
  const angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4;
  aim={dr:Math.round(Math.sin(angle)),dc:Math.round(Math.cos(angle))};
  ghost=preview(s,{type:'flick',i:drag.i,...aim});render();
  $('message').textContent=ghost?'離して弾く · 盤の外でキャンセル':'この方向には弾けません';
});
$('board').addEventListener('pointerup',event=>{
  if(!drag||drag.pointerId!==event.pointerId)return;
  const active=drag,rect=$('board').getBoundingClientRect();
  const inside=event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;
  const a=ghost&&aim?{type:'flick',i:active.i,...aim}:null;
  const valid=active.moved&&active.distance>=18&&inside&&active.revision===s.moves&&active.epoch===epoch&&!blocked()&&!busy;
  suppressClick=true;setTimeout(()=>{suppressClick=false;},0);
  clearSelection();
  if(valid&&a)commit(a);
  else{render();$('message').textContent=active.moved?'キャンセルしました':hint();}
});
function cancelDrag(){if(!drag)return;clearSelection();render();$('message').textContent=hint();}
$('board').addEventListener('pointercancel',cancelDrag);
$('board').addEventListener('lostpointercapture',cancelDrag);
$('board').addEventListener('click',event=>{
  if(drag||suppressClick||busy||blocked()||s.result)return;
  const cell=event.target.closest('[data-cell]');if(!cell)return;
  const i=Number(cell.dataset.cell);
  if(s.board[i]===s.turn){clearSelection();selected=i;render();$('message').textContent='矢印キーで方向を選ぶ · Enterで弾く';}
  else if(canPlace(s,i)){clearSelection();commit({type:'place',i});}
});
const keyDirections={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1],q:[-1,-1],w:[-1,0],e:[-1,1],a:[0,-1],d:[0,1],z:[1,-1],x:[1,0],c:[1,1]};
document.addEventListener('keydown',event=>{
  if($('rules').open||$('new-game').open||selected===null)return;
  if(event.key==='Escape'){event.preventDefault();clearSelection();render();$('message').textContent=hint();return;}
  if(busy||blocked()||s.result||drag)return;
  const vector=keyDirections[event.key];
  if(vector){event.preventDefault();aim={dr:vector[0],dc:vector[1]};ghost=preview(s,{type:'flick',i:selected,...aim});render();$('message').textContent=ghost?'Enterで弾く · Escでキャンセル':'この方向には弾けません';}
  else if(event.key==='Enter'&&ghost){event.preventDefault();const a={type:'flick',i:selected,...aim};clearSelection();commit(a);}
});

function newGame(){
  if(mode==='online'&&!requestedMode){room?.rematch();return;}
  epoch++;clearTimeout(timer);busy=false;clearSelection();room?.close();room=null;s=initial();undo=[];
  if(requestedMode)mode=requestedMode;requestedMode=null;
  if(mode==='online')startRoom();
  else{history.replaceState(null,'',location.pathname+location.search);settle();}
}
function showReset(){
  const online=mode==='online'&&!requestedMode;
  $('reset-title').textContent=online?'もう一局？':'新しい対局？';
  $('reset-help').textContent=online?'相手も同意すると始まります。':mode==='online'?'オンライン対戦を終了します。':'いまの対局を終了します。';
  $('reset-confirm').textContent=online?'もう一局を提案':'始める';$('new-game').showModal();
}
for(const m of ['cpu','online'])$(m).onclick=()=>{if(mode===m)return;requestedMode=m;if(s.moves||mode==='online')showReset();else newGame();};
$('reset').onclick=()=>{requestedMode=null;if(s.moves||mode==='online')showReset();else newGame();};
$('reset-confirm').onclick=()=>{$('new-game').close();newGame();};
$('reset-cancel').onclick=()=>{requestedMode=null;$('new-game').close();};
$('new-game').addEventListener('cancel',()=>{requestedMode=null;});
$('undo').onclick=()=>{
  if(busy||!undo.length||mode==='online')return;
  epoch++;clearTimeout(timer);clearSelection();s=undo.pop();if(mode==='cpu'&&s.turn===2&&undo.length)s=undo.pop();settle();
};
$('rules-open').onclick=()=>$('rules').showModal();
$('rules-close').onclick=()=>$('rules').close();
function startRoom(target='',spectator=false){
  roomText='接続を準備しています…';
  room=new Room({onState:(state,steps)=>animate(state,steps),onStatus:text=>{
    roomText=text;
    if(room?.spectator){const url=new URL(location.href),params=new URLSearchParams(url.hash.slice(1));params.set('watch','1');url.hash=params.toString();history.replaceState(null,'',url);}
    if(!busy){if(blocked())clearSelection();render();$('message').textContent=hint();}
    else $('room-status').textContent=text;
  }});
  render();room.start(target,spectator);
}
$('copy-invite').onclick=async()=>{
  $('room-status').hidden=false;
  const field=$('invite-link');
  try{await navigator.clipboard.writeText(field.value);$('room-status').textContent='コピーしました';}
  catch{field.hidden=false;field.focus();field.select();$('room-status').textContent='リンクをコピーしてください';}
};
$('reconnect').onclick=()=>room?.retry();
addEventListener('beforeunload',event=>{if(mode==='online'&&room?.ready&&!room.spectator){event.preventDefault();event.returnValue='';}});
const params=new URLSearchParams(location.hash.slice(1)),target=params.get('room');
if(target&&/^[a-zA-Z0-9_-]{1,100}$/.test(target)){mode='online';s=initial();startRoom(target,params.get('watch')==='1');}else settle();
