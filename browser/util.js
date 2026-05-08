// LICENSE_CODE JPL mini util.js from lif-kernel/util.js
let util_version = '26.4.23';
export const dna = 'DNAINDIVIDUALTRANSPARENTEFFECTIVEIMMEDIATEAUTONOMOUSINCREMENTALRESPONSIBLEACTIONTRUTHFUL';
export const version = util_version;
let D = 0; // Debug

let is_worker = typeof window=='undefined';

// Promise with return() and throw()
export function ewait(){
  let _return, _throw;
  let promise = new Promise((resolve, reject)=>{
    _return = ret=>{ resolve(ret); return ret; };
    _throw = err=>{ reject(err); return err; };
  });
  promise.return = _return;
  promise.throw = _throw;
  promise.catch(err=>{}); // catch un-waited wait() objects. avoid Uncaught in promise
  return promise;
}
export function esleep(ms){
  let p = ewait();
  setTimeout(()=>p.return(), ms);
  return p;
}

export function eslow(ms, arg){
  let enable = 1; // = 1 to enable, or = 0 just to trace active tasks, no print
  eslow.seq ||= 0;
  let seq = eslow.seq++;
  let done, timeout, at_end;
  if (typeof ms!='number'){
    arg = ms;
    ms = 1000;
  }
  if (enable===undefined)
    return {end: ()=>{}};
  if (!Array.isArray(arg))
    arg = [arg];
  let p = (async()=>{
    await esleep(ms);
    timeout = true;
    if (!done)
      enable && console.warn('slow('+seq+') '+ms, ...arg, p.err);
  })();
  eslow.set.add(p);
  p.now = Date.now();
  p.stack = 0 && Error('stack'),
  p.end = ()=>{
    if (at_end)
      return;
    at_end = Date.now();
    eslow.set.delete(p);
    if (timeout && !done)
      enable && console.warn('slow completed '+(Date.now()-p.now)+'>'+ms, ...arg);
    done = true;
  };
  p.print = ()=>console.log('slow('+seq+') '+(done?'completed ':'')+ms
    +' passed '+((at_end||Date.now())-p.now), ...arg);
  return p;
}

eslow.set = new Set();
eslow.print = ()=>{
  console.log('eslow print');
  for (let p of eslow.set)
    p.print();
};
if (D||1)
  globalThis.$eslow = eslow;

// shortcuts
export function OE(o){ return o ? Object.entries(o) : []; }
export const OA = Object.assign;
export const OV = Object.values;
export function json(obj){ return JSON.stringify(obj); }
export function json_cp(obj){
  return JSON.parse(JSON.stringify(obj===undefined ? null : obj));
}
// throw Error -> undefined
export function Tf(fn, throw_val){
  return function(){
    try {
      return fn(...arguments);
    } catch(err){ return throw_val; }
  };
}
export function T(fn, throw_val){
  try {
    return fn();
  } catch(err){ return throw_val; }
}

// undefined -> Throw error
export function TUf(fn){
  return function(){
    let v = fn(...arguments);
    if (v===undefined)
      throw Error('failed '+fn.name);
    return v;
  };
}
export function TU(fn){
  let v = fn();
  if (v===undefined)
    throw Error('failed '+fn.name);
  return v;
}

// assert.js
export function assert(ok, ...msg){
  if (ok)
    return;
  console.error('assert FAIL:', ...msg);
  debugger; // eslint-disable-line no-debugger
  throw Error('assert FAIL');
}
export function assert_eq(exp, res){
  assert(exp===res, 'exp', exp, 'got', res);
}
assert.eq = assert_eq;
export function assert_obj(exp, res){
  if (exp===res)
    return;
  if (typeof exp=='object'){
    assert(typeof res=='object', 'exp', exp, 'res', res);
    for (let i in exp)
      assert_obj(exp[i], res[i]);
    for (let i in res)
      assert_obj(exp[i], res[i]);
    return;
  }
  assert(0, 'exp', exp, 'res', res);
}
assert.obj = assert_obj;
export function assert_obj_f(exp, res){
  if (exp===res)
    return;
  if (typeof exp=='object'){
    assert(typeof res=='object', 'exp', exp, 'res', res);
    for (let i in exp)
      assert_obj_f(exp[i], res[i]);
    return;
  }
  assert(0, 'exp', exp, 'res', res);
}
assert.obj_f = assert_obj_f;
export function assert_run(run){
  try {
    return run();
  } catch(e){
    assert(0, 'run failed: '+e);
  }
}
assert.run = assert_run;
export function assert_run_ab(a, b, test){
  let _a = T(a, {got_throw: 1});
  let _b = T(b, {got_throw: 1});
  assert(!!_a.got_throw==!!_b.got_throw,
    _a.got_throw ? 'a throws, and b does not' : 'b throws, and a does not');
  let ok = assert_run(()=>test(_a, _b));
  assert(ok, 'a and b dont match');
  return {a: _a, b: _b};
}
assert.run_ab = assert_run_ab;
export function assert_te(fn){
  try {
    fn();
  } catch(err){
    return;
  }
  assert(0, 'didnt throw');
}
assert.te = assert_te;

export class ipc_base {
  req = {};
  cmd_cb = {};
  id = 0;
  open = ewait();
  async cmd(cmd, arg){
    let id = ''+(this.id++);
    let req = this.req[id] = {wait: ewait()};
    req.slow = eslow('post cmd '+cmd);
    if (!await this.open)
      throw new Error('ipc not open');
    await this.send({cmd, arg, id});
    return await req.wait;
  }
  async cmd_server_cb(msg){
    let cmd_cb = this.cmd_cb[msg.cmd];
    if (!cmd_cb)
      throw Error('invalid cmd', msg.cmd);
    try {
      let slow = eslow('chan cmd '+msg.cmd);
      let res = await cmd_cb({cmd: msg.cmd, arg: msg.arg});
      slow.end();
      await this.send({cmd_res: msg.cmd, id_res: msg.id, res});
    } catch(err){
      console.error('cmd failed', msg, err);
      await this.send({cmd_res: msg.cmd, id_res: msg.id, err: ''+err});
      throw err;
    }
  }
  on_msg(msg){
    if (typeof msg.cmd=='string' && typeof msg.id=='string')
      return this.cmd_server_cb(msg);
    if (typeof msg.cmd_res=='string' && typeof msg.id_res=='string'){
      let id = msg.id_res, req;
      if (!(req = this.req[id]))
        throw Error('invalid req msg.id', id);
      delete this.req[id];
      req.slow.end();
      if (msg.err)
        return req.wait.throw(msg.err);
      return req.wait.return(msg.res);
    }
    if (typeof msg.misc=='string')
      return console.log(msg);
    throw Error('invalid msg', msg);
  }
  add_server_cmd(cmd, cb){
    this.cmd_cb[cmd] = cb;
  }
  close(){
    for (let [id, msg_wait] of OE(this.pending)){
      delete this.pending[id];
      msg_wait.throw('close');
    }
  }
}

export class ipc_postmessage extends ipc_base {
  ports;
  port;
  send(json){
    this.port.postMessage(json);
  }
  // controller = navigator.serviceWorker.controller
  connect(controller){
    this.ports = new MessageChannel();
    controller.postMessage({connect: true}, [this.ports.port2]);
    this.port = this.ports.port1;
    this.port.addEventListener('message', event=>this.on_msg(event.data));
    this.port.start();
    this.open.return(true);
  }
  listen(event){
    if (!event.data?.connect)
      return;
    this.port = event.ports[0];
    this.port.addEventListener('message', event=>this.on_msg(event.data));
    this.port.start();
    this.open.return(true);
    return true;
  }
  close(){
    super.close();
    this.port.close();
  }
}

export const class_ipc_websocket = base=>class extends base {
  ws;
  async send(json){
    this.ws.send(JSON.stringify(json));
  }
  async connect(url){
    this.url = url;
    this.ws = new WebSocket(this.url);
    this.ws.onopen = ()=>{
      assert(this.ws.readyState==WebSocket.OPEN);
      this.open.return(true);
    };
    this.ws.onmessage = event=>{
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch(e){
        return console.error('invalid ipc json', event.data);
      }
      this.on_msg(msg);
    };
    this.ws.onerror = err=>{
      console.error('WebSocket error', err);
      this.open.throw(err);
      this.error = true;
    };
    this.ws.onclose = ()=>{
      this.open.throw('WebSocket closed');
      this.error = true;
    };
    return await this.open;
  }
  close(){
    super.close();
    this.ws?.close();
  }
};

// JSON-RPC Client over WebSocket
export class jsonrpc_base {
  id = 0;
  pending = {}; // {id: await result}
  open = ewait();
  on_msg(msg){
    if (!msg)
      return console.error('invalid empty rpc msg');
    if (msg.id!=null){
      const msg_wait = this.pending[msg.id];
      if (!msg_wait)
        return console.error('unexpected rpc msg', msg);
      delete this.pending[msg.id];
      if (msg.error)
        return msg_wait.throw(msg);
      return msg_wait.return(msg.result);
    }
    if (msg.method)
      return console.log('rpc server notification:', msg.method, msg.params);
    console.error('unknowing rpc msg', msg);
  }

  async call(method, ...params){
    let msg_wait = ewait();
    if (!await this.open)
      throw new Error('jsonrpc not open');
    const id = ++this.id;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params.length && {params}),
    };
    this.pending[id] = msg_wait;
    await this.send(request);
    let res;
    try {
      res = await msg_wait;
    } catch(msg){
      console.error('rpc('+method+') error', msg);
      throw new Error(msg.error);
    }
    return res;
  }
  close(){
    for (let [id, msg_wait] of OE(this.pending)){
      delete this.pending[id];
      msg_wait.throw('close');
    }
  }
}

export const ipc_websocket = class_ipc_websocket(ipc_base);
export const jsonrpc_websocket = class_ipc_websocket(jsonrpc_base);

