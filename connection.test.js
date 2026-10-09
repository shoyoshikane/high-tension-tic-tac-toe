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
test('guest requests state on open and host resends an initial snapshot lost before guest readiness',()=>{
  const host=new Room({onState:()=>{},onStatus:()=>{}}),guest=new Room({onState:()=>{},onStatus:()=>{}});
  const hostConn=new Connection({token:'guest'}),guestConn=new Connection();
  host.host=true;host.role=1;guest.role=2;
  try{
    host.attach(hostConn);guest.attach(guestConn);hostConn.connect();
    // Discard the first snapshot to reproduce the connection-open race.
    hostConn.sent=[];guestConn.connect();
    assert.equal(guestConn.sent.at(-1).type,'sync');
    hostConn.emit('data',guestConn.sent.at(-1));
    assert.equal(hostConn.sent.at(-1).type,'state');
    guestConn.emit('data',hostConn.sent.at(-1));
    assert.equal(guest.ready,true);assert.equal(guest.state.moves,0);
  }finally{host.close();guest.close();}
});
test('a rejected connection can request its dropped notice and acknowledges before closing',async()=>{
  const originalPeer=globalThis.Peer;
  class Peer extends EventEmitter {destroy(){}}
  globalThis.Peer=Peer;
  let status='';
  const host=new Room({onState:()=>{},onStatus:()=>{}}),third=new Room({onState:()=>{},onStatus:text=>status=text});
  const hostConn=new Connection({version:VERSION}),clientConn=new Connection();
  try{
    await host.start();host.guestToken='existing-player';host.peer.emit('connection',hostConn);hostConn.connect();
    hostConn.sent=[];third.attach(clientConn);clientConn.connect();
    hostConn.emit('data',clientConn.sent.at(-1));
    assert.equal(hostConn.sent.at(-1).type,'rejected');
    clientConn.emit('data',hostConn.sent.at(-1));
    assert.equal(clientConn.sent.at(-1).type,'rejected-ack');assert.match(status,/満員/);assert.equal(clientConn.open,false);
    hostConn.emit('data',clientConn.sent.at(-1));assert.equal(hostConn.open,false);
  }finally{hostConn.close();host.close();third.close();globalThis.Peer=originalPeer;}
});
