'use strict'; /* LICENSE_CODE_JPL */
const {opcodes}= require('../script/common');
const {OF, obj_find}= require('../utils/util');
const assert = require('bsert');

function parse(script){
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
    console.log(`invalid kv json k ${key} v ${_val}`);
    return;
  }
  return {key, val};
}

function tx_merge(tx){
  let kvs_vout = {};
  let [vout_def] = obj_find(tx.vout, (i, kv)=>kv.spend) || [0];
  let kvs = [];
  let vin_keys = {};
  // prepare all keys needed to be mapped to vouts
  for (let [vin, _kv] of OF(tx.vin)){
    for (let kv of _kv){
      kvs.push({vout: 0, vin: +vin, kv});
      vin_keys[kv.key] = true;
    }
  }
  let nout = 0;
  for (let [vout, kv] of OF(tx.vout)){
    vout = +vout;
    nout = Math.max(nout, vout+1);
    if (!kv || kv.key==null)
      continue;
    // if already exists and not in inputs then it we dont own it
    if (kv.exists && !vin_keys[kv.key])
      continue; // owned by someone else
    kvs.push({vout, kv});
  }
  // map keys
  for (let j=0; j<kvs.length; j++){
    let {vout, kv: {key, val}, vin} = kvs[j];
    for (let jj=j+1; jj<kvs.length; jj++){
      let kv = kvs[jj];
      if (kv.kv.key!=key)
        continue;
      vout = kv.vout;
      if (kv.kv.val!=null)
        val = kv.kv.val;
      kvs.splice(jj, 1);
      jj--;
    }
    // find first spendable vout after position.
    // if non found - use default position: first spendable vout.
    // if all non-spendable - then vout 0
    for (; vout<nout && !tx.vout[vout].spend; vout++);
    if (vout==nout)
      vout = vout_def;
    // add kv to the vout kv array at that position
    let o = kvs_vout[vout] ||= [];
    o.push({key, val, ...(vin ? {vin} : {})});
  }
  return kvs_vout;
}

let assert_obj = assert.deepStrictEqual;

function test(){
  let t = (tx, res)=>assert_obj(res, tx_merge(tx));
  t({vin: {3: [{key: 'k1', val: 'v1'}]},
    vout: {
      0: {},
      1: {spend: true}}},
    {1: [{key: 'k1', val: 'v1', vin: 3}]});
  t({vin: {3: [{key: 'k1', val: 'v1'}]},
    vout: {
      0: {spend: true},
      1: {key: 'k1'},
      2: {spend: true}}},
    {2: [{key: 'k1', val: 'v1', vin: 3}]});
  t({vin: {3: [{key: 'k1', val: 'v1'}]},
    vout: {
      0: {spend: true},
      1: {key: 'k1', val: 'v2'},
      2: {spend: true}}},
    {2: [{key: 'k1', val: 'v2', vin: 3}]});
  t({vin: {},
    vout: {
      0: {key: 'k1', val: 'v2', exists: true},
      1: {spend: true}}},
    {});
  t({vin: {3: [{key: 'k1', val: 'v1'}]},
    vout: {
      0: {key: 'k1', val: 'v2', exists: true},
      1: {spend: true}}},
    {1: [{key: 'k1', val: 'v2', vin: 3}]});
  t({vin: {3: [{key: 'k1', val: 'v1'}]},
    vout: {
      0: {spend: true},
      1: {key: 'k1', val: 'v2'},
      2: {}}},
    {0: [{key: 'k1', val: 'v2', vin: 3}]});
  t({vin: {3: [{key: 'k1', val: 'v1'}]},
    vout: {
      0: {key: 'k1', val: 'v2'},
      1: {spend: true},
      2: {key: 'k1', val: 'v3'},
      3: {spend: true}}},
    {3: [{key: 'k1', val: 'v3', vin: 3}]});
  t({vin: {
      3: [{key: 'k1', val: 'v1'}],
      4: [{key: 'k2', val: 'v2'},
        {key: 'k3', val: 'v3'}],
    },
    vout: {
      0: {key: 'k4', val: 'v4'},
      1: {},
      2: {spend: true},
      3: {spend: true},
      4: {key: 'k2', val: 'v2x'},
      5: {spend: true},
      6: {key: 'k1'},
      7: {spend: true},
      8: {key: 'k5', val: 'v5'},
      9: {key: 'k6', val: 's6', exists: true},
    },
  }, {
    2: [
      {key: 'k3', val: 'v3', vin: 4},
      {key: 'k4', val: 'v4'},
      {key: 'k5', val: 'v5'}
    ],
    5: [{key: 'k2', val: 'v2x', vin: 4}],
    7: [{key: 'k1', val: 'v1', vin: 3}],
  });
}
test();

async function idx_tx_add(tx, db_op){
  // get previous kv
  let vin = {};
  let is_kv;
  for (let i=0; i<tx.inputs.length; i++){
    let input = tx.inputs[i];
    let p = input.prevout;
    let p_vout = await db_op.tx_kv_get(p.hash);
    if (!p_vout)
      continue;
    if (!p_vout) debugger;
    if (!p_vout[p.index])
      continue;
    is_kv = true;
    vin[i] = p_vout[p.index];
  }
  // get new kv in outputs
  let vout = {};
  for (let i=0; i<tx.outputs.length; i++){
    let script = tx.outputs[i].script;
    let code = script.code;
    let vo = vout[i] = {};
    vo.spend = code.length && code[0].value!=opcodes.OP_RETURN;
    let kv;
    if (!(kv = parse(script)))
      continue;
    // validate key is not already owned by other
    vo.exists = await db_op.kv_exists(kv.key);
    vo.key = kv.key;
    vo.val = kv.val;
    is_kv = true;
  }
  if (!is_kv)
    return;
  // update DB
  let tx_kv = tx_merge({vin, vout});
  await db_op.tx_kv_put(tx.hash(), tx_kv);
  for (let [vout, _kv] of OF(tx_kv)){
    for (let kv of _kv)
      await db_op.kv_put(tx.hash(), vout, kv.key, kv.val);
  }
  return true;
}

async function idx_tx_rm(tx, db_op){
  let vals = await db_op.tx_kv_get(tx.hash());
  if (!vals)
    return;
  for (let [vout, kvs] of OF(vals)){
    for (let p of kvs){
      let {key, val, vin} = p;
      if (vin==null){
        await db_op.kv_del(key);
        continue;
      }
      let p = tx.inputs[vin].prevout;
      let p_vout = await db_op.tx_kv_get(p.hash);
      if (!p_vout){
        console.warn(`failed loading prev kv ${key} ${vin}`);
        continue;
      }
      let p_val;
      if (!(p_val = p_vout[p.index])){
        console.warn(`failed missing prev kv ${key} ${vin}`);
        continue;
      }
      if (p_val==null)
        await db_op.kv_del(tx.hash(), vout, key);
      else
        await db_op.kv_put(tx.hash(), vout, key, p_val);
    }
  }
  await db_op.tx_kv_del(tx.hash());
}
 
module.exports = {parse, tx_merge, idx_tx_add, idx_tx_rm};
