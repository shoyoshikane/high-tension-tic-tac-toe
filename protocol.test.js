import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial,play} from './dist/engine.js';
import {VERSION,acceptMove,restore,validAction,sameState} from './dist/protocol.js';
const move=(action,rev=0,match='match')=>({type:'move',version:VERSION,action,rev,match});
test('host accepts a legal move only at the correct turn and revision',()=>{
  const s=initial(),m=move({type:'place',i:0});
  assert.ok(acceptMove(s,m,1,'match'));
  assert.equal(acceptMove(s,m,2,'match'),null);
  assert.equal(acceptMove(s,{...m,rev:1},1,'match'),null);
  assert.equal(acceptMove(s,{...m,match:'old-match'},1,'match'),null);
  assert.equal(acceptMove(s,{...m,version:999},1,'match'),null);
  const n=acceptMove(s,m,1,'match').state;
  assert.equal(acceptMove(n,m,1,'match'),null);
});
test('malformed and illegal actions cannot corrupt shared state',()=>{
  for(const a of [null,{}, {type:'place',i:-1},{type:'place',i:25},{type:'place',i:1.2},{type:'place',i:'0'}, {type:'flick',i:0,dr:20,dc:0},{type:'flick',i:0,dr:0,dc:0}, {type:'flick',i:0,dr:1.2,dc:0}])assert.ok(!validAction(a));
  const s=play(initial(),{type:'place',i:12}).state;s.turn=1;
  assert.equal(acceptMove(s,move({type:'place',i:11},1),1,'match'),null);
});
test('join/reconnect snapshots are rebuilt from validated legal moves',()=>{
  let s=initial();for(const a of [{type:'place',i:0},{type:'place',i:24},{type:'place',i:12}])s=play(s,a).state;
  assert.ok(sameState(s,restore(s.log)));
  assert.equal(restore([{type:'place',i:0,player:2}]),null);
  assert.equal(restore([{type:'place',i:0,player:1},{type:'place',i:0,player:2}]),null);
  assert.equal(restore('invalid'),null);
});
