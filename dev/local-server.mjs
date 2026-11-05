// Runs the whole site on your computer, without a Cloudflare account: the pages in site/,
// the API in server/, and a SQLite file in .data/ standing in for the D1 database.
//
//   node dev/local-server.mjs                then open http://localhost:8788/app/
//   node dev/local-server.mjs --port 9000    use another port
//   node dev/local-server.mjs --fresh        start with an empty database
//
// Needs Node.js 22.13 or newer. ADMIN_NICKS works as it does on Cloudflare, for example
//   ADMIN_NICKS=YourNick node dev/local-server.mjs

import { createServer } from 'node:http';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openD1 } from './d1-local.mjs';
import { handle } from '../server/app.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const args = process.argv.slice(2);
const option = name => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const port = Number(option('--port')) || 8788;
const dbFile = resolve(ROOT, option('--db') || '.data/local.sqlite');
if (args.includes('--fresh')) await rm(dbFile, { force: true });
await mkdir(dirname(dbFile), { recursive: true });
const env = { DB: openD1(dbFile), ADMIN_NICKS: process.env.ADMIN_NICKS || '' };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml'
};

// site/_headers, the file Cloudflare Pages reads: a path pattern, then indented "Name: value" lines.
async function loadHeaderRules() {
  let text = '';
  try { text = await readFile(join(SITE, '_headers'), 'utf8'); } catch (err) { return []; }
  const rules = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const source = line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/:\w+/g, '[^/]+');
      rules.push({ pattern: new RegExp('^' + source + '$'), headers: [] });
    } else if (rules.length) {
      const at = line.indexOf(':');
      if (at > 0) rules[rules.length - 1].headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
    }
  }
  return rules;
}

async function isFile(path) {
  try { return (await stat(path)).isFile(); } catch (err) { return false; }
}
async function isFolder(path) {
  try { return (await stat(path)).isDirectory(); } catch (err) { return false; }
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }
  let path;
  try { path = decodeURIComponent(url.pathname); } catch (err) { path = '/'; }
  const full = normalize(join(SITE, path));
  if (full !== SITE && !full.startsWith(SITE + sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  // A folder without its trailing slash: redirect, as Cloudflare Pages does.
  if (!path.endsWith('/') && await isFolder(full)) {
    res.writeHead(308, { Location: url.pathname + '/' + url.search });
    res.end();
    return;
  }
  const candidates = path.endsWith('/') ? [join(full, 'index.html')] : [full, full + '.html'];
  let file = null;
  for (const c of candidates) if (await isFile(c)) { file = c; break; }
  let status = 200;
  if (!file) {
    file = join(SITE, '404.html');
    status = 404;
  }
  const headers = { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
  for (const rule of await loadHeaderRules()) {
    if (rule.pattern.test(url.pathname)) for (const [name, value] of rule.headers) headers[name] = value;
  }
  const body = await readFile(file);
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

async function serveApi(req, res, url) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || ['host', 'connection', 'content-length', 'transfer-encoding'].includes(name)) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set('CF-Connecting-IP', req.socket.remoteAddress || '127.0.0.1');
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;
  const response = await handle(new Request(url, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined }), env);
  const out = {};
  response.headers.forEach((value, name) => { if (name !== 'set-cookie') out[name] = value; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
  console.log(`${req.method} ${url.pathname}${url.search} ${response.status}`);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost:' + port}`);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) await serveApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Local server error. See the terminal.');
  }
}).listen(port, () => {
  console.log(`iAmUnemployed is running at http://localhost:${port}/ (the app is at /app/)`);
  console.log(`Database file: ${dbFile}`);
});
