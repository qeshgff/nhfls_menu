import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isIP } from 'node:net';
import { handleRequest } from './reviews.mjs';
import { openDatabase } from './sqlite.mjs';

const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon', '.webp':'image/webp' };

export function siteOrigin(value) {
  if (!value) throw new Error('APP_ORIGIN is required, for example https://menu.example.com');
  const url = new URL(value);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('APP_ORIGIN must contain only the scheme and public hostname');
  }
  return url.origin;
}

export function createApp({ origin, env, trustProxy = false, fetcher = fetch, staticDirectory = docs }) {
  origin = siteOrigin(origin);
  const root = resolve(staticDirectory);
  return createServer(async (incoming, outgoing) => {
    const plain = (status, message) => {
      outgoing.writeHead(status, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
      outgoing.end(incoming.method === 'HEAD' ? undefined : message);
    };
    try {
      // Use a configured public origin for cookies, CSRF and CAPTCHA checks.
      // Never infer it from untrusted Host / X-Forwarded-Host headers.
      const url = new URL(incoming.url, origin);
      if (url.origin !== origin) return plain(400, 'Invalid request target');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value !== undefined && !['host','cf-connecting-ip'].includes(key)) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        const proxied = incoming.headers['x-real-ip'];
        const address = trustProxy && typeof proxied === 'string' && isIP(proxied) ? proxied : incoming.socket.remoteAddress;
        if (address) headers.set('CF-Connecting-IP', address);
        const hasBody = !['GET','HEAD'].includes(incoming.method);
        let payload;
        if (hasBody) {
          const chunks = []; let length = 0;
          // Drain rather than destroy an oversized incoming stream so a 413 can
          // still be sent over the same socket, including chunked uploads.
          for await (const chunk of incoming.iterator({ destroyOnReturn:false })) {
            length += chunk.length;
            if (length > 12000) { incoming.resume(); return plain(413, '提交内容过长。'); }
            chunks.push(chunk);
          }
          payload = Buffer.concat(chunks);
        }
        const request = new Request(url, { method:incoming.method, headers, ...(hasBody ? { body:payload } : {}) });
        const response = await handleRequest(request, env, fetcher);
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        if (incoming.method === 'HEAD' || !response.body) outgoing.end();
        else await pipeline(Readable.fromWeb(response.body), outgoing);
        return;
      }
      if (!['GET','HEAD'].includes(incoming.method)) return plain(405, 'Method not allowed');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return plain(400, 'Invalid path'); }
      if (pathname === '/') pathname = '/index.html';
      if (pathname.split(/[\\/]/).some(part => part.startsWith('.') || part.startsWith('_')) || pathname.includes('\0')) return plain(404, 'Not found');
      const filename = resolve(root, '.' + pathname);
      if (!filename.startsWith(root + sep) || !types[extname(filename)]) return plain(404, 'Not found');
      const actual = await realpath(filename);
      if (!actual.startsWith(root + sep)) return plain(404, 'Not found');
      const info = await stat(actual);
      if (!info.isFile()) return plain(404, 'Not found');
      outgoing.writeHead(200, { 'Content-Type':types[extname(filename)], 'Content-Length':info.size, 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'strict-origin-when-cross-origin' });
      if (incoming.method === 'HEAD') outgoing.end();
      else await pipeline(createReadStream(actual), outgoing);
    } catch (error) {
      if (outgoing.headersSent) { outgoing.destroy(); return; }
      plain(['ENOENT','ENOTDIR'].includes(error.code) ? 404 : 500, ['ENOENT','ENOTDIR'].includes(error.code) ? 'Not found' : 'Service unavailable');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const origin = siteOrigin(process.env.APP_ORIGIN);
  const database = openDatabase(process.env.DATABASE_PATH || './data/reviews.sqlite');
  const server = createApp({ origin, env:{ ...process.env, DB:database }, trustProxy:process.env.TRUST_PROXY === '1' });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.maxHeadersCount = 100;
  server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => console.log(`NHFLS menu ready; public origin=${origin}`));
  for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => {
    server.close(() => { database.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
