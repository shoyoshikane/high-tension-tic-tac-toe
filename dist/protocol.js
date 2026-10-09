import {initial,play,key} from './engine.js';
export const VERSION=1;
export function validAction(a){
  return a && Number.isInteger(a.i) && a.i>=0 && a.i<25 &&
    (a.type==='place' || (a.type==='flick' && Number.isInteger(a.dr) && Number.isInteger(a.dc) &&
    Math.abs(a.dr)<=1 && Math.abs(a.dc)<=1 && (a.dr!==0 || a.dc!==0)));
}
export function acceptMove(state,message,actor,match){
  if(!message || message.type!=='move' || message.version!==VERSION || message.match!==match ||
    message.rev!==state.moves || state.turn!==actor || !validAction(message.action))return null;
  return play(state,message.action);
}
export function restore(log){
  if(!Array.isArray(log)||log.length>2000)return null;
  let state=initial();
  for(const a of log){if(!validAction(a)||a.player!==state.turn)return null;const out=play(state,a);if(!out)return null;state=out.state;}
  return state;
}
export function sameState(a,b){return a.moves===b.moves&&a.turn===b.turn&&a.result===b.result&&key(a.board)===key(b.board);}
