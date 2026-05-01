// LICENSE_CODE ZON
'use strict'; /*jslint node:true*/
// local testing port 5d: dig @localhost -p 54 test.com A
import dns2 from 'dns2';
const {Packet} = dns2;
// based: dig @8.8.8.8 google.com SOA
const DEF_PORT = 53;
const DEF_TTL = 300;
const DEF_TTL_REFRESH = 900;
const DEF_TTL_RETRY = 900;
const DEF_TTL_EXPIRATION = 1800;
const DEF_TTL_MINIMUM = 60;

const E = {};
export default E;

function get_our_domain(name){
  if (!E.domains)
    return;
  name = name.toLowerCase();
  if (E.domains[name])
    return E.domains[name];
  let parent = name.split('.').slice(1).join('.');
  if (E.domains[parent])
    return E.domains[parent];
}

function is_our_domain(name){ return !!get_our_domain(name); }

E.is_our_domain = is_our_domain;
E.get_our_domain = get_our_domain;
E.get_txt = (name, val)=>E.txt[name.toLowerCase()];
E.set_txt = (name, val)=>{
    E.txt[name.toLowerCase()] = val;
    E.domains[name.toLowerCase()] = {txt: val};
};
E.rm_txt = (name, val)=>{
    delete E.txt[name.toLowerCase()];
    delete E.domains[name.toLowerCase()];
};
// XXX: need caching
function res_type_a(name){
  let type = Packet.TYPE.A, c = Packet.CLASS.IN;
  let ret = [];
  let info = get_our_domain(name);
  if (!info || !info.ip)
      return ret;
  let ips = info.ip;
  ips.forEach(ip=>ret.push({name, type, class: c, ttl: E.ttl, address: ip}));
  return ret;
}

function res_type_ns(name){
  let type = Packet.TYPE.NS, c = Packet.CLASS.IN;
  let ret = [];
  let info = get_our_domain(name);
  if (!info || !info.ns)
      return ret;
  info.ns.forEach(ns=>ret.push({name, type, class: c, ttl: E.ttl,
      ns: ns+'.'+name}));
  return ret;
}

function res_type_any(name){
    let ret = res_type_a(name);
    ret = ret.concat(res_type_soa(name));
    let ret_ns = res_type_ns(name);
    ret = ret.concat(ret_ns);
    ret = ret.concat(res_type_mx(name));
    ret = ret.concat(res_type_txt(name));
    return ret;
}

function res_type_txt(name){
  let type = Packet.TYPE.TXT, c = Packet.CLASS.IN;
  let data = E.txt[name.toLowerCase()];
  let ret = [{name, type, class: c, ttl: E.ttl, data:
      'v=spf1 a mx ptr ip4:212.235.66.0/24 ip4:54.243.35.14 '+
      'ip4:35.153.220.251 ip4:172.30.15.32 ip4:54.86.72.44 '+
      'ip4:172.30.13.27 ip4:34.196.25.123 ip4:172.30.0.178 '+
      'ip4:34.192.171.195 include:amazonses.com '+
      'include:_spf.google.com -all'}];
  if (data) // XXX: allow to set ttl per TXT
    ret.push({name, type, class: c, ttl: 5, data});
  return ret;
}

function res_type_mx(name){
  let type = Packet.TYPE.MX, c = Packet.CLASS.IN;
  return [{name, type, class: c, ttl: E.ttl,
      exchange: 'mail5.holaspark.com', priority: 10}];
}

function res_type_soa(name){
  let type = Packet.TYPE.SOA, c = Packet.CLASS.IN;
  let ret = [];
  let info = get_our_domain(name);
  if (!info || !info.ns)
      return ret;
  let ns = info.ns[0]+'.'+name;
  let d = new Date();
  let serial = d.getFullYear()+String(d.getMonth()+1).padStart(2, 0)+
    String(d.getDate()).padStart(2, 0);
  ret = [{name, type, class: c, ttl: E.ttl,
    primary: ns, admin: ns, serial, refresh: 900, retry: 900,
    expiration: 1800, minimum: 60}];
  return ret;
/*
  // http://tools.ietf.org/html/rfc1035#section-3.3.13
  let type = Packet.TYPE.SOA, c = Packet.CLASS.IN;
  let o = E.res_cache[name] = E.res_cache[name]||{};
  if (o[type])
    return o[type];
  let ns = 'ns1.'+name;
  let serial = date.strftime('%Y%m%d00', new Date());
  return o[type] = [{name, type, class: c, ttl: E.ttl,
    primary: ns, admin: ns, serial, refresh: 900, retry: 900,
    expiration: 1800, minimum: 60}];
*/
}

E.set_domains = domains=>{
    console.log('dnss: set domains %s',
        domains ? Object.keys(domains).join(', ') : 'none');
    E.domains = {};
    if (!domains)
        return;
    for (let name in domains){
        let o = domains[name];
        o = E.domains[name] = Object.assign({name}, o);
        if (o.ip && !Array.isArray(o.ip))
            o.ip = [o.ip];
        if (o.ns && !Array.isArray(o.ns))
            o.ns = [o.ns];
        if (o.ns){
            for (let i=0; i<o.ns.length; i++){
                let ns_name = o.ns[i]+'.'+name;
                if (!domains[ns_name])
                  E.domains[ns_name] = {name: ns_name, ip: o.ip};
            }
        }
    }
};

function create_dns_server(ips){
  if (E.servers)
    throw new Error('dnss: already started servers');
  E.servers = [];
  for (let {address, port} of ips){
    port = port||DEF_PORT;
    let server = dns2.createServer({udp: !E.noudp, tcp: !E.notcp,
      handle: (req, send, rinfo)=>{
        try {
          let res = Packet.createResponseFromRequest(req);
          if (req.questions.length!=1){
            res.header.rcode = 0x4; // not implemented
            return send(res);
          }
          let [query] = req.questions, {name, type} = query;
          if (!is_our_domain(name)){
            console.log('dns query SKIP %s', name);
            return send(res);
          }
          // https://tools.ietf.org/html/rfc1035#section-4.1.1
          res.header.aa = 1; // set authoritive answer
          switch (type){
          case Packet.TYPE.A: res.answers = res_type_a(name); break;
          case Packet.TYPE.NS: res.answers = res_type_ns(name); break;
          case Packet.TYPE.SOA: res.answers = res_type_soa(name); break;
          case Packet.TYPE.ANY: res.answers = res_type_any(name); break;
          case Packet.TYPE.TXT: res.answers = res_type_txt(name); break;
          case Packet.TYPE.MX: res.answers = res_type_mx(name); break;
          // XXX TODO
          default: console.error('dnss: unsupported type %s', type);
          }
          send(res);
        } catch(err){ console.error('dnss: error %s', err.stack||err); }
      }
    });
    server.on('close', ()=>console.log('dnss: closed'));
    server.on('error', err=>console.error('dnss: error', err));
    console.log('dnss: listen on %s udp+tcp ports %s', address, port);
    server.listen({udp: {host: address, address, port},
      tcp: {host: address, address, port}});
    E.servers.push(server);
  }
}

E.start = opt=>{
  if (E.servers)
    throw new Error('dnss: already started');
  opt = opt||{};
  let {ips} = opt;
  E.res_cache = {};
  E.txt = {};
  E.ttl = opt.ttl||DEF_TTL;
  E.ttl_refresh = opt.ttl_refresh||DEF_TTL_REFRESH;
  E.ttl_retry = opt.ttl_refresh||DEF_TTL_RETRY;
  E.ttl_expiration = opt.ttl_expiration||DEF_TTL_EXPIRATION;
  E.ttl_minimum = opt.ttl_refresh||DEF_TTL_MINIMUM;
  E.notcp = opt.notcp;
  E.noudp = opt.noudp;
  create_dns_server(ips);
};

E.stop = ()=>{
  if (!E.servers)
      return;
  for (let server of E.servers)
    server.close();
  E.servers = undefined;
};

