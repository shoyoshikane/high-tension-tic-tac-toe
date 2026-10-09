export const directions = [[-1,-1,'↖'],[-1,0,'↑'],[-1,1,'↗'],[0,-1,'←'],[0,1,'→'],[1,-1,'↙'],[1,0,'↓'],[1,1,'↘']];
export const key = b => b.join('');
export const initial = () => ({board:Array(25).fill(0),turn:1,previous:null,moves:0,result:null,log:[]});
const inside = (r,c) => r>=0 && r<5 && c>=0 && c<5;
export function canPlace(s,i) {
  if(s.result || i<0 || i>=25 || s.board[i] || s.board.filter(p=>p===s.turn).length>=5) return false;
  const r=Math.floor(i/5),c=i%5;
  return directions.every(([dr,dc])=>!inside(r+dr,c+dc)||s.board[(r+dr)*5+c+dc]!==s.turn);
}
export function flick(board,i,dr,dc) {
  const b=[...board],steps=[];
  if(!b[i] || !directions.some(d=>d[0]===dr&&d[1]===dc)) return {board:b,steps};
  let active=i;
  while(true) {
    let r=Math.floor(active/5),c=active%5,dest=active;
    while(inside(r+dr,c+dc)&&!b[(r+dr)*5+c+dc]) {r+=dr;c+=dc;dest=r*5+c;}
    if(dest!==active) {const color=b[active];b[dest]=color;b[active]=0;steps.push({from:active,to:dest,color,board:[...b]});}
    if(!inside(r+dr,c+dc)) break;
    active=(r+dr)*5+c+dc;
  }
  return {board:b,steps};
}
export function lines(board) {
  const wins=[];
  for(let i=0;i<25;i++) if(board[i]) for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    const r=Math.floor(i/5),c=i%5;
    if(inside(r+2*dr,c+2*dc)) {const cells=[i,(r+dr)*5+c+dc,(r+2*dr)*5+c+2*dc];if(cells.every(j=>board[j]===board[i])) wins.push({player:board[i],cells});}
  }
  return wins;
}
export function preview(s,a) {
  if(s.result) return null;
  let out;
  if(a.type==='place') {if(!canPlace(s,a.i))return null;const b=[...s.board];b[a.i]=s.turn;out={board:b,steps:[]};}
  else if(a.type==='flick' && s.board[a.i]===s.turn) out=flick(s.board,a.i,a.dr,a.dc);
  else return null;
  if(key(out.board)===key(s.board)||key(out.board)===s.previous) return null;
  return out;
}
export function actions(s) {
  if(s.result)return [];
  const list=[];
  for(let i=0;i<25;i++) {
    if(canPlace(s,i))list.push({type:'place',i});
    if(s.board[i]===s.turn)for(const [dr,dc] of directions){const a={type:'flick',i,dr,dc};if(preview(s,a))list.push(a);}
  }
  return list;
}
export function play(s,a) {
  const out=preview(s,a);if(!out) return null;
  const wins=lines(out.board),players=[...new Set(wins.map(w=>w.player))];
  const n={...s,board:out.board,previous:key(s.board),turn:3-s.turn,moves:s.moves+1,result:players.length>1?'draw':players[0]??null,log:[...s.log,{...a,player:s.turn}]};
  if(!n.result && !actions(n).length)n.result='draw';
  return {state:n,steps:out.steps};
}
export function choose(s) {
  let best=-Infinity,selected=null;
  for(const a of actions(s)) {
    const n=play(s,a).state;
    let score=n.result===s.turn?10000:n.result===3-s.turn?-10000:0;
    if(!n.result) {
      const replies=actions(n);let threats=0;
      for(const reply of replies)if(play(n,reply).state.result===n.turn)threats++;
      score-=threats*500;
      score+=n.board.filter(p=>p===s.turn).length*8;
      n.board.forEach((p,i)=>{if(p===s.turn)score+=4-Math.abs(Math.floor(i/5)-2)-Math.abs(i%5-2);});
    }
    score+=Math.random();if(score>best){best=score;selected=a;}
  }
  return selected;
}
