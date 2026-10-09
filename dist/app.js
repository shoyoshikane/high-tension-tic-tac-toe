import {initial,canPlace,directions,preview,play,actions,choose,lines} from './engine.js';
import {Room} from './network.js';
const $=id=>document.getElementById(id),names={1:'翡翠',2:'琥珀'},coord=i=>'ABCDE'[i%5]+(Math.floor(i/5)+1);
let s=initial(),mode='local',action='place',selected=null,dir=null,ghost=null,busy=false,timer=null,epoch=0,undo=[],room=null,roomText='';
try{const saved=JSON.parse(localStorage.getItem('high-tension-v1'));if(saved&&Array.isArray(saved.state?.board)&&saved.state.board.length===25&&saved.state.board.every(v=>[0,1,2].includes(v))&&[1,2].includes(saved.state.turn)){s=saved.state;mode=saved.mode==='cpu'?'cpu':'local';}}catch{}
function persist(){if(mode==='online')return;try{localStorage.setItem('high-tension-v1',JSON.stringify({state:s,mode}));}catch{}}
function blocked(){return mode==='online'? !room?.canMove : mode==='cpu'&&s.turn===2&&!s.result;}
function stone(p,extra=''){return `<span class="stone p${p} ${extra}" aria-hidden="true"></span>`;}
function render(display=s.board) {
  const cpuTurn=blocked();
  $('local').classList.toggle('active',mode==='local');$('cpu').classList.toggle('active',mode==='cpu');
  $('online').classList.toggle('active',mode==='online');
  $('online-panel').hidden=mode!=='online';
  $('room-status').textContent=roomText;
  $('invite-link').value=room?.invite??'';
  $('invite-wrap').hidden=!room?.invite;
  $('copy-invite').disabled=!room?.invite;
  $('reconnect').hidden=!!room?.ready;
  $('reset').textContent=mode==='online'?'もう一局':'新しいゲーム';
  $('reset').disabled=mode==='online'&&(!room?.ready||room.localVote);
  $('place').classList.toggle('active',action==='place');$('flick').classList.toggle('active',action==='flick');
  $('place').disabled=busy||cpuTurn||!!s.result||s.board.filter(p=>p===s.turn).length===5;
  $('flick').disabled=busy||cpuTurn||!!s.result||!s.board.includes(s.turn);
  $('undo').disabled=!undo.length||busy||mode==='online';
  $('turn-label').textContent=s.result?(s.result==='draw'?'引き分け':`${names[s.result]}の勝ち！`):mode==='online'&&!room?.ready?'友達との接続を待っています':`${names[s.turn]}の番${mode==='cpu'&&cpuTurn?' · CPUが考えています…':mode==='online'?(room.role===s.turn?' · あなた':' · 友達'):''}`;
  $('move-count').textContent=`TURN ${String(s.moves+1).padStart(2,'0')}`;
  $('players').innerHTML=[1,2].map(p=>{const count=5-s.board.filter(v=>v===p).length;return `<div class="player ${s.turn===p&&!s.result?'current':''}"><div class="player-header">${stone(p)}<span class="player-name">${names[p]}</span><span class="player-tag">${mode==='online'?(p===room?.role?'YOU':'FRIEND'):mode==='cpu'?(p===1?'YOU':'CPU'):(p===1?'PLAYER 1':'PLAYER 2')}</span></div><div class="reserve">${Array.from({length:5},(_,i)=>stone(p,i<count?'':'used')).join('')}</div><span class="reserve-count">手元のコマ ${count} / 5</span></div>`;}).join('');
  const winCells=s.result?lines(s.board).flatMap(l=>l.cells):[];
  const b=ghost?.board??display;
  $('board').innerHTML=b.map((p,i)=>{const legal=action==='place'&&canPlace(s,i)&&!busy&&!cpuTurn;const changed=ghost&&b[i]!==s.board[i];return `<button class="cell ${legal?'legal':''} ${selected===i?'selected':''} ${changed?'changed':''} ${winCells.includes(i)?'winning':''}" data-cell="${i}" aria-label="${coord(i)} ${p?names[p]+'のコマ':legal?'置けます':'空きマス'}" ${busy||cpuTurn||s.result?'disabled':''}>${p?stone(p,changed?'preview':''):''}</button>`;}).join('');
  $('action-title').textContent=s.result?'もう一局、いかが？':action==='place'?'コマを置く':'コマをはじく';
  $('action-help').textContent=s.result?'新しいゲームで、また違う景色を。':action==='place'?'光るマスを選んでください。自分のコマの周囲8マスには置けません。':'自分のコマを選び、方向を選んでください。動いた後の配置を確認できます。';
  $('direction-panel').hidden=action!=='flick'||selected===null||!!s.result;
  if(selected!==null){$('directions').innerHTML=Array.from({length:9},(_,k)=>{if(k===4)return '<span class="center">●</span>';const d=directions[k<4?k:k-1],valid=preview(s,{type:'flick',i:selected,dr:d[0],dc:d[1]});return `<button data-direction="${k<4?k:k-1}" aria-label="${d[2]}の方向にはじく" class="${dir===k-(k>4?1:0)?'active':''}" ${!valid||busy?'disabled':''}>${d[2]}</button>`;}).join('');}
  $('confirm').disabled=!ghost||busy;
  $('preview-label').textContent=ghost?`${ghost.steps.length}個のコマが動きます。破線のマスが移動後の配置です。`:'方向を選ぶと、移動後の配置を表示します。';
  $('history').innerHTML=s.log.length?s.log.slice(-5).reverse().map((a,k)=>`<li><span class="number">${String(s.log.length-k).padStart(2,'0')}</span><span class="p${a.player}">●</span><span>${coord(a.i)} ${a.type==='place'?'に置く':directions.find(d=>d[0]===a.dr&&d[1]===a.dc)[2]+' にはじく'}</span></li>`).join(''):'<li>最初のひと手を、どうぞ。</li>';
}
function clearSelection(){selected=null;dir=null;ghost=null;}
function reach(){if(s.result)return '';const threats=actions(s).some(a=>play(s,a).state.result===s.turn);return threats?`${names[s.turn]}がリーチ！ この手番で3つ揃えられます。`:'';}
function settle(){persist();render();$('message').textContent=s.result?(s.result==='draw'?'引き分けです。新しいゲームで再挑戦できます。':'3つのきらめきが、つながりました。'):reach()||'置くか、はじくか。ひと手ずつ、交互に。';schedule();}
function schedule(){clearTimeout(timer);if(mode==='cpu'&&s.turn===2&&!s.result&&!busy)timer=setTimeout(()=>{const a=choose(s);if(a)commit(a);},600);}
async function commit(a){if(busy||(mode==='online'&&blocked()))return;if(mode==='online'){room.move(a);render();return;}const out=play(s,a);if(!out)return;const token=epoch;undo.push(structuredClone(s));busy=true;clearSelection();$('message').textContent=a.type==='flick'?'きらめきが連鎖しています…':'コマを置きました。';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!reduced)for(const step of out.steps){render(step.board);await new Promise(r=>setTimeout(r,220));if(epoch!==token)return;}
  s=out.state;busy=false;action=s.board.filter(p=>p===s.turn).length>=5?'flick':'place';settle();
}
$('board').addEventListener('click',e=>{const cell=e.target.closest('[data-cell]');if(!cell||busy||blocked())return;const i=+cell.dataset.cell;if(action==='place'){if(canPlace(s,i))commit({type:'place',i});else $('message').textContent='ここには置けません。光る空きマスを選んでください。';}else if(s.board[i]===s.turn){selected=i;dir=null;ghost=null;render();}else $('message').textContent='はじく自分のコマを選んでください。';});
$('directions').addEventListener('click',e=>{const b=e.target.closest('[data-direction]');if(!b||busy)return;dir=+b.dataset.direction;const d=directions[dir];ghost=preview(s,{type:'flick',i:selected,dr:d[0],dc:d[1]});render();});
$('confirm').onclick=()=>{if(ghost&&dir!==null){const d=directions[dir];commit({type:'flick',i:selected,dr:d[0],dc:d[1]});}};
$('cancel').onclick=()=>{clearSelection();render();};
for(const type of ['place','flick'])$(type).onclick=()=>{action=type;clearSelection();render();};
let requestedMode=null;
function newGame(){
  if(mode==='online'&&!requestedMode){room?.rematch();return;}
  epoch++;clearTimeout(timer);busy=false;room?.close();room=null;s=initial();undo=[];if(requestedMode)mode=requestedMode;requestedMode=null;action='place';clearSelection();
  if(mode==='online')startRoom();else{history.replaceState(null,'',location.pathname+location.search);settle();}
}
for(const m of ['local','cpu','online'])$(m).onclick=()=>{if(mode===m)return;requestedMode=m;if(s.moves||mode==='online')showReset();else newGame();};
function showReset(){const online=mode==='online'&&!requestedMode;$('reset-title').textContent=online?'もう一局を提案しますか？':'新しいゲームを始めますか？';$('reset-help').textContent=online?'ふたりが「もう一局」を選ぶと、新しい対局が始まります。':mode==='online'?'オンライン対戦を終了して、モードを切り替えます。':'いまの対局を終了して、盤を空にします。';$('reset-confirm').textContent=online?'もう一局を提案':'新しく始める';$('new-game').showModal();}
$('reset').onclick=()=>{requestedMode=null;if(s.moves||mode==='online')showReset();else newGame();};
$('reset-confirm').onclick=()=>{$('new-game').close();newGame();};$('reset-cancel').onclick=()=>{requestedMode=null;$('new-game').close();};
$('undo').onclick=()=>{if(busy||!undo.length||mode==='online')return;epoch++;clearTimeout(timer);s=undo.pop();if(mode==='cpu'&&s.turn===2&&undo.length)s=undo.pop();action='place';clearSelection();settle();};
$('rules-open').onclick=()=>$('rules').showModal();$('rules-close').onclick=()=>$('rules').close();
async function received(state,steps){
  const token=++epoch;busy=true;clearSelection();s=state;action=s.board.filter(p=>p===s.turn).length>=5?'flick':'place';
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const step of steps){render(step.board);await new Promise(r=>setTimeout(r,220));if(token!==epoch)return;}
  busy=false;settle();
}
function startRoom(target=''){
  roomText='接続を準備しています…';
  room=new Room({onState:received,onStatus:text=>{roomText=text;render();}});
  render();room.start(target);
}
$('copy-invite').onclick=async()=>{try{await navigator.clipboard.writeText(room.invite);$('room-status').textContent='招待リンクをコピーしました。友達に送ってください。';}catch{$('invite-link').focus();$('invite-link').select();$('room-status').textContent='リンクを選択しました。コピーして友達に送ってください。';}};
$('reconnect').onclick=()=>room?.retry();
addEventListener('beforeunload',event=>{if(mode==='online'&&room?.ready){event.preventDefault();event.returnValue='';}});
const target=new URLSearchParams(location.hash.slice(1)).get('room');
if(target&&/^[a-zA-Z0-9_-]{1,100}$/.test(target)){mode='online';s=initial();startRoom(target);}else settle();
