'use strict';

const bweb = require('bweb');
const fs = require('bfile');
const WSProxy = require('./wsproxy');

const index = fs.readFileSync(`${__dirname}/index.html`);

const proxy = new WSProxy({
  // ports: [8333, 18333, 18444, 28333, 28901]
});

let opt = {
  port: Number(process.argv[2]) || 4000,
  sockets: false,
};
const server = bweb.server(opt);

server.use(server.router());

proxy.on('error', (err) => {
  console.error(err.stack);
});

server.on('error', (err) => {
  console.error(err.stack);
});

server.get('/', (req, res) => {
  res.send(200, index, 'html');
});

if (0){
const app = fs.readFileSync(`${__dirname}/src/app.js`);
server.get('/app.js', (req, res) => {
  res.send(200, app, 'js');
});
}

if (0){
const worker = fs.readFileSync(`${__dirname}/worker.js`);
server.get('/worker.js', (req, res) => {
  res.send(200, worker, 'js');
});
}

proxy.attach(server.http);

server.open();

console.log('server proxy started on port '+opt.port)
