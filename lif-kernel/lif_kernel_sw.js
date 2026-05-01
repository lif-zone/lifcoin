/*global importScripts*/
let path_dir = path=>path.match(/(^.*\/)?([^/]*)$/)?.[1]||'';
let u = new URLSearchParams(location.search);
let base = u.get('lif_kernel_base') || path_dir(location.pathname).slice(0, -1);
importScripts(base+'/kernel.js');
