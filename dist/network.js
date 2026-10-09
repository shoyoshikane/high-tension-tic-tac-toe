import {initial,play} from './engine.js';
import {VERSION,acceptMove,restore} from './protocol.js';

let loading;
function loadPeer(){
  if(globalThis.Peer)return Promise.resolve(globalThis.Peer);
  if(loading)return loading;
  loading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='./vendor/peerjs.min.js';
    script.onload=()=>globalThis.Peer?resolve(globalThis.Peer):reject(new Error('PeerJSを読み込めませんでした。'));
    script.onerror=()=>{script.remove();loading=null;reject(new Error('接続ライブラリを読み込めませんでした。再試行してください。'));};
    document.head.append(script);
  });
  return loading;
}
const uid=()=>crypto.randomUUID();
export class Room {
  constructor({onState,onStatus}){
    this.onState=onState;this.onStatus=onStatus;this.state=initial();this.match=uid();this.rev=-1;
    this.peer=null;this.conn=null;this.host=false;this.role=0;this.ready=false;this.pending=false;
    this.localVote=false;this.remoteVote=false;this.guestToken=null;this.closed=false;this.attempt=0;
    this.identity=uid();this.invite='';this.target='';this.timeout=null;this.heartbeat=null;this.lastSeen=0;
  }
  status(text){this.onStatus(text,this);}
  get canMove(){return this.ready&&!this.pending&&this.state.turn===this.role&&!this.state.result;}
  async start(target=''){
    this.target=target;this.host=!target;this.role=this.host?1:2;this.status('接続を準備しています…');
    const attempt=++this.attempt;
    try{
      const Peer=await loadPeer();if(this.closed||attempt!==this.attempt)return;
      // Production uses the free PeerJS Cloud; tests inject a local broker.
      const options={secure:true,...(globalThis.__PEER_OPTIONS__??{})};
      const peer=this.peer=new Peer(undefined,options);
      this.armTimeout('接続できませんでした。「再接続」を試すか、別の回線でお試しください。');
      peer.on('open',id=>{
        if(this.closed||this.peer!==peer)return;
        clearTimeout(this.timeout);
        if(this.host){const url=new URL(location.href);url.hash=`room=${id}`;this.invite=url.href;this.status(this.ready?'友達と接続しました。':this.guestToken?'友達の再接続を待っています。':'招待リンクを友達に送ってください。');}
        else this.connect();
      });
      peer.on('connection',conn=>{
        if(!this.host||this.closed){conn.on('open',()=>conn.close());return;}
        const meta=conn.metadata;
        if(meta?.version!==VERSION || typeof meta.token!=='string' || meta.token.length>100 || (this.guestToken&&this.guestToken!==meta.token)||this.conn){
          conn.on('open',()=>{conn.send({type:'rejected',version:VERSION});setTimeout(()=>conn.close(),200);});return;
        }
        this.attach(conn);
      });
      peer.on('disconnected',()=>{
        if(this.closed||this.peer!==peer)return;
        if(!this.ready)this.status('接続サービスとの通信が切れました。再接続してください。');
        try{peer.reconnect();}catch{}
      });
      peer.on('error',error=>{
        if(this.closed||this.peer!==peer)return;
        clearTimeout(this.timeout);
        if(this.ready)return;
        this.pending=false;
        this.status(error.type==='peer-unavailable'?'部屋が見つかりません。作成者が画面を開いているか確認してください。':'接続できませんでした。再接続するか、別の回線でお試しください。');
      });
    }catch(error){if(!this.closed&&attempt===this.attempt)this.status(error.message);}
  }
  armTimeout(message){clearTimeout(this.timeout);this.timeout=setTimeout(()=>{if(!this.ready&&!this.closed){this.conn?.close();this.conn=null;this.pending=false;this.status(message);}},20000);}
  connect(){
    if(this.closed||!this.peer||this.conn)return;
    this.status('友達の部屋に接続しています…');
    this.armTimeout('つながりませんでした。作成者の画面と回線を確認して再接続してください。');
    this.attach(this.peer.connect(this.target,{reliable:true,serialization:'json',metadata:{version:VERSION,token:this.identity}}));
  }
  attach(conn){
    this.conn=conn;
    conn.on('open',()=>{
      if(this.closed||this.conn!==conn)return;
      this.lastSeen=Date.now();clearInterval(this.heartbeat);
      this.heartbeat=setInterval(()=>{
        if(this.closed||this.conn!==conn)return;
        if(Date.now()-this.lastSeen>6000){lost();conn.close();return;}
        this.send({type:'ping'});
      },1000);
      if(this.host){this.guestToken=conn.metadata.token;this.ready=true;clearTimeout(this.timeout);this.sendSnapshot();this.status('友達と接続しました。あなたは翡翠です。');}
    });
    conn.on('data',message=>{if(!this.closed&&this.conn===conn)this.receive(message);});
    const lost=()=>{if(this.closed||this.conn!==conn)return;this.conn=null;this.ready=false;this.pending=false;this.localVote=false;this.remoteVote=false;clearTimeout(this.timeout);clearInterval(this.heartbeat);this.status('友達との接続が切れました。画面を開いたまま再接続してください。');};
    conn.on('close',lost);conn.on('error',lost);
  }
  send(message){if(!this.conn?.open)return false;try{this.conn.send({...message,version:VERSION});return true;}catch{this.ready=false;this.pending=false;this.status('送信できませんでした。再接続してください。');return false;}}
  sendSnapshot(){return this.send({type:'state',match:this.match,rev:this.state.moves,log:this.state.log,votes:[this.localVote,this.remoteVote]});}
  receive(message){
    if(!message||message.version!==VERSION)return;
    this.lastSeen=Date.now();
    if(message.type==='ping'){this.send({type:'pong'});return;}
    if(message.type==='pong')return;
    if(message.type==='rejected'){this.ready=false;clearTimeout(this.timeout);clearInterval(this.heartbeat);const conn=this.conn;this.conn=null;this.status('この部屋は満員、または別の対局が進行中です。新しい招待リンクをもらってください。');conn?.close();return;}
    if(this.host){
      if(message.type==='move'&&this.ready){
        const out=acceptMove(this.state,message,2,this.match);
        if(out){this.state=out.state;this.localVote=false;this.remoteVote=false;this.sendSnapshot();this.onState(this.state,out.steps);}
        else this.sendSnapshot();
      }else if(message.type==='rematch'&&this.ready&&message.match===this.match){this.remoteVote=true;this.maybeRematch();}
    }else if(message.type==='state'&&typeof message.match==='string'&&message.match.length<100&&Number.isInteger(message.rev)){
      if(message.match===this.match&&message.rev<this.rev)return;
      const state=restore(message.log);if(!state||state.moves!==message.rev)return;
      let steps=[];
      if(this.match===message.match&&state.moves===this.state.moves+1)steps=play(this.state,state.log.at(-1))?.steps??[];
      this.match=message.match;this.rev=message.rev;this.state=state;this.ready=true;this.pending=false;clearTimeout(this.timeout);
      this.localVote=message.votes?.[1]===true;this.remoteVote=message.votes?.[0]===true;
      this.onState(state,steps);this.voteStatus();
    }
  }
  move(action){
    if(!this.canMove)return false;
    const message={type:'move',action,match:this.match,rev:this.state.moves,version:VERSION};
    if(this.host){const out=acceptMove(this.state,message,1,this.match);if(!out)return false;
      this.state=out.state;this.localVote=false;this.remoteVote=false;this.sendSnapshot();this.onState(this.state,out.steps);
    }else{if(!play(this.state,action))return false;this.pending=true;if(!this.send(message))return false;this.status('手を送信しています…');}
    return true;
  }
  rematch(){if(!this.ready)return;this.localVote=true;if(this.host)this.maybeRematch();else{this.send({type:'rematch',match:this.match});this.voteStatus();}}
  maybeRematch(){
    if(this.localVote&&this.remoteVote){this.match=uid();this.state=initial();this.localVote=false;this.remoteVote=false;this.sendSnapshot();this.onState(this.state,[]);}
    else this.sendSnapshot();
    this.voteStatus();
  }
  voteStatus(){this.status(this.localVote?'もう一局を希望しました。友達の返事を待っています。':this.remoteVote?'友達がもう一局を希望しています。「もう一局」で始めます。':`友達と接続しました。あなたは${this.role===1?'翡翠':'琥珀'}です。`);}
  retry(){
    if(this.closed||this.ready)return;
    if(this.host&&this.peer&&!this.peer.destroyed){if(this.peer.disconnected)this.peer.reconnect();else this.status(this.invite?'招待リンクを友達に送ってください。':'接続を準備しています…');return;}
    const old=this.peer;this.peer=null;this.conn=null;old?.destroy();this.start(this.target);
  }
  close(){this.closed=true;this.attempt++;clearTimeout(this.timeout);clearInterval(this.heartbeat);this.ready=false;this.conn?.close();this.peer?.destroy();}
}
