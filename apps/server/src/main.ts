// 介绍人服务器：/signal 是频道转发（WebSocket），其余路径放手机网页。
// 启动：PORT=8080 MOBILE_DIR=../../app node --experimental-strip-types src/main.ts

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { createRelay } from './relay.ts';

const PORT = Number(process.env.PORT || 8080);
const MOBILE_DIR = resolve(process.env.MOBILE_DIR || new URL('../../../app', import.meta.url).pathname);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml'
};

const { wss, stats } = createRelay();
const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(stats())); return; }
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p.endsWith('/')) p += 'index.html';
  const f = join(MOBILE_DIR, p);
  const rel = relative(MOBILE_DIR, f);
  if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': p.endsWith('index.html') ? 'no-cache' : 'max-age=31536000, immutable' });
  res.end(readFileSync(f));
});
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url || '/', 'http://x').pathname !== '/signal') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
server.listen(PORT, () => console.log(`互传介绍人服务器：http://localhost:${PORT}  （手机网页目录 ${MOBILE_DIR}）`));
