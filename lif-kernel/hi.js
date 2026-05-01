// LICENSE_CODE JPL hi world!
import {OE, html_elm, str, qs_append} from './util.js';
import lif from './boot.js';

let webapp_index = {
  '': '*demo_index', // special handling for built-in demo_index
  'basic': 'git:github/xderry/lif-os@main/lif-basic//main.tsx',
  'basic-npm': 'npm:lif-basic@1.3.0/main.tsx',
  'basic-local': '/lif-basic//main.tsx',
  'play': 'git:github/xderry/lif-os@main/lif-basic//play.html',
  'play-npm': 'npm:lif-basic@1.3.0/play.html',
  'play-local': '/lif-basic//play.html',
  'play2': 'git:github/xderry/lif-os@main/lif-basic//play2.tsx',
  'play2-npm': 'npm:lif-basic@1.3.0/play2.tsx',
  'play2-local': '/lif-basic//play2.tsx',
  'play3': 'git:github/xderry/lif-os@main/lif-basic//play3.js',
  'play3-npm': 'npm:lif-basic@1.3.0/play3.js',
  'play3-local': '/lif-basic//play3.js',
  'play4': 'git:github/xderry/lif-os@main/lif-basic//play4.html',
  'play4-npm': 'npm:lif-basic@1.3.0/play4.html',
  'play4-local': '/lif-basic//play4.html',
  'os': 'git:github/xderry/lif-os@main/lif-os-boot/main.tsx',
  'os-local': '/lif-os//lif-os-boot/main.tsx',
  'lif-coin': 'git:github/xderry/lif-coin@latest',
  'lif-coin-local': '/lif-coin/',
};

let root_dns = ['localhost', 'pub.site', 'lif.zone'];
let lifcoin_url = ['http://localhost:8432'];

function demo_index(){
  let body = document.querySelector('body');
  for (let [k, v] of OE(webapp_index)){
    let p = html_elm('p');
    let e = html_elm('a', {href: '/?'+v});
    e.innerText = k;
    p.appendChild(e);
    body.appendChild(p);
  }
}

function html_elm_frag(html){
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.children; // returns HTMLCollection
}

function page_domain_not_found(sub){
  let body = document.querySelector('body');
  let domain = location.hostname;
  let domain_rest = domain.slice(sub.length);
  let host_rest = location.host.slice(sub.length);
  let pre = location.protocol+'//';
  let wallet = pre+'wallet'+host_rest;
  const e = html_elm_frag(`
    <h1>Domain <a href="${location.host}"><b>${sub}</b>${domain_rest}</a> 404 not found</h1>
    <h2>
      No one registered <b>${sub}</b>${domain_rest} domain yet.
      You may register it with LIF for free.
    </h2>
    <div>
      <a href="${wallet}"
        style="display: inline-block; padding: 14px 28px; background-color: #0066ff; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: all 0.2s ease;" >
        Make <b>${sub}</b>${domain_rest} your own
      </a> - In 5 minute, for free!
    </div>
  `);
  for (let c; c = e[0];)
    body.appendChild(c);
}

function page_not_found(){
  let body = document.querySelector('body');
  let uri = location.pathname+location.search;
  const e = html_elm_frag(`
    <h1>Page ${uri} 404 page not found</h1>
    <a href=/
      style="display: inline-block; padding: 14px 28px; background-color: #0066ff; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: all 0.2s ease;">
      Return home
    </a>
  `);
  for (let c of e)
    body.appendChild(c);
}

async function lif_kv_get(key){
  let url = qs_append(lifcoin_url[0]+'/lif_kv', {key});
  let res = await fetch(url);
  if (res.status!=200)
    return void console.error('failed lif kv: '+res.status);
  let kv = await res.json();
  if (!kv)
    return void console.error('failed invalid lif kv');
  if (kv.not_found)
    return;
  if (!kv.val)
    return void console.error('failed invalid lif kv');
  return kv.val;
}

function sub_dns(){
  let hostname = location.hostname;
  let v;
  let r = root_dns.map(v=>'.'+v);
  if (!(v = str.ends(hostname, r)))
    return;
  return v.rest;
}

function webapp_default(){
  let q = new URLSearchParams(location.search);
  let e = [...q.entries()][0];
  let webapp, v;
  if (e && e[0] && !e[1])
    webapp = e[0];
  if (v=q.get('webapp'))
    webapp = v;
  if (v=webapp_index[webapp||''])
    webapp = v;
  if (webapp)
    return webapp;
}

async function webapp_resolve(){
  let v, sub;
  if (sub = sub_dns()){
    let name = sub;
    let val = await lif_kv_get('dns/'+name);
    if (val && val.site)
      return {site: val.site};
    if (v = webapp_index[name])
      return {site: v};
    return {page: ()=>page_domain_not_found(sub)};
  }
  if (v = webapp_default())
    return {site: v};
  return {page: ()=>page_not_found()};
}

async function life(){
  let w = await webapp_resolve();
  if (w.site=='*demo_index')
    w.page = ()=>demo_index();
  if (w.page)
    return await w.page();
  return await lif.boot.boot_app({lif: {webapp: w.site}});
}

await life();

export default life;
