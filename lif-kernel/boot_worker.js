// LIF bootloader worker: assistance for sync operations
let boot_worker_version = '26.4.23';
/*
import util from '/lif-kernel/util.js';
let {ipc_sync, eslow} = util;
*/
import {ipc_sync, eslow} from '/lif-kernel/util.js';
let D = 0;
console.log('boot_worker started '+boot_worker_version);
//let {ipc_sync, eslow} = util;
let json = JSON.stringify;
globalThis.addEventListener("message", event=>{
  D && console.log('worker got message', event.data, event);
  if (event.data.fetch_init)
    return ipc_fetch_init(event);
  console.error('invalid message', event.data);
});

let ipc = {read: null, write: null};
let d_a = globalThis.ipc_fetch_state = ['init'];
function d(s){
  d_a.push(s);
  d_a.shift();
  return s;
}
async function ipc_fetch(){
  let slow;
  d('waiting req');
  let b = await ipc.read.E_read('string');
  d('got req');
  let req = JSON.parse(b);
  let url = req.url;
  slow = eslow(15000, d('ipc_fetch('+url+') fetch()'));
  let response = await fetch(req.url, req.opt);
  slow.end();
  D && console.log('ipc_fetch '+url, response);
  let res = {status: response.status};
  if (response.status!=200){
    console.log('worker fetch('+url+') failed '+response.status);
    slow = eslow(15000, d('ipc_fetch('+url+') err headers'));
    await ipc.write.E_write(json({status: response.status}));
    slow.end();
    slow = eslow(15000, d('ipc_fetch('+url+') err body'));
    await ipc.write.E_write('');
    slow.end();
    d('end err');
    return;
  }
  slow = eslow(15000, d('ipc_fetch('+url+') body'));
  let blob = await response.blob();
  let body = await blob.arrayBuffer();
  slow.end();
  res.length = blob.length;
  res.ctype = blob.type;
  res.body = 1;
  slow = eslow(15000, d('ipc_fetch('+url+') resp headers'));
  await ipc.write.E_write(json(res), 'ipc_fetch resp headers '+url);
  slow.end();
  slow = eslow(15000, d('ipc_fetch('+url+') resp body'));
  await ipc.write.E_write(body, 'ipc_fetch resp body '+url);
  slow.end();
  d('end');
}

async function ipc_fetch_init(event){
  d('ipc_fetch_init');
  let {sab} = event.data.fetch_init;
  ipc.read = new ipc_sync(sab.read);
  ipc.write = new ipc_sync(sab.write);
  self.postMessage({fetch_inited: true});
  D && console.log('ipc_fetch_init');
  while (1){
    try {
      await ipc_fetch();
    } catch(err){
      console.error(d('ipc_fetch err'), err);
    }
  }
}

