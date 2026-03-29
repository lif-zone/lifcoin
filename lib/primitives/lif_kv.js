'use strict'; /* LICENSE_CODE_JPL */
const {opcodes}= require('../script/common');

function lif_kv_parse(script){
  let code = script.code;
  let v = [];
  if (!code.length)
    return;
  if (code[0].value!=opcodes.OP_RETURN)
    return;
  // validate its all just PUSH bytes/data
  for (let i=1; i<code.length; i++){
    let op = code[i];
    if (op.value<opcodes.OP_PUSHBYTES1 || op.value>=opcodes.OP_PUSHDATA4)
      return;
    v.push(op.data.toString('ascii'));
  }
  // check its lif key <KEY> val <VAL> format
  let i=0;
  if (v[i++]!='lif')
    return;
  if (v[i++]!='key')
    return;
  let key;
  if ((key = v[i++])==undefined)
    return;
  if (v[i++]!='val')
    return;
  let _val;
  if ((_val = v[i++])==undefined)
    return;
  if (v[i]!=undefined)
    return;
  let val;
  try {
    val = JSON.parse(_val);
  } catch(e){
     this.logger.warning(`invalid kv json k ${key} v ${_val}`);
     return;
  }
  return {key, val};
}

function lif_kv_select(vals){
  for (let [i, v] of Object.entries(vals)){
    // XXX just return the first one found. in the future sort then
    // and track the ownership and diffs
    return v;
  }
}

module.exports = {lif_kv_parse, lif_kv_select};
