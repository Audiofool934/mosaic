import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.md': 'text/plain; charset=utf-8' };
const PUBLIC_DIRS = new Set(['engine', 'examples', 'site', 'dist']);
const PRIVATE_FILES = new Set(['agents.md', 'claude.md', 'user.md', 'current.md', 'opinions.md', 'voice.md', 'package.json', 'package-lock.json', 'credentials.json', 'secrets.json']);
const PUBLIC_ROOT = new Set(['README.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']);
const within = (root, file) => file === root || file.startsWith(root + path.sep);

function reply(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(message);
}

/** Only project assets and the renderer's public directories are reachable. */
export async function createHandler({ root = ROOT, projectFile, intercept } = {}) {
  const rootPath = await realpath(root);
  const projectPath = projectFile ? await realpath(path.dirname(path.resolve(projectFile))) : null;
  return async function handler(req, res) {
    try {
      if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) { reply(res, 403, 'Use the loopback preview URL.'); return; }
      // Local previews never need a cross-origin request. This also protects the
      // optional capture upload from another website targeting localhost.
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) { reply(res, 403, 'Cross-origin requests are not allowed.'); return; }
      if (intercept && await intercept(req, res)) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') { reply(res, 405, 'Only GET and HEAD are available.'); return; }
      let requestPath;
      try { requestPath = decodeURIComponent((req.url || '/').split('?')[0]); }
      catch { reply(res, 400, 'Malformed path.'); return; }
      if (!requestPath.startsWith('/') || requestPath.includes('\\') || requestPath.includes('\0')) { reply(res, 400, 'Malformed path.'); return; }
      const parts = requestPath.split('/').filter(Boolean);
      if (parts.some(p => p.startsWith('.') || p.toLowerCase() === 'node_modules' || PRIVATE_FILES.has(p.toLowerCase()))) { reply(res, 403, 'This file is private.'); return; }
      let mount = rootPath;
      if (parts[0] === 'project') {
        if (!projectPath) { reply(res, 404, 'No project is mounted.'); return; }
        mount = projectPath;
        parts.shift();
        if (!parts.length) parts.push('index.html');
      } else {
        if (!parts.length) parts.push('site', 'index.html');
        if (parts.length === 1 && PUBLIC_DIRS.has(parts[0])) parts.push('index.html');
        if (!PUBLIC_DIRS.has(parts[0]) && !(parts.length === 1 && PUBLIC_ROOT.has(parts[0]))) { reply(res, 403, 'This file is private.'); return; }
      }
      const ext = path.extname(parts.at(-1)).toLowerCase();
      if (!TYPES[ext] && !PUBLIC_ROOT.has(parts.at(-1))) { reply(res, 403, 'This file type is not served.'); return; }
      let file;
      try { file = await realpath(path.join(mount, ...parts)); }
      catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') { reply(res, 404, 'Not found.'); return; } throw error; }
      if (!within(mount, file)) { reply(res, 403, 'A symlink cannot leave its project.'); return; }
      // A public link cannot expose a hidden file elsewhere within the same mount.
      const realParts = path.relative(mount, file).split(path.sep);
      if (realParts.some(p => p.startsWith('.') || p.toLowerCase() === 'node_modules' || PRIVATE_FILES.has(p.toLowerCase()))) { reply(res, 403, 'This file is private.'); return; }
      if (mount === rootPath && !PUBLIC_DIRS.has(realParts[0]) && !(realParts.length === 1 && PUBLIC_ROOT.has(realParts[0]))) { reply(res, 403, 'This file is private.'); return; }
      const info = await stat(file);
      if (!info.isFile()) { reply(res, 404, 'Not a file.'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[ext] || 'text/plain; charset=utf-8', 'Content-Length': info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(file);
      stream.on('error', error => res.destroy(error));
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (res.headersSent) res.destroy(error);
      else reply(res, 500, 'Unable to read this project file.');
    }
  };
}

export async function startServer(options = {}) {
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('port must be an integer from 0 to 65535.');
  const handler = await createHandler(options);
  const server = http.createServer(handler);
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  let closed = false;
  return {
    server, url: `http://127.0.0.1:${server.address().port}`,
    projectURL: options.projectFile ? `/project/${encodeURIComponent(path.basename(options.projectFile))}` : '/examples/nocturne.json',
    async close() {
      if (closed) return;
      closed = true;
      const done = new Promise(resolve => server.close(resolve));
      for (const socket of sockets) socket.destroy();
      await done;
    }
  };
}
