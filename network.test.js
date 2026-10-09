import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Room} from './dist/network.js';
import {VERSION} from './dist/protocol.js';

class Connection extends EventEmitter {
  constructor(metadata={}){super();this.metadata=metadata;this.open=false;this.sent=[];}
  send(message){this.sent.push(structuredClone(message));}
  connect(){this.open=true;this.emit('open');}
  close(){this.open=false;this.emit('close');}
}
const room=()=>new Room({onState:()=>{},onStatus:()=>{}});
test('watchers receive moves and rematches without consuming the player slot or accepting commands',()=>{
  const host=room();host.host=true;host.role=1;
  const watchers=[new Connection(),new Connection()];
  try{
    for(const watcher of watchers){host.attachWatcher(watcher);watcher.connect();assert.equal(watcher.sent.at(-1).playing,false);}
    assert.equal(host.conn,null);assert.equal(host.guestToken,null);
    const guest=new Connection({token:'player'});host.attach(guest);guest.connect();
    guest.sent=[];guest.emit('data',{type:'sync',version:VERSION});assert.equal(guest.sent.at(-1).type,'state');
    assert.equal(host.watchers.size,2);assert.equal(host.guestToken,'player');
    assert.ok(host.move({type:'place',i:0}));
    for(const watcher of watchers){assert.equal(watcher.sent.at(-1).rev,1);assert.equal(watcher.sent.at(-1).playing,true);}
    const match=host.match;
    watchers[0].emit('data',{type:'move',version:VERSION,match,rev:1,action:{type:'place',i:2}});
    watchers[0].emit('data',{type:'rematch',version:VERSION,match});
    assert.equal(host.state.moves,1);assert.equal(host.remoteVote,false);
    guest.emit('data',{type:'move',version:VERSION,match,rev:1,action:{type:'place',i:2}});
    assert.equal(host.state.moves,2);
    host.rematch();guest.emit('data',{type:'rematch',version:VERSION,match});
    assert.notEqual(host.match,match);
    for(const watcher of watchers){assert.equal(watcher.sent.at(-1).rev,0);assert.equal(watcher.sent.at(-1).match,host.match);}
    guest.close();assert.equal(watchers[0].sent.at(-1).playing,false);
    watchers[0].close();assert.equal(host.watchers.size,1);
    const returning=new Connection();host.attachWatcher(returning);returning.connect();
    assert.equal(returning.sent.at(-1).match,host.match);assert.equal(returning.sent.at(-1).rev,0);
  }finally{host.close();}
  assert.equal(host.watchers.size,0);assert.equal(watchers[1].open,false);
});
test('spectator snapshots replay safely and cannot enable moves or rematch votes',()=>{
  const host=room(),viewer=room();host.host=true;host.role=1;host.ready=true;viewer.spectator=true;viewer.role=0;
  try{
    host.move({type:'place',i:0});viewer.receive(host.snapshot());
    assert.equal(viewer.state.moves,1);assert.equal(viewer.ready,true);assert.equal(viewer.playing,true);
    assert.equal(viewer.canMove,false);assert.equal(viewer.move({type:'place',i:2}),false);
    viewer.rematch();assert.equal(viewer.localVote,false);
    viewer.receive({...host.snapshot(),votes:[true,true],playing:false});
    assert.equal(viewer.localVote,false);assert.equal(viewer.remoteVote,false);assert.equal(viewer.playing,false);
    viewer.receive({...host.snapshot(),log:[{type:'place',i:0,player:2}]});
    assert.equal(viewer.state.moves,1);
  }finally{host.close();viewer.close();}
});
test('spectator links and retries keep a read-only connection role',async()=>{
  const originalPeer=globalThis.Peer,originalLocation=globalThis.location;
  class Peer extends EventEmitter {
    connect(target,options){this.target=target;this.options=options;this.connection=new Connection(options.metadata);return this.connection;}
    destroy(){this.destroyed=true;this.connection?.close();}
  }
  globalThis.Peer=Peer;globalThis.location={href:'https://game.test/'};
  const host=room(),viewer=room();
  try{
    await host.start();host.peer.emit('open','host-id');
    assert.equal(new URL(host.watchInvite).hash,'#room=host-id&watch=1');
    const watcher=new Connection({version:VERSION,watch:true});host.peer.emit('connection',watcher);watcher.connect();
    assert.equal(host.watchers.size,1);assert.equal(host.conn,null);
    watcher.emit('data',{type:'sync',version:VERSION});assert.equal(watcher.sent.at(-1).type,'state');
    const player=new Connection({version:VERSION,token:'player'});host.peer.emit('connection',player);player.connect();
    const third=new Connection({version:VERSION,token:'third'});host.peer.emit('connection',third);third.connect();
    third.sent=[];third.emit('data',{type:'sync',version:VERSION});assert.equal(third.sent.at(-1).type,'rejected');
    third.emit('data',{type:'rejected-ack',version:VERSION});assert.equal(third.open,false);
    await viewer.start('host-id',true);viewer.peer.emit('open','viewer-id');
    assert.equal(viewer.role,0);assert.equal(viewer.peer.options.metadata.watch,true);
    viewer.conn.connect();assert.equal(viewer.conn.sent.at(-1).type,'sync');viewer.receive(host.snapshot());viewer.conn.close();
    viewer.retry();await Promise.resolve();viewer.peer.emit('open','viewer-retry');
    assert.equal(viewer.spectator,true);assert.equal(viewer.role,0);assert.equal(viewer.peer.options.metadata.watch,true);
  }finally{host.close();viewer.close();globalThis.Peer=originalPeer;globalThis.location=originalLocation;}
});
