// LICENSE_CODE JPL: mine_worker.js
import {ipc_postmessage} from './util.js';
let version = '26.4.23';
let ipc;
function init(){
  ipc = new ipc_postmessage();
  globalThis.addEventListener("message", event=>{
    if (ipc.listen(event))
      return;
    console.error('invalid message', event.data, event);
  });
  ipc.add_server_cmd('version', ()=>({version}));
  ipc.add_server_cmd('mine', ({header, min, max})=>{
    console.log('mining', header);
  });
}
init();
