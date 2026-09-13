// Local preview only: no API, database, secrets, billing or training agents are started.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { LANDING_PAGE_HTML } = require('../tmp/landing-preview/landing-page.js');
const root = path.resolve(__dirname, '../apps/api/public/landing/results');
http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(LANDING_PAGE_HTML);
    }
    if (url.pathname === '/landing-assets/panzeri-run-logo.png') {
      res.setHeader('Content-Type', 'image/png');
      return fs.createReadStream(path.join(root, 'panzeri-run-logo.png')).pipe(res);
    }
    const match = url.pathname.match(
      /^\/landing-assets\/(elton|result-(?:0[1-9]|1[0-9]|2[01]))\.jpeg$/,
    );
    if (!match) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const file = path.join(root, match[1] + '.jpeg');
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.setHeader('Content-Type', 'image/jpeg');
    fs.createReadStream(file).pipe(res);
  })
  .listen(4173, '127.0.0.1', () => console.log('Landing preview: http://127.0.0.1:4173'));
