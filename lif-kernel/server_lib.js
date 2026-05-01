/* eslint-env node */
import http from 'http';
import https from 'https';
import process from 'process';
import fs from 'fs';
import os from 'os';
import tls from 'tls';
import path from 'path';
import mime_db from './mime_db.js';
import util from './util.js';
import x509 from '@peculiar/x509';
import dnss from './dnss.js';
import acme from './acme.js';
let {esleep, assert_eq, path_starts, path_join, path_dots,
  path_file, path_is_dir, str} = util;

const MS = {
  SEC: 1000,
  WEEK: 7*24*3600*1000,
  MONTH: 30*24*3600*1000,
};
const ssl_dir = '/var/lif/ssl';
let acme_cert_key, acme_account_key;

// XXX: copy from date.js
function pad(num, size){ return ('000'+num).slice(-size); }
function to_sql_ms(d){
  d = d||new Date();
  if (isNaN(d))
    return '0000-00-00 00:00:00.000';
  return pad(d.getUTCFullYear(), 4)+'-'+pad(d.getUTCMonth()+1, 2)
    +'-'+pad(d.getUTCDate(), 2)
    +' '+pad(d.getUTCHours(), 2)+':'+pad(d.getUTCMinutes(), 2)
    +':'+pad(d.getUTCSeconds(), 2)
    +'.'+pad(d.getUTCMilliseconds(), 3);
}
function to_sql(d){ return to_sql_ms(d).replace(/( 00:00:00)?....$/, ''); }

const res_err = (res, code, msg)=>{
  res.writeHead(code, msg, {'cache-control': 'no-cache'}).end();
};
let coi_enable = true;
const res_send = (res, _path)=>{
  let ext = (path.extname(_path)||'').slice(1);
  let ctype = mime_db.ext2mime[ext]||'plain/text';
  let e = fs.statSync(_path, {throwIfNoEntry: false});
  if (!e || !e.isFile())
    return res_err(res, 404, 'file not found');
  let h = {};
  h['content-type'] = ctype;
  h['cache-control'] = 'no-cache'; // for dev/debug
  if (coi_enable){
    h['cross-origin-embedder-policy'] = 'require-corp';
    h['cross-origin-opener-policy'] = 'same-origin';
  }
  let stream = fs.createReadStream(_path);
  res.writeHead(200, h);
  stream.pipe(res);
};

const map_uri = ({uri, opt: {map, root}})=>{
  let _uri, _to;
  if (path_is_dir(uri))
    uri = path_join(uri, 'index.html');
  for (let f in map){
    let to = map[f], v;
    if (v=path_starts(uri, f)){
      _to = to;
      _uri = v.rest;
      break;
    }
  }
  if (_uri==undefined)
    return;
  if (path_starts(_to, '.', '..'))
    _to = path_join(root, _to);
  if (_uri)
    _to = path_join(_to, _uri);
  _to = path_dots(_to);
  if (_to.endsWith('/'))
    _to = path_join(_to, path_file(uri)||'index.html');
  return _to;
};
function test_server(){
  let map = {
    '/os': '../',
    '/kernel': '/root/os/kernel',
    '/this': '/that/mod',
    '/sw.js': '/root/os/kernel/sw.js',
    '/': './',
  };
  let root = '/ROOT/os';
  let t = (uri, path, opt)=>
    assert_eq(path, map_uri({uri, opt: {root, map}}));
  t('/', '/ROOT/os/index.html');
  t('/util.js', '/ROOT/os/util.js');
  t('/sw.js', '/root/os/kernel/sw.js');
  t('/kernel/kernel.js', '/root/os/kernel/kernel.js');
  t('/os/package.json', '/ROOT/package.json');
  t('/index.html', '/ROOT/os/index.html');
  t('/favicon.ico', '/ROOT/os/favicon.ico');
  t('/kernel/mod/favicon.ico', '/root/os/kernel/mod/favicon.ico');
  t('/this/mod/favicon.ico', '/that/mod/mod/favicon.ico');
  delete map['/'];
  t('/', undefined);
  t('/util.js', undefined);
}
test_server();

let options = {};
const http_listener = (req, res)=>{
  let uri = new URL('http://localhost'+req.url).pathname;
  uri = decodeURI(uri);
  let path = map_uri({uri, opt: options});
  res.on('finish', ()=>console.log(
    `${uri} ${res.statusCode} ${res.statusMessage}`));
  if (!path)
    return res_err(res, 404, 'no map found');
  return res_send(res, path);
};

function sni_cb(server_name, cb){
  console.log('XXX sni_cb %s', server_name);
  let domain = dnss.get_our_domain(server_name);
  if (!domain){
    let err = 'domain not handled '+server_name;
    console.error('server: %s', err);
    return cb(err, null);
  }
  let ctx = ssl_cert[domain.name] && ssl_cert[domain.name].ctx;
  if (!ctx){
    let err = 'failed to get ssl ctx for '+server_name;
    console.error('server: %s', err);
    return cb(err, null);
  }
  cb(null, ctx);
}

const server = http.createServer(http_listener);
const sserver = https.createServer({SNICallback: sni_cb}, http_listener);

function get_acme_cert_files(domain){
  domain = domain.replace(/\./g, '_');
  return {cert: ssl_dir+'/acme_star_'+domain+'.crt',
    key: ssl_dir+'/acme_star_'+domain+'.key'};
}

const load_cert = async(domain, opt)=>{
  let file_cert = opt.cert, file_key = opt.key, cert, key;
  cert = await fs.promises.readFile(file_cert);
  key = await fs.promises.readFile(file_key);
  await set_cert(domain, file_cert, file_key, cert, key);
};

const ssl_cert = {};

function cert_valid_for(valid_from, valid_to){
  let ts = new Date();
  if (!valid_from || !valid_to)
    return 0;
  if (valid_from > ts)
    return 0;
  if (valid_to < ts)
    return 0;
  return valid_to - ts;
}

const get_key = async(opt)=>{
  let file = ssl_dir+'/'+opt.file, pem;
  await fs.promises.mkdir(ssl_dir, {recursive: true});
  try {
    pem = await fs.promises.readFile(file);
  } catch(err){ console.log('ssl: acme key not found at %s ', file); }
  if (pem)
    return new Buffer(pem);
  let key = await opt.func();
  console.log('ssl: save acme key at %s', file);
  await fs.promises.writeFile(file, key.toString());
  return key;
};
const get_acme_account_key = ()=>get_key({file: 'acme_account_key.pem',
  func: acme.create_account_key});
const get_acme_cert_key = ()=>get_key({file: 'acme_cert_key.pem',
  func: acme.create_cert_key});

const set_cert = async(domain, file_cert, file_key, cert, key)=>{
  let cert_o = new x509.X509Certificate(cert);
  if (cert_o.subject.toLowerCase().search(domain)==-1) // XXX need api
    throw Error('domain not found in cert '+domain);
  let ts = new Date(), ctx;
  let valid_from = new Date(cert_o.notBefore);
  let valid_to = new Date(cert_o.notAfter);
  let valid_for = cert_valid_for(valid_from, valid_to);
  if (!valid_for){
    console.error('ssl: %s cert expired valid from %s to %s now %s', domain,
      to_sql(valid_from), to_sql(valid_to), to_sql(ts));
  } else if (valid_for < MS.WEEK){
    console.error('ssl: %s cert expire soon valid from %s to %s', domain,
      to_sql(valid_from), to_sql(valid_to));
  }
  // XXX TODO: check *.domain
  ctx = tls.createSecureContext({key, cert});
  ssl_cert[domain] = {ts, file_cert, file_key, cert, key, valid_from, valid_to,
    ctx};
  console.log('ssl: set cert %s valid from %s to %s', domain,
    to_sql(valid_from), to_sql(valid_to));
};

const _acme_check_if_need_ssl = async()=>{
  try {
    console.log('ssl: acme_check_if_need_ssl %O', dnss.domains);
    let queue = [];
    if (!dnss.domains)
      return;
    for (let name in dnss.domains){
      if (dnss.domains[name].ssl)
        queue.push(name);
    }
    for (let i=0; i<queue.length; i++){
      let name = queue[i], cert;
      console.log('ssl: load_cert domain %s', name);
      try { await load_cert(name, get_acme_cert_files(name)); }
      catch(err){ console.log('ssl: failed load acme cert %s', err); }
      let info = ssl_cert[name];
      if (info){
        let valid_for = cert_valid_for(info.valid_from,
          info.valid_to);
        if (valid_for > MS.MONTH)
          continue;
        console.log('ssl: cert %s will expire soon, renew', name);
      }
      try {
        console.log('ssl: requet_cert %s', name);
        cert = await acme.requet_cert({domain: name,
          account_key: acme_account_key, cert_key: acme_cert_key});
      } catch(err){
        console.error('ssl: failed issue acme cert %s %s', name, err);
        continue;
      }
      let o = get_acme_cert_files(name);
      try { await fs.promises.writeFile(o.cert, cert.toString()); }
      catch(err){
        console.error('ssl: failed save cert %s %s', o.cert, err);
      } try {
          await fs.promises.writeFile(o.key, acme_cert_key.toString());
      }
      catch(err){
        console.error('ssl: failed save key %s %s', o.key, err); }
      await set_cert(name, o.cert, o.key, cert, acme_cert_key);
    }
  } catch(err){ console.error('acme: check_if_need_ssl failed %O',
    err.stack);
  }
};

const acme_check_if_need_ssl = async()=>{
  while (1){
    await _acme_check_if_need_ssl();
    await esleep(MS.WEEK);
  }
};

function get_wan_ips(){
  let interfaces = os.networkInterfaces();
  let ret = [];
  for (let [name, infos] of Object.entries(interfaces)){
    for (const info of infos){
      if (!info.internal && info.family=='IPv4')
        ret.push({name, address: info.address});
    }
  }
  return ret;
}

async function do_ssl(opt){
  let wan_ips = get_wan_ips();
  let dnss_opt = {ips: []};
  let sport = opt?.sport||443;
  for (let o of wan_ips)
    dnss_opt.ips.push({address: o.address, port: 53});
  dnss.start(dnss_opt);
  console.log('service DNS port 53');
  acme.init({dnss: dnss});
  acme_account_key = await get_acme_account_key();
  acme_cert_key = await get_acme_cert_key();
  dnss.set_domains({
    'arik.center': {ssl: true, ip: '165.227.185.44', ns: ['ns1', 'ns2']}
  });
  sserver.listen(sport, ()=>{
    console.log(`Serving SSL ${options.root} on https://localhost:${sport}`);
  });
  acme_check_if_need_ssl(); // background: dont wait
}

async function run(opt){
  let port = 3000;
  let [...argv] = [...process.argv];
  let a, ssl;
  let map = options.map = {...opt?.map||{}};
  options.root = opt.root||process.cwd();
  argv.shift();
  argv.shift();
  while ((a=argv[0])!=undefined){
    if (a=='-p' || a=='--port'){
      argv.shift();
      port = +argv.shift();
    } else if (a=='-m' || a=='--map'){
      argv.shift();
      map[argv.shift()] = argv.shift();
      break;
    } else if (a=='-s' || a=='--ssl'){
      argv.shift();
      ssl = 1;
    }
  }
  if (argv[0]!=undefined)
    throw 'invalid args '+JSON.stringify(argv);
  let lif_kernel;
  if (!(lif_kernel = map['/lif-kernel']))
    map['/lif-kernel'] = lif_kernel = import.meta.dirname;
  if (!map['/.lif.kernel_sw.js'])
    map['/.lif.kernel_sw.js'] = lif_kernel+'/lif_kernel_sw.js';
  if (!map['/index.html'])
    map['/index.html'] = lif_kernel+'/index.html';
  if (!map['/favicon.ico'])
    map['/favicon.ico'] = lif_kernel+'/favicon.ico';
  console.log(map);
  server.listen(port, ()=>{
    console.log(`Serving ${options.root} on http://localhost:${port}`);
  });
  if (ssl)
    do_ssl();
}

export default run;
