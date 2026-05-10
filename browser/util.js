// LICENSE_CODE JPL util.js
let util_version = '26.5.7';
export const dna = 'DNAINDIVIDUALTRANSPARENTEFFECTIVEIMMEDIATEAUTONOMOUSINCREMENTALRESPONSIBLEACTIONTRUTHFUL';
export const version = util_version;
let D = 0; // Debug

let is_worker = typeof window=='undefined';
let is_node = globalThis.process?.versions?.node!==undefined;

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

let once_obj = {};
let once_set = new Set();
export function Donce(once, fn){
  if (typeof once=='object'){
    if (!once_set.has(once)){
      once_set.add(once);
      return void fn();
    }
  } else if (typeof once=='string'){
    if (!once_obj[once]){
      once_obj[once] = true;
      return void fn();
    }
  } else if (once===true || once===1)
    return void fn();
  else if (once==false || once===0);
  else
    console.error('invalid once', once);
}

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
export const _try = TU;

export function CE(err){
  if (err instanceof TypeError || err instanceof RangeError){
    console.error(err);
    debugger; // eslint-disable-line no-debugger
  }
  return err;
}

export function CEA(err){
  console.error(err);
  if (err instanceof TypeError || err instanceof RangeError)
    debugger; // eslint-disable-line no-debugger
  return err;
}

// str.js
export const str = {};
str.split_ws = s=>s.split(/\s+/).filter(s=>s);
str.es6_str = args=>{
  var parts = args[0], s = '';
  if (!Array.isArray(parts))
    return parts;
  s += parts[0];
  for (var i = 1; i<parts.length; i++){
    s += args[i];
    s += parts[i];
  }
  return s;
};
str.qw = function(s){
  return str.split_ws(!Array.isArray(s) ? s : str.es6_str(arguments));
};
export function arr_find(a, find){
  if (!Array.isArray(a))
    return find(a);
  let v;
  for (let i=0; i<a.length; i++){
    if (v = find(a[i]))
      return v;
  }
}
export function arr_find_deep(a, find){
  if (!Array.isArray(a))
    return find(a);
  let v;
  for (let i=0; i<a.length; i++){
    if (v = arr_find_deep(a[i], find))
      return v;
  }
}
str.starts = (s, ..._start)=>arr_find_deep(_start, start=>{
  let v;
  if (typeof start=='string'){
    if (s.startsWith(start))
      return {start, rest: s.slice(start.length)};
    return;
  }
  if (start instanceof RegExp){
    if ((v=s.match(start)) && v.index==0)
      return {start: v[0], rest: s.slice(v[0].length)};
    return;
  }
  throw Error('invalid str.starts type');
});
str.ends = (s, ..._end)=>arr_find_deep(_end, end=>{
  if (s.endsWith(end))
    return {end, rest: s.slice(0, s.length-end.length)};
});
str.is = (s, ..._is)=>arr_find_deep(_is, is=>s==is)||false;
str.splice = (s, at, len, add)=>s.slice(0, at)+add+s.slice(at+len);
str.diff_pos = (s1, s2)=>{
  if (s1==s2)
    return;
  let i;
  for (i=0; i<s1.length && s1[i]==s2[i]; i++);
  return i;
};

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

// micro Buffer implementation, for sha256.js/sha256lif.js
export const micro_Buffer = class Buffer extends Uint8Array {
  copy(dst, dst_off, src_off, src_end){
    dst.set(this.subarray(src_off, src_end), dst_off);
  }
  static alloc(sz){ return new Buffer(sz); }
  static isBuffer(b){ return b instanceof Buffer || b instanceof Uint8Array; }
};

export class rpc_base {
  method_fn = {};
  id = 0;
  req = {};
  open = ewait();
  jsonrpc;
  D;
  constructor(opt={}){
    if (opt.D)
      this.D = 1;
    if (this.D)
      console.log('rpc>>connect');
  }
  async T_call(method, params){
    let res = await this._call(method, params);
    if (res.error!==undefined)
      throw res.error;
    return res.result;
  }
  async call(method, params){
    let res = await this._call(method, params);
    if (res.error!==undefined)
      return;
    return res.result;
  }
  async _call(method, params){
    let id = this.id++;
    let req = this.req[id] = {wait: ewait()};
    const request = req.request = {id, method};
    if (params)
      request.params = params;
    if (this.jsonrpc)
      request.jsonrpc = this.jsonrpc;
    let res;
    let slow = eslow(5000, 'rpc '+method);
    try {
      if (!await this.open)
        throw new Error('rpc not open');
      await this.send(request);
      res = await req.wait;
      if (res.error===undefined && res.result===undefined)
        res = {error: 'invalid msg: no result or error'};
    } catch(err){
      console.error('rpc failed call', err, request);
      res = {error: ''+err};
    }
    slow.end();
    return res;
  }
  async on_res(msg){
    let id = msg.id, req;
    if (typeof id!='string' && typeof id!='number')
      return console.error('rpc: invalid msg id', msg);
    if (!(req = this.req[id]))
      return console.error('rpc: unexpected msg', msg);
    delete this.req[id];
    if (this.D || msg.error!==undefined){
      console.log('rpc> '+(msg.error ? 'err ' : '')+req.request.method,
        req.request.params ?? '', msg);
    }
    req.wait.return(msg);
  }
  async on_call(msg){
    let method_fn = this.method_fn[msg.method];
    let res;
    if (this.jsonrpc)
      res.jsonrpc = this.jsonrpc;
    let slow = eslow('rpc on handler '+msg.method);
    try {
      if (!method_fn)
        throw 'rpc unsupported method '+msg.method;
      res = await method_fn(msg.params);
    } catch(err){
      console.error(err);
      res = {error: ''+err};
    }
    slow.end();
    res = {id: msg.id, ...res};
    if (this.D || res.error!==undefined)
      console.log('rpc< '+(res.error ? 'err ' : '')+msg.method, msg.params, res);
    await this.send(res);
  }
  async on_notify(msg){
    let method_fn = this.method_fn[msg.method];
    if (!method_fn)
      return console.error('rpc: invalid cmd', msg.method);
    let slow = eslow('rpc notify '+msg.method);
    try {
      await method_fn(msg.params);
    } catch(err){
      console.error('rpc failed notify', msg, err);
    } finally {
      slow.end();
    }
  }
  on_msg(msg){
    if (this.jsonrpc && !msg.jsonrpc)
      return console.error('rpc: not jsonrpc msg', msg);
    if (!msg)
      return console.error('rpc: invalid empty msg');
    if (msg.method==null)
      return this.on_res(msg);
    if (msg.id==null)
      return this.on_notify(msg);
    return this.on_call(msg);
  }
  on_error(err){
    console.error('rpc socket error', err);
    this.open.throw(err);
    this.error = true;
  }
  on_close(){
    console.error('rpc socket closed');
    this.open.throw('close');
    this.error = true;
  }
  method(method, fn){
    this.method_fn[method] = async(params)=>{
      let res = await fn(params);
      return {result: res};
    };
  }
  _method(method, fn){
    this.method_fn[method] = async(params)=>{
      let res = await fn(params);
      if (res.error!==undefined)
        return res;
      return {result: res};
    };
  }
  __method(method, fn){
    this.method_fn[method] = fn;
  }
  close(){
    for (let [id, req] of OE(this.req)){
      delete this.req[id];
      req.wait.throw('close');
    }
    if (this.D)
      console.log('rpc>!close');
  }
}

export class ipc_postmessage extends rpc_base {
  ports;
  port;
  send(json){
    this.port.postMessage(json);
  }
  // controller = navigator.serviceWorker.controller
  set_events(){
    this.port.addEventListener('message', event=>this.on_msg(event.data));
    this.port.addEventListener('error', event=>this.on_error(event.data));
    this.port.addEventListener('close', event=>this.on_close());
    this.port.start();
    this.open.return(true);
  }
  connect(controller){
    this.ports = new MessageChannel();
    controller.postMessage({connect: true}, [this.ports.port2]);
    this.port = this.ports.port1;
    this.set_events();
  }
  accept(event){
    if (!event.data?.connect)
      return;
    this.port = event.ports[0];
    this.set_events();
    return true;
  }
  close(){
    super.close();
    this.port.close();
  }
}

// json-rpc over websocket
export class rpc_websocket extends rpc_base {
  ws;
  constructor(opt={}){
    super(opt);
    if (opt.jsonrpc)
      this.jsonrpc = opt.jsonrpc;
  }
  async send(json){
    this.ws.send(JSON.stringify(json));
  }
  set_events(){
    this.ws.on('open', ()=>{
      if (!is_node)
        assert(this.ws.readyState==WebSocket.OPEN);
      this.open.return(true);
    });
    this.ws.on('message', event=>{
      let data = is_node ? event.toString('utf8') : event.data;
      let msg;
      try {
        msg = JSON.parse(data);
      } catch(e){
        return console.error('invalid ipc json', data);
      }
      this.on_msg(msg);
    });
    this.ws.on('error', err=>this.on_error(err));
    this.ws.on('close', ()=>this.on_close());
  }
  async connect(opt){
    if (opt.url){
      this.url = opt.url;
      this.ws = new WebSocket(this.url);
      this.ws.on ||= this.ws.addEventListener;
    } else
      throw new Error('missing connect opt');
    this.set_events();
    return await this.open;
  }
  accept(opt){
    assert(is_node);
    this.ws = opt.ws;
    this.open.return(true);
    this.set_events();
  }
  close(){
    super.close();
    this.ws?.close();
  }
};

const utf8_enc = new TextEncoder('utf-8');
export function str_to_buf(buf){
  if (buf instanceof ArrayBuffer)
    return buf;
  if (ArrayBuffer.isView(buf))
    return buf.buffer;
  if (typeof buf=='string')
    return utf8_enc.encode(buf).buffer;
  throw Error('str_to_buf: invalid buf type');
}
const utf8_dec = new TextDecoder('utf-8');
export function buf_to_str(buf, type){
  if (!type)
    return buf;
  if (type=='string')
    return utf8_dec.decode(buf);
  throw Error('buf_to_str: invalid type');
}

let disable_timeout = 1;
function Atomics_wait(array, index, value, timeout){
  if (is_worker)
    return Atomics.wait(...arguments);
  let info = 1000, warn = 5000;
  let start;
  if (timeout==undefined)
    timeout = 15000;
  if (disable_timeout)
    timeout = 0;
  if (Atomics.load(array, index)!=value)
    return 'not-equal'; // this is also 'ok' - since we want to wait for change
  start = Date.now();
  while (Atomics.load(array, index)==value){
    let t = Date.now()-start;
    if (info && t>info){
      console.info('Atomics slow');
      info = 0;
    }
    if (warn && t>warn){
      console.warn('Atomics slow');
      warn = 0;
    }
    if (timeout && t>=timeout){
      console.error('Atomics timed-out');
      return 'timed-out';
    }
  }
  return 'ok';
}

// implementation automatic service-worker/direct SharedArrayBuffer
// https://github.com/alexmojaki/sync-message
export class ipc_sync {
  D = 0;
  seq = 0;
  err;
  constructor(ipc_buf){
    this.sab = ipc_buf || {
      data: new SharedArrayBuffer(128*1024),
      cmd: new SharedArrayBuffer(24),
    };
    this._data = this.sab.data;
    this.data = new Uint8Array(this.sab.data);
    let cmd = this.sab.cmd;
    this.lock = new Int32Array(cmd, 4, 1);
    this.sz = new Int32Array(cmd, 8, 1);
    this.len = new Int32Array(cmd, 12, 1);
    this.last = new Int32Array(cmd, 16, 1);
    this._seq = new Int32Array(cmd, 20, 1);
  }
  load_lock(){ return Atomics.load(this.lock, 0); }
  load_sz(){ return Atomics.load(this.sz, 0); }
  load_len(){ return Atomics.load(this.len, 0); }
  load_last(){ return Atomics.load(this.last, 0); }
  load_seq(){ return Atomics.load(this._seq, 0); }
  store_lock(val){ return Atomics.store(this.lock, 0, val); }
  store_sz(val){ return Atomics.store(this.sz, 0, val); }
  store_len(val){ return Atomics.store(this.len, 0, val); }
  store_last(val){ return Atomics.store(this.last, 0, val); }
  store_seq(val){ return Atomics.store(this._seq, 0, val); }
  notify_lock(){
    Atomics.notify(this.lock, 0);
  }
  wait_lock(old_val){
    let res = Atomics_wait(this.lock, 0, old_val);
    if (res!='ok' && res!='not-equal')
      throw Error('failed Atomics.wait()');
  }
  async E_wait_lock(old_val){
    // stupid Atomics.waitAsync() API - it is not an async function
    let _res = Atomics.waitAsync(this.lock, 0, old_val);
    let res = _res.value; // its res.value is *sometimes* async...
    if (typeof res!='string'){
      let slow = D && eslow('ipc E_wait_lock('+old_val+')');
      res = await res;
      D && slow.end();
    }
    if (res!='ok' && res!='not-equal')
      throw Error('failed Atomics.wait()');
    return res;
  }
  write(buf){
    if (this.err)
      throw Error('ipc_sync err state');
    this.err = 'started';
    buf = str_to_buf(buf);
    let sz = buf.byteLength, ofs = 0, len, i;
    this.store_sz(sz);
    for (i=0; !i || ofs<sz; i++, ofs += len){
      // validate ipc channel is free
      if (this.load_lock())
        throw Error('ipc_sync lock busy');
      let len = Math.min(sz-ofs, this._data.byteLength);
      this.store_len(len);
      this.store_last(ofs+len==sz);
      this.seq++;
      this.store_seq(this.seq);
      this.data.set(new Uint8Array(buf, ofs, len), 0);
      this.store_lock(1);
      this.notify_lock();
      this.wait_lock(1);
    }
    this.err = null;
  }
  async E_write(buf, log){
    let x = {};
    if (this.err)
      throw Error('ipc_sync err state');
    this.err = 'started';
    buf = str_to_buf(buf);
    let sz = buf.byteLength, ofs = 0, len, i;
    this.store_sz(sz);
    for (i=0; !i || ofs<sz; i++, ofs += len){
      // validate ipc channel is free (==0)
      if (this.load_lock())
        throw Error('ipc_sync lock busy');
      len = Math.min(sz-ofs, this._data.byteLength);
      this.store_len(len);
      this.store_last(ofs+len==sz ? 1 : 0);
      this.seq++;
      this.store_seq(this.seq);
      this.data.set(new Uint8Array(buf, ofs, len), 0);
      this.store_lock(1);
      this.notify_lock();
      let slow = eslow('E_write('+log+')');
      await this.E_wait_lock(1);
      slow.end();
    }
    if (0 && x.write)
      console.log(x.write);
    this.err = null;
  }
  read(type, log){
    let x = {};
    if (this.err)
      throw Error('ipc_sync err state');
    this.err = 'started';
    let sz, buf, _buf, i = 0, ofs = 0, len, seq, last;
    for (i=0; !i || ofs<sz; i++, ofs += len){
      this.wait_lock(0); // wait for ipc_channel to be busy (!=0)
      if (!i){
        sz = this.load_sz();
        buf = new ArrayBuffer(sz);
        _buf = new Uint8Array(buf);
      }
      len = this.load_len();
      _buf.set(new Uint8Array(this._data, 0, len), ofs);
      last = this.load_last();
      assert(last==(ofs+len==sz ? 1: 0), 'ipc_sync invalid last');
      seq = this.load_seq();
      this.seq++;
      assert(seq==this.seq, 'ipc_sync invalid seq');
      this.store_lock(0);
      this.notify_lock();
    }
    this.err = null;
    if (0 && x.read)
      console.log(x.read);
    if (type)
      buf = buf_to_str(buf, type);
    return buf;
  }
  async E_read(type){
    if (this.err)
      throw Error('ipc_sync err state');
    this.err = 'started';
    let sz, buf, _buf, i = 0, ofs = 0, len, seq, last;
    for (i=0; !i || ofs<sz; i++, ofs += len){
      await this.E_wait_lock(0); // wait for ipc_channel to be busy (!=0)
      if (!i){
        sz = this.load_sz();
        buf = new ArrayBuffer(sz);
        _buf = new Uint8Array(buf);
      }
      len = this.load_len();
      _buf.set(new Uint8Array(this._data, 0, len), ofs);
      last = this.load_last();
      assert(last==(ofs+len==sz ? 1: 0), 'ipc_sync invalid last');
      seq = this.load_seq();
      this.seq++;
      assert(seq==this.seq, 'ipc_sync invalid seq');
      this.store_lock(0);
      this.notify_lock();
    }
    this.err = null;
    if (type)
      buf = buf_to_str(buf, type);
    return buf;
  }
}

export function path_ext(path){
  return path.match(/\.[^./]*$/)?.[0];
}
export function _path_ext(path){
  return path.match(/\.([^./]*)$/)?.[1];
}
export function path_file(path){
  return path.match(/(^.*\/)?([^/]*)$/)?.[2]||'';
}
export function path_dir(path){
  return path.match(/(^.*\/)?([^/]*)$/)?.[1]||'';
}
export function path_is_dir(path){
  return !!(path && str.ends('/'+path, '/', '/.', '/..'));
}
export function path_join(...path){
  let p = path[0];
  for (let i=1; i<path.length; i++){
    let add = path[i];
    p += (p.endsWith('/') ? '' : '/')+(add[0]=='/' ? add.slice(1) : add);
  }
  return p;
}
export function path_dots(path){
  let _path = path.split('/');
  let r = [];
  let is_root = _path[0]=='';
  let is_dir = str.is(_path.at(-1)||'', '', '.', '..');
  for (let i=0; i<_path.length; i++){
    let p = _path[i];
    if (p=='.' || p=='')
      continue;
    if (p=='..'){
      r.pop();
      continue;
    }
    r.push(p);
  }
  let to = r.join('/');
  if (is_root)
    to = '/'+to;
  if (is_dir && to && !to.endsWith('/'))
    to += '/';
  if (!to)
    return './';
  return to;
}
export function path_starts(path, ..._start){
  return arr_find(_start, start=>{
    let v;
    if (!(v=str.starts(path, start)))
      return;
    if (!v.rest || v.rest[0]=='/' || start.endsWith('/'))
      return v;
  });
}

export function uri_enc(path){
  return encodeURIComponent(path)
  .replaceAll('%20', ' ').replaceAll('%2F', '/');
}
export function uri_dec(uri){
  return decodeURIComponent(uri);
}

const esc_regex = s=>s.replace(/[[\]{}()*+?.\\^$|\/]/g, '\\$&');

export function match_glob_to_regex_str(glob){
  return '^(?:'
  +glob.replace(/(\?|\*\*|\*)|([^?*]+)/g,
    m=>m=='?' ? '[^/]' : m=='**' ? '(.*)' : m=='*' ? '([^/]*)' : esc_regex(m))
  +')$';
}
export function match_glob_to_regex(glob){
  return new RegExp(match_glob_to_regex_str(glob));
}
export function match_glob(glob, value){
  return match_glob_to_regex(glob).test(value);
}
export function qs_enc(q){
  let _q = (''+new URLSearchParams(q))
  .replaceAll('%2F', '/').replaceAll('%40', '@').replaceAll('%3A', ':')
  .replaceAll('%2C', ',');
  return _q ? '?'+_q : '';
}
export function qs_append(url, q){
  let _q = typeof q=='string' ? q : qs_enc(q);
  if (!_q)
    return url;
  if (_q[0]=='?')
    _q = _q.slice(1);
  return url+(!url.includes('?') ? '?' : !url.endsWith('?') ? '&' : '')+_q;
}
export function qs_trim(url){
  let u = url.split('?');
  return u[0];
}

// URL.parse() only available on Chrome>=126
function URL_parse(...args){
  try { return new URL(...args); }
  catch(err){}
}
export function T_url_parse(url, base){
  const u = URL_parse(url, base);
  if (!u)
    throw Error('cannot parse url: '+url);
  // some of these fields are setters, so copy object to normal object
  let _u = {path: u.pathname,
    hash: u.hash, host: u.host, hostname: u.hostname, href: u.href,
    origin: u.origin, password: u.password, pathname: u.pathname,
    port: u.port, protocol: u.protocol, search: u.search,
    searchParams: u.searchParams, username: u.username};
  // add info
  _u.path = u.pathname;
  _u.ext = path_ext(_u.path);
  _u.file = path_file(_u.path);
  _u.dir = path_dir(_u.path);
  return _u;
}
export const url_parse = Tf(T_url_parse);

// https://www.iana.org/assignments/uri-schemes/prov/gitoid
// https://docs.npmjs.com/cli/v11/configuring-npm/package-json
// gh/pinheadmz/bcoin@05794f5cb35eb322965d33a045ab68dffc63b21a/lib/bcoin-browser.js
//   https://github.com/pinheadmz/bcoin/blob/05794f5cb35eb322965d33a045ab68dffc63b21a/lib/bcoin-browser.js
//   https://raw.githubusercontent.com/pinheadmz/bcoin/05794f5cb35eb322965d33a045ab68dffc63b21a/lib/bcoin-browser.js
//   https://cdn.jsdelivr.net/gh/pinheadmz/bcoin@05794f5cb35eb322965d33a045ab68dffc63b21a/lib/bcoin-browser.js
//   https://cdn.statically.io/gh/pinheadmz/bcoin@05794f5cb35eb322965d33a045ab68dffc63b21a/lib/bcoin-browser.js
// gh/pinheadmz/bcoin/HEAD/lib/bcoin-browser.js
//   https://github.com/pinheadmz/bcoin/blob/HEAD/lib/bcoin-browser.js
//   https://raw.githubusercontent.com/pinheadmz/bcoin/HEAD/lib/bcoin-browser.js
//   https://cdn.jsdelivr.net/gh/pinheadmz/bcoin@HEAD/lib/bcoin-browser.js
//   https://cdn.statically.io/gh/pinheadmz/bcoin@HEAD/lib/bcoin-browser.js
// Docs:
//   https://statically.io/ - gh GitHub, gl GitLab, 
//   https://www.jsdelivr.com/github - link converter
// Tools: Purge: https://www.jsdelivr.com/tools/purge
// IPFS
//   https://ipfs.io/ipfs/QmZULkCELmmk5XNfCgTnCyFgAVxBRBXyDHGGMVoLFLiXEN
//   https://cloudflare-ipfs.com/ipfs/QmZULkCELmmk5XNfCgTnCyFgAVxBRBXyDHGGMVoLFLiXEN
//   https://ipfs.io/ipfs/QmT5NvUtoM5nWFfrQdVrFtvGfKFmG7AHE8P34isapyhCxX/wiki/Mars.html
//   https://ipfs.io/ipfs/bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq/wiki/Vincent_van_Gogh.html
//   https://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq.ipfs.dweb.link/wiki/
// Docs:
//   https://docs.ipfs.tech/how-to/address-ipfs-on-web/#path-gateway
//   https://gist.github.com/olizilla/81cee26ffa3ae103e4766d2ae0d2f04b
//
// npm/MOD/PATH
// npm/MOD@VER/PATH
// npm/@SCOPE/MOD/PATH
// npm/@SCOPE/MOD@VER/PATH
//   SOURCE https://registry.npmjs.com/MOD
//   https://unpkg.com/MOD@VER/PATH
//   https://cdn.jsdelivr.net/npm/MOD@VER/PATH
// git/github/USER/REPO/PATH
// git/github/USER/REPO@VER/PATH
//   SOURCE https://github.com/USER/REPO/blob/VER/PATH
//   https://raw.githubusercontent.com/USER/REPO/VER/PATH
//   https://statically.io/gh/USER/REPO@VER/PATH
//   https://cdn.jsdelivr.net/gh/USER/REPO@HEAD/PATH
// git/gitlab/USER/REPO@VER/PATH
//   https://statically.io/gl/USER/REPO@VER/PATH
// http/SITE/PATH
// http/SITE@PORT/PATH
//   http://SITE:PORT/PATH
// https/SITE/PATH
// https/SITE@PORT/PATH
//   http://SITE:PORT/PATH
// ipfs/CID/PATH
//   https://ipfs.io/ipfs/CID
//   https://cloudflare-ipfs.com/ipfs/CID
// ipns/NAME/PATH
// bitcoin/BLOCK
// lifcoin/BLOCK
// bittorent/IH/PATH
//  magnet:?xt=urn:btih:IH 
//
// try to support this one day:
// import {groupBy} from 'npm:lodash@4.17.21';

function path_parts(parts){
  return parts.length ? '/'+parts.join('/') : '';
}
export function T_lpm_parse(lpm){
  let l = {};
  let p = lpm.split('/');
  let i = 0;
  let is_npm;
  function next(err){
    let v = p[i++];
    if (typeof v!='string')
      throw Error('lpm_parse missing'+err+': '+lpm);
    if (v=='')
      throw Error('lpm_parse empty element: '+lpm);
    return v;
  }
  function next_submod(){
    let j = p.indexOf('', i);
    if (j==i){
      // in nodejs require('util/') forces it to use npm util, not builtin util
      // but probably should not be allowed for other uses
      if (!is_npm)
        throw Error('invalid empty submod: '+lpm);
      return '';
    }
    if (j<0)
      return '';
    let submod = '/'+p.slice(i, j).join('/')+'/';
    i = j+1;
    return submod;
  }
  function ver_split(name){
    let n = name.split('@');
    if (n.length==1)
      return {name: name, ver: ''};
    if (n.length==2)
      return {name: n[0], ver: '@'+n[1]};
    throw Error('lpm_parse invalid ver inname: '+name);
  }
  let v, lmod, repo;
  l.reg = next('registry (npm, git, bitcoin, lifcoin, ipfs)');
  switch (l.reg){
  case 'npm':
    is_npm = 1;
    l.name = next('module name');
    if (l.name[0]=='@'){
      l.scoped = true;
      let scoped = next('scoped module name');
      v = ver_split(scoped);
      l.name = l.name+'/'+v.name;
    } else {
      v = ver_split(l.name);
      l.name = v.name;
    }
    l.ver = v.ver;
    l.lmod = l.reg+'/'+l.name+l.ver;
    break;
  case 'git': {
    l.host = next('host');
    l.user = next('user');
    repo = next('repo');
    v = ver_split(repo);
    l.repo = v.name;
    l.name = l.user+'/'+l.repo;
    l.ver = v.ver;
    let ver = l.ver ? l.ver.slice(1) : '';
    if (!ver);
    else if (/^[0-9a-f]+$/.test(ver)){
      l.ver_type = ver.length==40 ? 'sha1' : ver.length==64 ? 'sha256' :
        ver.length>=4 && !(ver.length % 2) && ver.length<=20 ? 'shortcut' :
        'name';
    } else
      l.ver_type = 'name';
    l.lmod = l.reg+'/'+l.host+'/'+l.name+l.ver;
    break; }
  case 'bittorent':
    l.infohash = next('InfoHash');
    break;
  case 'lifcoin':
    l.blockid = next('BlockID');
    l.lmod = l.reg+'/'+l.blockid;
    break;
  case 'bitcoin':
    l.blockid = next('BlockID');
    l.lmod = l.reg+'/'+l.blockid;
    break;
  case 'ethereum':
    throw Error('unsupported ethereum '+lpm);
    break;
  case 'ipfs':
    l.cid = next('cid');
    l.lmod = l.reg+'/'+l.cid;
    break;
  case 'ipns':
    l.name = next('name');
    l.lmod = l.reg+'/'+l.name;
    break;
  case 'local':
    l.lmod = l.reg;
    break;
  case 'https': case 'http':
    l.host = next('host');
    l.lmod = l.reg+'/'+l.host;
    break;
  default:
    throw Error('invalid registry: '+lpm);
  }
  l.submod = next_submod();
  l.lmod += l.submod;
  let _p = p.slice(i);
  l.path = path_parts(_p);
  return l;
}
export const lpm_parse = Tf(T_lpm_parse);
export function T_lpm_str(l){
  switch (l.reg){
  case 'npm':
    return l.reg+'/'+l.name+l.ver+l.submod+l.path;
  case 'git':
    return l.reg+'/'+l.host+'/'+l.name+l.ver+l.submod+l.path;
  case 'bittorent':
    return l.reg+'/'+l.infohash+l.submod+l.path;
  case 'lifcoin':
    return l.reg+'/'+l.blockid+l.submod+l.path;
  case 'bitcoin':
    return l.reg+'/'+l.blockid+l.submod+l.path;
    break;
  case 'ethereum':
    throw Error('unsupported ethereum');
  case 'ipfs':
    return l.reg+'/'+l.cid+l.submod+l.path;
  case 'ipns':
    return l.reg+'/'+l.name+l.submod+l.path;
  case 'local':
    return l.reg+l.submod+l.path;
  case 'https': case 'http':
    return l.reg+'/'+l.host+'/'+l.submod+l.path;
  default:
    throw Error('invalid registry: '+l.reg);
  }
}
export const lpm_str = Tf(T_lpm_str);
export function npm_str(u){
  return lpm_to_npm(lpm_str(u));
}

export function T_lpm_lmod(lpm){
  let u = lpm;
  if (typeof lpm=='string')
    u = T_lpm_parse(lpm);
  return u.lmod;
}
export const lpm_lmod = Tf(T_lpm_lmod);

function http_https_to_lpm(url){
  let v;
  if (!(v=str.starts(url, 'http://', 'https://')))
    throw Error('invalid http: https:');
  let u = url_parse(url);
  return T_lpm_str({reg: u.protocol.slice(0, -1), host: u.host,
    submod: u.path=='/' ? '' : u.path.slice(1)+'/', path: ''});
}
function git_to_lpm(url){
  let u = new URL(url), host = u.host;
  let v;
  if (u.host=='github.com')
    host = 'github';
  else if (u.host=='gitlab.com')
    host = 'gitlab';
  else
    throw Error('invalid http registry '+host);
  let p = u.pathname.slice(1).split('/');
  let user = p.shift();
  let repo = p.shift();
  if (!user || !repo)
    throw Error('invalid gith user/repo');
  if (v=str.ends(repo, '.git'))
    repo = v.rest;
  let _path = p.map(p=>'/'+p).join('');
  let ver = u.hash ? '@'+u.hash.slice(1) : '';
  return 'git/'+host+'/'+user+'/'+repo+ver+_path;
}

// parse-package-name: package.json:dependencies
export function T_npm_dep_parse({mod_self, imp, dep, pkg_name}){
  let lmod = T_lpm_lmod(imp);
  let path = T_lpm_parse(imp).path;
  let d = dep, v;
  if (d[0]=='/')
    return T_lpm_str({reg: 'local', submod: d=='/' ? '' : d+'/', path});
  if (v=str.starts(d, './'))
    return mod_self+(v.rest?'/'+v.rest:'')+path;
  if (v=str.starts(d, 'https://github.com/'))
    d = 'git://github.com/'+v.rest;
  if (v=str.starts(d, 'https://gitlab.com/'))
    d = 'git://gitlab.com/'+v.rest;
  if (v=str.starts(d, ['git:', 'git+https:']))
    return git_to_lpm(d)+path;
  if (v=str.starts(d, 'http://', 'https://'))
    return http_https_to_lpm(d)+path;
  if (v=str.starts(d, 'npm:', '.npm/')){
    let _lmod = 'npm/'+v.rest+path;
    let u = lpm_parse(_lmod);
    if (u.name==pkg_name)
      return mod_self+u.path;
    return _lmod;
  }
  if (v=str.starts(d, 'lif:', '.lif/'))
    return v.rest+path;
  if (v=str.starts(d, '.git/', '.local/', '.http/', '.https/'))
    return v.start.slice(1)+v.rest+path;
  if (v=str.starts(dep, 'file:')){
    let file = v.rest;
    if (!(v=str.starts(file, './')))
      throw Error('only ./ files supported: '+dep);
    return mod_self+'/'+v.rest;
  }
  let ver = semver_ver_guess(d);
  return ver ? lmod+'@'+ver+path : undefined;
}
export const npm_dep_parse = Tf(T_npm_dep_parse, '');

export function npm_expand(npm){
  let v;
  if (npm[0]=='/')
    return '.local'+npm;
  if (v=str.starts(npm, 'local:/'))
    return '.local/'+v.rest;
  if (v=str.starts(npm, 'git://'))
    return '.git/'+v.rest;
  if (v=str.starts(npm, 'npm:'))
    return v.rest;
  // TODO: add support for http: https:
  return npm;
}
export function T_npm_to_lpm(npm, opt){
  let v;
  if (!npm[0])
    throw Error('invalid empty npm');
  if (npm[0]=='/'){
    if (opt?.expand) // expand /module -> .local/module (local dev modules)
      return 'local'+npm;
    throw Error('invalid npm: '+npm);
  }
  if (v=str.starts(npm, '.npm/', 'npm:'))
    return 'npm/'+v.rest;
  if (v=str.starts(npm, '.git/', 'git://'))
    return 'git/'+v.rest;
  if (v=str.starts(npm, '.local/', 'local:/'))
    return 'local/'+v.rest;
  if (v=str.starts(npm, '.https/', 'https://'))
    return 'https/'+v.rest;
  if (v=str.starts(npm, '.http/', 'http://'))
    return 'http/'+v.rest;
  if (npm[0]!='.')
    return 'npm/'+npm;
  throw Error('invalid npm: '+npm);
}
export const npm_to_lpm = Tf(T_npm_to_lpm);

export function T_npm_parse(npm, opt){
  return T_lpm_parse(T_npm_to_lpm(npm, opt));
}

export function T_lpm_to_npm(lpm){
  let u = typeof lpm=='string' ? T_lpm_parse(lpm) : lpm;
  if (u.reg=='npm')
    return u.lmod.slice(4)+u.path;
  return '.'+u.lmod+u.path;
}
export const lpm_to_npm = Tf(T_lpm_to_npm);

export function T_webapp_to_lpm(webapp){
  let v;
  if (webapp[0]=='/')
    return 'local'+webapp;
  if (v=str.starts(webapp, 'lif:', 'lif/'))
    return v.rest;
  if (v=str.starts(webapp, 'http:', 'https:')){
    if (v.rest.slice(0, 2)!='//')
      throw Error('invalid webapp '+webapp);
    return v.start.slice(0, -1)+'/'+v.rest.slice(2);
  }
  if (v=str.starts(webapp, 'git:'))
    return 'git/'+v.rest;
  if (lpm_parse(webapp))
    return webapp;
  throw Error('invalid webapp: '+webapp);
}
export const webapp_to_lpm = Tf(T_webapp_to_lpm);

export function lpm_to_sw_passthrough(lpm){
  let l = lpm_parse(lpm);
  switch (l.reg){
  case 'local':
    return l.submod.slice(0, -1)+l.path;
  case 'https': case 'http':
    return l.reg+'://'+l.host+l.submod.slice(0, -1)+l.path;
  }
  return '/.lif/'+lpm;
}

export function url_uri_type(url_uri){
  if (!url_uri)
    throw Error('empty url_uri');
  if (URL_parse(url_uri))
    return 'url';
  if (url_uri[0]=='/')
    return 'uri';
  let dir = url_uri.split('/')[0];
  if (dir=='.' || dir=='..')
    return 'rel';
  return 'mod';
}

function __uri_parse(uri, base){
  if (base && base[0]!='/')
    throw Error('invalid base '+base);
  let u = T_url_parse(uri, 'xxx://x'+(base||''));
  u.host = u.hostname = u.origin = u.href = u.protocol = '';
  return u;
}

export function lpm_ver_missing(u){
  u = _lpm_parse(u);
  return str.is(u.reg, 'npm', 'git') && !u.ver;
}
export function lpm_is_perm(u){
  // XXX needs a lot of refinements. only npm releases (not ^4.1.2,
  // just =4.1.2, are perm. latest is also not perm. semver:~4.1.2 github is
  // also not perm. also commit'ish (not full commit id) is no perm
  let l = _lpm_parse(u);
  switch (l.reg){
  case 'npm':
    // XXX need to validate ver string is final, not expr, not 'latest'
    return !!l.ver;
  case 'git':
    // XXX need to validate ver string is final '4.2.1' not '^4.2.1',
    // not expr semver:.., not 'latest'
    return !!l.ver;
  case 'bittorent':
    return true;
  case 'lifcoin':
    return true;
  case 'bitcoin':
    return true;
  case 'ethereum':
    throw Error('unsupported ethereum');
  case 'ipfs':
    return true;
  case 'ipns':
    return true;
  case 'local':
    return false;
  case 'https': case 'http':
    return false;
  default:
    throw Error('invalid registry: '+l.reg);
  }
}
export function _lpm_parse(lpm){
  return typeof lpm=='string' ? lpm_parse(lpm) : lpm;
}
export function lpm_same_base(lmod_a, lmod_b){
  let a = _lpm_parse(lmod_a), b = _lpm_parse(lmod_b);
  return a.reg==b.reg && a.name==b.name;
}
export function lpm_ver_from_base(lpm, base){
  if (!base)
    return;
  lpm = _lpm_parse(lpm);
  base = _lpm_parse(base);
  if (!(lpm_same_base(lpm, base) && lpm_ver_missing(lpm) && base.ver))
    return;
  return lpm_str({...lpm, ver: base.ver});
}
export function npm_ver_from_base(npm, base){
  if (!base)
    return;
  let v = lpm_ver_from_base(npm_to_lpm(npm), npm_to_lpm(base));
  if (!v)
    return;
  return lpm_to_npm(v);
}

export function T_npm_url_base(url_uri, base_uri){
  let t = url_uri_type(url_uri);
  let tbase = base_uri ? url_uri_type(base_uri) : null;
  let u, is = {};
  if (t=='rel' && !tbase)
    throw Error('npm_url_base('+url_uri+') rel without base');
  if (t=='rel')
    is.rel = 1;
  if (t=='url' || t=='rel' && tbase=='url'){
    let u = url_parse(url_uri, t=='rel' ? base_uri : undefined);
    u.is = is;
    if (u.protocol=='blob:')
      u.is.blob = 1;
    is.url = 1;
    return u;
  }
  if (t=='uri' || t=='rel' && tbase=='uri'){
    u = __uri_parse(url_uri, t=='rel' ? base_uri : undefined);
    u.is = is;
    is.uri = 1;
    return u;
  }
  is.mod = 1;
  let base = tbase=='mod' ? T_npm_parse(base_uri) : undefined;
  if (t=='mod'){
    let lpm = T_npm_parse(url_uri);
    let uri = url_uri;
    if (lpm_ver_from_base(lpm, base)){
      is.rel_ver = 1;
      lpm.ver = base.ver;
      uri = npm_str(lpm);
    }
    u = __uri_parse('/'+uri);
    u.is = is;
    u.path = u.pathname = u.path.slice(1);
    u.dir = u.dir.slice(1);
    u.lmod = T_npm_parse(u.path);
    return u;
  }
  if (t=='rel' && tbase=='mod'){
    base.path = __uri_parse(url_uri, base.path).path;
    u = __uri_parse('/'+npm_str(base));
    u.is = is;
    u.path = u.pathname = u.path.slice(1);
    u.dir = u.dir.slice(1);
    u.lmod = T_npm_parse(u.path);
    return u;
  }
  throw Error('npm_url_base('+url_uri+','+base_uri+') failed');
}
export const npm_url_base = Tf(T_npm_url_base);

let semver_re_part = /v?([0-9.]+)([\-+][0-9.\-+A-Za-z]*)?/;
let semver_re_start = new RegExp('^'+semver_re_part.source);
let semver_re = new RegExp('^'+semver_re_part.source+'$');
export function semver_parse(semver){
  let m = semver.match(semver_re);
  if (!m)
    return;
  return {ver: m[1], rel: m[2]||''};
}

const semver_op_re_start = /^(\^|=|~|>=|<=|\|\|)/;
export function T_semver_range_parse(semver_range){
  let s = semver_range, m, range = [];
  function is(re){
    m = s.match(re);
    if (!m)
      return;
    s = s.slice(m[0].length);
    return true;
  }
  is(/^ +/);
  while (s){
    let op, ver;
    if (is(semver_op_re_start))
      op = m[0];
    is(/^ +/);
    if (op=='||'){
      range.push({op: '||', ver: ''});
      continue;
    }
    if (!is(semver_re_start))
      throw Error('invalid semver_range '+semver_range);
    ver = m[0].replace(/^v/, '');
    range.push({op: op||'', ver});
    is(/^ +/);
  }
  if (!range.length)
    throw Error('empty semver range');
  return range;
}
export const semver_range_parse = Tf(T_semver_range_parse);

export function semver_ver_guess(semver_range){
  let range = semver_range_parse(semver_range);
  if (!range){
    D && console.log('invalid semver_range: '+semver_range);
    return;
  }
  let {op, ver} = range[0];
  if (range.length>1)
    D && console.log('ignoring multi-op imp: '+semver_range);
  if (op=='>=')
    return;
  if (op=='^' || op=='=' || op=='' || op=='~')
    return ver;
  D && console.log('invalid op: '+op);
}

export function export_path_match(path, match, to){
  let ret_val = typeof to=='string' ? null : to || true;
  if (!to)
    to = match;
  let v, f = path, m = match;
  while (v=str.starts(path, './'))
    path = v.rest;
  while (v=str.starts(match, './'))
    match = v.rest;
  if (match.endsWith('/')){
    if (!(v = str.starts(path, match)))
      return;
    return ret_val || to+v.rest;
  }
  if (match.endsWith('*')){
    let re = match_glob_to_regex(match);
    if (!(v = path.match(re)))
      return;
    return ret_val || to.replace('*', v[1]);
  }
  if (path==match)
    return ret_val || to;
}

// https://webpack.js.org/guides/package-exports/
export function pkg_export_lookup(pkg, path){
  let file = path.replace(/^\//, '') || '.';

  function check_val(res, dst){
    let v;
    if (typeof dst!='string')
      return;
    if (!dst.includes('*')){
      res.push(v = dst);
      return v;
    }
    let dfile = path_file(dst);
    let ddir = path_dir(dst);
    if (ddir.includes('*') || dfile!='*')
      throw Error('module('+pkg.name+' dst match * ('+dst+') unsupported');
    res.push(v = dst.slice(0, -1)+dfile);
    return v;
  }
  function parse_val(res, v){
    if (typeof v=='string')
      return check_val(res, v);
    if (typeof v!='object')
      return;
    if (Array.isArray(v)){
      for (let e of v){
        if (parse_val(e))
          return;
      }
      return;
    }
    return parse_val(res, v.browser) ||
      parse_val(res, v.module) ||
      parse_val(res, v.import) ||
      parse_val(res, v.default) ||
      parse_val(res, v.require);
  }
  function parse_section(val){
    let res = [], tr;
    for (let [match, v] of OE(val)){
      if (typeof v=='string'
        ? !(v = export_path_match(file, match, v))
        : !export_path_match(file, match))
      {
        continue;
      }
      parse_val(res, v);
    }
    let best = res[0];
    if (!best)
      return;
    res.forEach(r=>{
      if (r.length > best.length)
        best = r;
    });
    return best;
  }
  function parse_pkg(){
    let exports = pkg.exports, v;
    if (typeof exports=='string')
      exports = {'.': exports};
    if (v = parse_section(exports))
      return v;
    if (file=='.'){
      return check_val([], pkg.browser) ||
        check_val([], pkg.module) ||
        check_val([], pkg.main) ||
        check_val([], 'index.js');
    }
    if (v = parse_section(pkg.browser))
      return v;
  }

  // start package.json lookup
  if (file=='package.json')
    return '/'+file;
  let v;
  let f = parse_pkg();
  if (!f)
    return;
  if (f.startsWith('./'))
    f = f.slice(2);
  if (f!=file) // redirect
    D && console.log('export_lookup redirect '+file+' -> '+f);
  return '/'+f;
}

// useful debugging script: stop on first time
//{ if (file.includes('getProto') && match.includes('getPro') && !self._x_) {self._x_=1; debugger;} }
export function _debugger(stop){
  if ((!arguments.length || stop) && !self._x_){
    self._x_=1;
    debugger; // eslint-disable-line no-debugger
  }
}
// useful for locating who is changes window.location
export function detect_unload(){
  addEventListener('beforeunload', ()=>{debugger;}); // eslint-disable-line no-debugger
}

export function Scroll(s){
  if (!(this instanceof Scroll))
    return new Scroll(...arguments);
  this.s = s;
  this.diff = [];
  this.len = this.s.length;
}
Scroll.prototype.get_diff_pos = function(start, end){
  if (start>end)
    throw Error('diff start>end');
  if (end>this.len)
    throw Error('diff out of s range');
  let i, d;
  // use binary-search in the future
  for (i=0; d=this.diff[i]; i++){
    if (start>=d.end)
      continue;
    if (end<=d.start)
      return i;
    throw Error('diff overlaping');
  }
  return i;
};
Scroll.prototype.splice = function(start, end, s){
  // find the frag pos of src in dst, and update
  let i = this.get_diff_pos(start, end);
  this.diff.splice(i, 0, {start, end, s});
};
Scroll.prototype.out = function(){
  let s = '', at = 0, d;
  for (let i=0; d=this.diff[i]; i++){
    s += this.s.slice(at, d.start)+d.s;
    at = d.end;
  }
  s += this.s.slice(at, this.len);
  return s;
};

export async function ecache(table, id, fn){
  let t, ret;
  if (t = table[id])
    return await t.wait;
  t = table[id] = {id, wait: ewait()};
  try {
    ret = await fn(t);
    t.wait_complete = true;
  } catch(err){
    throw t.wait.throw(err);
  }
  return t.wait.return(ret);
}
ecache.get_sync = (table, id)=>table[id]?.wait_complete && table[id];

export function html_elm(name, attr){
  let elm = document.createElement(name);
  for (let [k, v] of OE(attr))
    elm[k] = v;
  return elm;
}
export function html_favicon_set(href){
  document.head.appendChild(html_elm('link', {rel: 'icon', href}));
}
export function html_stylesheet_add(href){
  // also possible with import
  //let style = (await import(href, {with: {type: 'css'}})).default;
  //document.adoptedStyleSheets = [style];
  document.head.appendChild(html_elm('link', {rel: 'stylesheet', href}));
}

function test_util(){
  let t;
  t = (v, s, arr)=>assert_eq(v, str.is(s, ...arr));
  t(false, 'ab', ['']);
  t(true, 'ab', ['ab']);
  t(true, 'ab', ['', 'ab']);
  t(true, 'D', ['d', ['abc', '', 'D']]);
  t(false, 'D', ['d', ['abc', '', 'd']]);
  t = (s, pre, v)=>{
    assert_obj(v ? {start: v[0], rest: v[1]} : undefined, str.starts(s, pre));
    assert_obj(v ? {start: v[0], rest: v[1]} : undefined, str.starts(s, ...pre));
  };
  t('ab:cd', [''], ['', 'ab:cd']);
  t('ab:cd', ['ab:'], ['ab:', 'cd']);
  t('ab:cd', ['ac:']);
  t('ab:cd', ['ab', 'ab.', 'ac:'], ['ab', ':cd']);
  t('ab:cd', ['ab:', 'ab', 'ac:'], ['ab:', 'cd']);
  t('ab:cd', ['ab:', 'ac:'], ['ab:', 'cd']);
  t('ab:cd', ['cd']);
  t('ab:cd', [/b:/]);
  t('ab:cd', [/ab:/], ['ab:', 'cd']);
  t('ab:cd', [/^ab:/], ['ab:', 'cd']);
  t = (s, pre, v)=>{
    assert_obj(v ? {end: v[0], rest: v[1]} : undefined, str.ends(s, pre));
    assert_obj(v ? {end: v[0], rest: v[1]} : undefined, str.ends(s, ...pre));
  };
  t('ab:cd', [''], ['', 'ab:cd']);
  t('ab:cd', [':cd'], [':cd', 'ab']);
  t('ab:cd', ['ac:']);
  t('ab:cd', [':dc']);
  t('ab:cd', ['cd', 'cd.', 'ac:'], ['cd', 'ab:']);
  t('ab:cd', ['ab:', ':c', ':cd'], [':cd', 'ab']);
  t('ab:cd', ['ab:', ':', 'd'], ['d', 'ab:c']);
  t('ab:cd', ['ab']);
  t = (v, q)=>assert_eq(v, uri_enc(q));
  t('abc def %2B.%0A', 'abc def +.\n');
  t('a%40%3A/.', 'a@:/.');
  t = (v, q)=>assert_eq(v, qs_enc(q));
  t('?abc+def+%0A=', {'abc def \n': ''});
  t('?a=a@:/.%2B+', {a: 'a@:/.+ '});
  t = (v, s)=>assert_eq(v, qs_trim(s));
  t('http://site/dir', 'http://site/dir?q=21');
  t('http://site/dir', 'http://site/dir?q=21?sdsd');
  t('http://site/dir', 'http://site/dir');
  t = (v, url, q)=>assert_eq(v, qs_append(url, q));
  t('http://site/dir?a=1&b=2', 'http://site/dir?a=1', {b: 2});
  t('http://site/dir?a=1&b=2', 'http://site/dir', {a: 1, b: 2});
  t('http://site/dir?a=1&b=2', 'http://site/dir?', {a: 1, b: 2});
  t('http://site/dir?a=1', 'http://site/dir?a=1', {});
  t('http://site/dir', 'http://site/dir', {});
  t('http://site/dir?a@:/+=1+', 'http://site/dir', {'a@:/ ': '1 '});
  t('http://site/dir?a=1&a+=1+', 'http://site/dir?a=1', {'a ': '1 '});
  t('http://site/dir?a=1&b=2', 'http://site/dir?a=1', 'b=2');
  t('http://site/dir?a=1&b=2', 'http://site/dir?a=1', '?b=2');
  t('http://site/dir?b=2', 'http://site/dir', 'b=2');
  t('http://site/dir', 'http://site/dir', '');
  t = (v, path)=>assert_eq(v, path_ext(path));
  t(undefined, 'dir.js/file');
  t('.js', 'dir.js/file.js');
  t('.', 'dir.js/file.');
  t = (v, path)=>assert_eq(v, _path_ext(path));
  t(undefined, 'dir.js/file');
  t('js', 'dir.js/file.js');
  t('', 'dir.js/file.');
  t = (v, path)=>assert_eq(v, path_file(path));
  t('file.js', 'another/dir/dir.js/file.js');
  t('file.js', '/file.js');
  t('', '/');
  t('', 'dir/');
  t('', '');
  t = (v, path)=>assert_eq(v, path_dir(path));
  t('another/dir/dir.js/', 'another/dir/dir.js/file.js');
  t('/', '/file.js');
  t('/', '/');
  t('dir/', 'dir/');
  t('', '');
  t = (v, path)=>assert_eq(v, path_is_dir(path));
  t(false, '/file.js');
  t(true, '/');
  t(true, 'dir/');
  t(false, '');
  t(true, '.');
  t(true, '..');
  t(true, '/..');
  t(true, '/.');
  t(false, '/file..');
  t(false, '/file.');
  t(true, '/dir/..');
  t(true, '/dir/.');
  t = (v, ...path)=>assert_eq(v, path_join(...path));
  t('a/b/c', 'a/b', 'c');
  t('a/b/c', 'a/b', '/c');
  t('a/b/c', 'a/b/', '/c');
  t('a/b//c', 'a/b//', '/c');
  t = (v, path)=>assert_eq(v, path_dots(path));
  t('./', '.');
  t('abc', './abc');
  t('/abc', '/abc');
  t('/abc/', '/abc/');
  t('/abc/def/', '/./abc/././def/./');
  t('/abc/def/', '/./abc/xyz././../def/./');
  t('/abc/def/', '/abc///./def/.//');
  t('/abc/def/', '/abc/def/.');
  t = (v, path, ...start)=>assert_eq(v, path_starts(path, ...start)?.rest);
  t(undefined, 'aa/bb/cc', 'a');
  t(undefined, 'aa/bb/cc', 'aa/b');
  t('/bb/cc', 'aa/bb/cc', 'aa');
  t('bb/cc', 'aa/bb/cc', 'aa/');
  t('/cc', 'aa/bb/cc', 'aa/bb');
  t('cc', 'aa/bb/cc', 'aa/bb/');
  t('', 'aa/bb/cc', 'aa/bb/cc');
  t('/bb/cc', 'aa/bb/cc', 'AA', 'aa');
  t('', 'http://site/dir', 'http://site/dir');
  t(undefined, 'http://site/dir.', 'http://site/dir');
  t(undefined, 'http://site/dir', 'http://site/dir.');
  t(undefined, 'http://site/dir', 'http://site/dir/');
  t('/', 'http://site/dir/', 'http://site/dir');
  t('/file', 'http://site/dir/file', 'http://site/dir');
  t('/', '../', '.', '..');
  t = (v, arg)=>assert_obj_f(v, T_npm_url_base(...arg));
  t({path: '/a/b', origin: 'http://dns', is: {url: 1}},
    ['http://dns/a/b', 'http://oth/c/d']);
  t({path: '/c/a/b', origin: 'http://oth', is: {url: 1, rel: 1}},
    ['./a/b', 'http://oth/c/d']);
  t({path: '/c/d', is: {uri: 1}}, ['/c/d', '/dir/a/b']);
  t({path: '/c//d', is: {uri: 1}}, ['/c//d', '/dir/a/b']);
  t({path: '/dir/a/c/d', is: {uri: 1, rel: 1}}, ['./c/d', '/dir/a/b']);
  t({path: '/dir/c/d', is: {uri: 1, rel: 1}}, ['../c/d', '/dir/a/b']);
  t({path: '/c/d', is: {uri: 1, rel: 1}}, ['../../../../c/d', '/dir/a/b']);
  t({path: 'mod/c/d', is: {mod: 1}}, ['mod/c/d', 'mod/a/b']);
  t({path: 'mod/a/c/d', is: {mod: 1, rel: 1}}, ['./c/d', 'mod/a/b']);
  t({path: 'mod/c/d', is: {mod: 1, rel: 1}}, ['../c/d', 'mod/a/b']);
  t({path: 'mod/c/d', is: {mod: 1, rel: 1}}, ['../../../c/d', 'mod/a/b']);
  t({path: '@mod/v/c/d', is: {mod: 1, rel: 1}},
    ['../../../c/d', '@mod/v/a/b']);
  t({path: 'mod@1.2.3/c/c/d', is: {mod: 1, rel: 1}},
    ['./c/d', 'mod@1.2.3/c/a']);
  t({path: 'mod@1.2.3/c/d', is: {mod: 1, rel_ver: 1}},
    ['mod/c/d', 'mod@1.2.3/c/a']);
  t({path: 'mod@4.5.6/c/d', is: {mod: 1}}, ['mod@4.5.6/c/d', 'mod@1.2.3/c/a']);
  t({path: 'mod/c/d', is: {mod: 1}}, ['mod/c/d', 'other@1.2.3/c/a']);
  t({path: '.git/github/user/repo@v1.2.3/c/d', is: {mod: 1, rel_ver: 1}},
    ['.git/github/user/repo/c/d', '.git/github/user/repo@v1.2.3/c/a']);
  t({path: '.git/github/user/repo/c/d', is: {mod: 1}},
    ['.git/github/user/repo/c/d', '.git/github/other/repo@v1.2.3/c/a']);
  t({path: 'mod/sub//a/c/d', is: {mod: 1, rel: 1}}, ['./c/d', 'mod/sub//a/b']);
  t({path: '@mod/sub/a/c/d', is: {mod: 1, rel: 1}}, ['./c/d', '@mod/sub/a/b']);
  t({path: '.git/github/user/repo@1.2.3/a/c/d', is: {mod: 1, rel: 1}},
    ['./c/d', '.git/github/user/repo@1.2.3/a/b']);
  t = (npm, v)=>assert_obj(v, npm_expand(npm));
  t('mod', 'mod');
  t('/', '.local/');
  t('/dir/file', '.local/dir/file');
  t('/mod//file', '.local/mod//file');
  t('local:/mod//file', '.local/mod//file');
  t('git://github/user/repo@ver/submod//file',
    '.git/github/user/repo@ver/submod//file');
  t = (npm, v)=>assert_obj_f(v, T_npm_parse(npm));
  t('@noble/hashes@1.2.0/esm/utils.js',
    {name: '@noble/hashes', scoped: true,
    ver: '@1.2.0',
    lmod: 'npm/@noble/hashes@1.2.0', path: '/esm/utils.js'});
  t('@noble/hashes@1.2.0/esm/utils.js',
    {name: '@noble/hashes', scoped: true,
    ver: '@1.2.0',
    lmod: 'npm/@noble/hashes@1.2.0', path: '/esm/utils.js'});
  t = (lpm, v)=>{
    let t;
    assert_obj_f(v, t=lpm_parse(lpm));
    if (v)
      assert_eq(lpm, T_lpm_str(t));
  };
  t('local/package.json', {reg: 'local', submod: '',
    lmod: 'local', path: '/package.json'});
  t('local/mod/sub//package.json', {reg: 'local', submod: '/mod/sub/',
    lmod: 'local/mod/sub/', path: '/package.json'});
  t('local/mod/sub//dir/file', {reg: 'local', submod: '/mod/sub/',
    lmod: 'local/mod/sub/', path: '/dir/file'});
  t('local/mod/dir/', {reg: 'local', submod: '/mod/dir/',
    lmod: 'local/mod/dir/', path: ''});
  t('local/mod/sub//', {reg: 'local', submod: '/mod/sub/',
    lmod: 'local/mod/sub/', path: '/'});
  t('npm/mod/dir/file', {reg: 'npm', submod: '',
    lmod: 'npm/mod', path: '/dir/file'});
  t('npm/mod/dir/file', {reg: 'npm', submod: '',
    lmod: 'npm/mod', path: '/dir/file'});
  t('npm/mod/dir/', {reg: 'npm', submod: '/dir/',
    lmod: 'npm/mod/dir/', path: ''});
  t('npm/mod/sub//', {reg: 'npm', submod: '/sub/',
    lmod: 'npm/mod/sub/', path: '/'});
  t('npm/mod/', {reg: 'npm', submod: '', lmod: 'npm/mod', path: '/'});
  t = (v, lpm)=>assert_eq(v, !!lpm_parse(lpm));
  t(true, 'npm/mod/dir/file.js');
  t(true, 'npm/mod/dir//file.js');
  t = (dep, v, opt={})=>assert_eq(v,
    npm_dep_parse({mod_self: 'npm/self@4.5.6', imp: 'npm/xxx', dep, ...opt}));
  t('npm:react', 'npm/react');
  t('npm:react/index.js', 'npm/react/index.js');
  t('npm:@mod/sub@1.2.3/index.js', 'npm/@mod/sub@1.2.3/index.js');
  t('git://github.com/mochajs/mocha', 'git/github/mochajs/mocha');
  t('git+https://github.com/mochajs/mocha', 'git/github/mochajs/mocha');
  t('git://github.com/mochajs/mocha.git#4727d357ea',
    'git/github/mochajs/mocha@4727d357ea');
  t('git://github.com/mochajs/mocha.git/index.js#4727d357ea',
    'git/github/mochajs/mocha@4727d357ea/index.js');
  t('git://github.com/mochajs/mocha/dir/file.js',
    'git/github/mochajs/mocha/dir/file.js');
  t('git://github.com/npm/cli.git#v1.0.27', 'git/github/npm/cli@v1.0.27');
  t('git://github.com/npm/cli.git#semver:~1.0.27',
    'git/github/npm/cli@semver:~1.0.27');
  t('https://github.com/npm/cli.git#v1.0.27', 'git/github/npm/cli@v1.0.27');
  t('https://github.com/npm/cli#v1.0.27', 'git/github/npm/cli@v1.0.27');
  t('https://gitlab.com/npm/cli#v1.0.27', 'git/gitlab/npm/cli@v1.0.27');
  t('https://any.com/dir', 'https/any.com/dir/');
  t('http://any.com/dir', 'http/any.com/dir/');
  t('https://any.com:9000/dir', 'https/any.com:9000/dir/');
  t('http://any.com:9000/dir', 'http/any.com:9000/dir/');
  t('file:./dir/index.js', 'npm/self@4.5.6/dir/index.js');
  t('./dir/index.js', 'npm/self@4.5.6/dir/index.js');
  t('npm:self/dir/index.js', 'npm/self/dir/index.js');
  t('npm:self/dir/index.js', 'npm/self@4.5.6/dir/index.js',
    {pkg_name: 'self'});
  t('http://localhost:3000/lif-kernel', // XXX
    'http/localhost:3000/lif-kernel//util.js',
    {imp: 'npm/lif-kernel/util.js'});
  t('git://github.com/mochajs/mocha',
    'git/github/mochajs/mocha/mod.js',
    {imp: 'npm/mochajs/mod.js'});
  t('lif:npm/react', 'npm/react');
  t('.lif/npm/react', 'npm/react');
  t('lif:git/github/npm/cli@v1.0.27','git/github/npm/cli@v1.0.27');
  t = (imp, dep, v)=>
    assert_eq(v, npm_dep_parse({mod_self: 'npm/mod', imp, dep}));
  t('npm/react', '^18.3.1', 'npm/react@18.3.1');
  t('npm/react/file', '^18.3.1', 'npm/react@18.3.1/file');
  t('npm/xxx', '/', 'local');
  t('npm/xxx/file', '/', 'local/file');
  t('npm/xxx/file', '/DIR', 'local/DIR//file');
  t('npm/react', '=18.3.1', 'npm/react@18.3.1');
  t('npm/react', '18.3.1', 'npm/react@18.3.1');
  t('npm/react', '>=18.3.1');
  t('npm/pages/_app.tsx', './pages', 'npm/mod/pages/_app.tsx');
  t('npm/loc/file.js', '/loc', 'local/loc//file.js');
  t('npm/react', '^18.3.1', 'npm/react@18.3.1');
  t('npm/react/index.js', '^18.3.1', 'npm/react@18.3.1/index.js');
  t('npm/rmod', 'npm:react@18.3.1', 'npm/react@18.3.1');
  t('npm/os/dir/index.js', '.git/github/repo/mod',
    'git/github/repo/mod/dir/index.js');
  t('npm/mod2/dir/main.tsx', '.local/MOD/',
    'local/MOD//dir/main.tsx');
  t('npm/http1/dir/main.tsx', 'http://localhost:3000/MOD',
    'http/localhost:3000/MOD//dir/main.tsx');
  t('npm/http2/dir/main.tsx', 'http://localhost:3000/MOD',
    'http/localhost:3000/MOD//dir/main.tsx');
  t('npm/https1/dir/main.tsx', 'https://localhost:3000/MOD',
    'https/localhost:3000/MOD//dir/main.tsx');
  t('npm/http2/dir/main.tsx', '.http/localhost:3000/MOD/',
    'http/localhost:3000/MOD//dir/main.tsx');
  //t('npm/os/dir/index.js', 'git:user/github/repo/mod',
  //  'git/github/repo/mod/dir/index.js');
  t = (npm, v)=>assert_eq(v, npm_to_lpm(npm));
  t('mod', 'npm/mod');
  t('mod/dir/file', 'npm/mod/dir/file');
  t('@mod/sub', 'npm/@mod/sub');
  t('@mod/sub/', 'npm/@mod/sub/');
  t('@mod/sub/file', 'npm/@mod/sub/file');
  t('.npm/mod', 'npm/mod');
  t('npm:mod', 'npm/mod');
  t('.npm/mod/dir/file', 'npm/mod/dir/file');
  t('.git/github/a_user/a_repo', 'git/github/a_user/a_repo');
  t('git://github/a_user/a_repo', 'git/github/a_user/a_repo');
  t('.git/github/a_user/a_repo/dir/file', 'git/github/a_user/a_repo/dir/file');
  t('.local/file.js', 'local/file.js');
  t('local:/file.js', 'local/file.js');
  t('/file.js');
  t('.local/mod//file.js', 'local/mod//file.js');
  t('.none/github/a_user/a_repo/dir/file');
  t('http://site/dir', 'http/site/dir');
  t('https://site/dir', 'https/site/dir');
  t = (npm, v)=>assert_eq(v, npm_to_lpm(npm, {expand: true}));
  t('.local/file.js', 'local/file.js');
  t('/file.js', 'local/file.js');
  t('/mod//file.js', 'local/mod//file.js');
  t = (webapp, v)=>assert_eq(v, webapp_to_lpm(webapp));
  t('lif:local/file.js', 'local/file.js');
  t('local/file.js', 'local/file.js');
  t('/file.js', 'local/file.js');
  t('lif:npm/react', 'npm/react');
  t('npm/react', 'npm/react');
  t('https://any.com:9000/dir', 'https/any.com:9000/dir');
  t('https/any.com:9000/dir/', 'https/any.com:9000/dir/');
  t('lif/git/github/npm/cli@v1.0.27','git/github/npm/cli@v1.0.27');
  t('git:github/npm/cli@v1.0.27','git/github/npm/cli@v1.0.27');
  t = (lpm, v)=>assert_eq(v, lpm_to_sw_passthrough(lpm));
  t('local/dir/file.js', '/dir/file.js');
  t('local/dir//file.js', '/dir/file.js');
  t('http/localhost:3000/dir//file.js', 'http://localhost:3000/dir/file.js');
  t('npm/mod/file.js', '/.lif/npm/mod/file.js');
  t = (lpm, v)=>assert_eq(v, lpm_to_npm(lpm));
  t('npm/mod', 'mod');
  t('npm/mod/file.js', 'mod/file.js');
  t('npm/mod/sub//file.js', 'mod/sub//file.js');
  t(lpm_parse('npm/mod/sub//file.js'), 'mod/sub//file.js');
  t('git/github/user/repo', '.git/github/user/repo');
  t('git/gitlab/user/repo/file.js', '.git/gitlab/user/repo/file.js');
  t('local', '.local');
  t('local/file.js', '.local/file.js');
  t('local/dir/file.js', '.local/dir/file.js');
  t('local/sub//dir/file.js', '.local/sub//dir/file.js');
  t = (lpm, lmod, path)=>{
    let u = T_lpm_parse(lpm);
    assert_eq(path, u.path);
    assert_eq(lmod, u.lmod);
    assert_eq(lmod, T_lpm_lmod(lpm));
    assert_eq(lpm, T_lpm_str(u));
  };
  t('local', 'local', '');
  t('local/main.tsx', 'local', '/main.tsx');
  t('local/mod//dir/main.tsx', 'local/mod/', '/dir/main.tsx');
  t('local/mod//', 'local/mod/', '/');
  t('local/mod/', 'local/mod/', '');
  t('npm/mod', 'npm/mod', '');
  t('npm/mod/dir/main.tsx', 'npm/mod', '/dir/main.tsx');
  t('git/github/user/repo', 'git/github/user/repo', '');
  t('git/github/user/repo/dir/file.js',
    'git/github/user/repo', '/dir/file.js');
  t('git/github/user/repo/mod//dir/file.js',
    'git/github/user/repo/mod/', '/dir/file.js');
  t = (lpm, v)=>assert_eq(v, lpm_is_perm(lpm));
  t('npm/mod@1.2.3/file', true);
  t('npm/mod/dir', false);
  t('npm/other@1.2.3/file', true);
  t('local/dir/file', false);
  t('local/dir@1.2.3/file', false); // probaby useless and invalid
  t('git/github/user/repo/dir', false);
  t('git/github/user/repo@1.2.3/file', true);
  t = (lpm, base, v)=>assert_eq(v, lpm_ver_from_base(lpm, base));
  t('npm/mod/dir', 'npm/mod@1.2.3/file', 'npm/mod@1.2.3/dir');
  t('npm/mod/dir', 'npm/mod/file');
  t('npm/mod/dir', 'npm/mod/dir');
  t('npm/mod/dir', 'npm/other@1.2.3/file');
  t('local/dir/file', 'local/dir@1.2.3/file');
  t('git/github/user/repo/dir', 'git/github/user/repo@1.2.3/file',
    'git/github/user/repo@1.2.3/dir');
  t = (semver, v)=>assert_obj(v, semver_parse(semver));
  t('1.2.3', {ver: '1.2.3', rel: ''});
  t('1.2.3-abc', {ver: '1.2.3', rel: '-abc'});
  t('1.2.3-abc2-341.3', {ver: '1.2.3', rel: '-abc2-341.3'});
  t('x1.2.3-abc2-341.3');
  t('1.2.3x-abc2-341.3');
  t('1.2.3-a_');
  t = (range, v, guess)=>{
    assert_obj_f(v, semver_range_parse(range));
    assert_obj(guess, semver_ver_guess(range));
  };
  t('1.2.3', [{ver: '1.2.3'}], '1.2.3');
  t('v1.2.3-ab', [{ver: '1.2.3-ab'}], '1.2.3-ab');
  t('=1.2.3', [{ver: '1.2.3', op: '='}], '1.2.3');
  t('~1.2.3', [{ver: '1.2.3', op: '~'}], '1.2.3');
  t('1.2.3 >=v1.3.4', [{op: '', ver: '1.2.3'}, {op: '>=', ver: '1.3.4'}],
    '1.2.3');
  t(' = 1.2.3 >= 1.3.4 ', [{op: '=', ver: '1.2.3'}, {op: '>=', ver: '1.3.4'}],
    '1.2.3');
  t('=1.2.3 +1.3.4');
  t('=1.2.3 x.2.3');
  t('^1.2.3 || ^4.5.6', [{op: '^', ver: '1.2.3'}, {op: '||', ver: ''},
    {op: '^', ver: '4.5.6'}], '1.2.3');
  t('  ');
  t = (path, match, tr, v)=>assert_obj(v, export_path_match(path, match, tr));
  t('file', 'file', null, true);
  t('file', 'file', {x: 1}, {x: 1});
  t('file', 'f', undefined);
  t('.', '.', 'index.js', 'index.js');
  t('esm/file.js', './esm/*', './esm/*', './esm/file.js');
  t('file', './file', './file.js', './file.js');
  t('dir/index.js', './dir/*', './dir/*', './dir/index.js');
  t('file.js', './*', './*', './file.js');
  t('.', '.', './index.js', './index.js');
  t('esm/file.js', './esm/*', './esm/X*', './esm/Xfile.js');
  t = (path, match, v)=>assert_eq(v, export_path_match(path, match));
  t('esm/file.js', './esm/', true);
  t('esm/file.js', './esm');
  t('esm/file.js', './file.js');
  t('file.js', './file.jss');
  t = (pkg, file, v)=>assert_obj(v, pkg_export_lookup(pkg, file));
  t({exports: {'.': './exp'}}, '', '/exp');
  t({exports: {'.': './exp'}}, '/', '/exp');
  t({exports: {'.': './exp'}}, '/exp');
  t({exports: {'.': './exp'}}, '/package.json', '/package.json');
  t({main: './Main', exports: {'.': './exp'}}, '', '/exp');
  t({main: 'Main'}, '', '/Main');
  t({main: 'Main'}, '/', '/Main');
  t({main: 'Main'}, '/Main');
  t({main: './Main'}, '/Main');
  t({main: '././Main'}, '/Main');
  t({main: 'Main', module: 'Mod'}, '/Mod');
  t({main: 'Main', exports: 'Exp'}, '/Exp');
  t({exports: {'.': {server: './ser', default: './def'}}}, '', '/def');
  t({exports: {'.': {default: 'def', import: 'imp', module: 'mod'}}},
    '', '/mod');
  t({exports: {'.': {default: 'def'}}, default: 'Def'}, '', '/def');
  t({exports: {'.': {default: 'def'}}, import: 'Imp'}, '', '/def');
  t({exports: {'.': {import: 'imp'}}, module: 'Mod'}, '', '/imp');
  t({exports: {'.': {require: 'req'}}}, '', '/req');
  t({exports: {'.': './exp'}}, '/a');
  t({exports: {'./a': './b'}}, '/a', '/b');
  t({exports: {'./a': {default: 'Def', import: 'Imp'}}}, '/a', '/Imp');
  t({exports: {'a': './b'}}, '/a', '/b');
  t({exports: {'./a/*': './b/*'}}, '/a/A', '/b/A');
  t({exports: {'./a/*.js': './b/*.esm'}}, '/a/A'); // * allowed only at end
  t({exports: {'./a/*': './b/*.esm'}}, '/a/A', '/b/A.esm');
  t({exports: {'a/*': './b/*.esm'}}, '/a/A', '/b/A.esm');
  t({exports: {'./a/*': 'b/*.esm'}}, '/a/A', '/b/A.esm');
  t({browser: './br'}, '', '/br');
  t({browser: 'br', exports: 'ex'}, '', '/ex');
  t({browser: {'a' : 'br'}}, 'a', '/br');
  t({browser: {'a' : {default: 'Def',  import: 'Imp'}}}, 'a', '/Imp');
  let scr = Scroll('0123456789abcdef');
  t = v=>assert_eq(v, scr.out());
  scr.splice(3, 5, 'ABCD');
  t('012ABCD56789abcdef');
  scr.splice(6, 7, 'QW');
  t('012ABCD5QW789abcdef');
  scr.splice(7, 8, '  ');
  t('012ABCD5QW  89abcdef');
  scr.splice(6, 6, '-');
  scr.splice(7, 7, '-');
  scr.splice(8, 8, '-');
  t('012ABCD5-QW-  -89abcdef');
}
test_util();

