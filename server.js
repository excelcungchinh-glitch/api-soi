// Trạm trung chuyển nhỏ: phục vụ giao diện + chuyển tiếp request API thay cho trình duyệt (tránh lỗi CORS).
// Chỉ nghe trên 127.0.0.1 nên máy khác trong mạng không dùng được.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const START_PORT = 5177;
const INDEX = path.join(__dirname, 'index.html');
// Các header do trình duyệt/Node tự quản lý, không chuyển tiếp
const SKIP_HEADERS = new Set(['host', 'content-length', 'connection', 'accept-encoding', 'priority']);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function proxy(req, res) {
  let spec;
  try { spec = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'Dữ liệu gửi lên tool không hợp lệ' }); }

  const headers = {};
  for (const [k, v] of Object.entries(spec.headers || {})) {
    if (!SKIP_HEADERS.has(k.toLowerCase()) && !k.toLowerCase().startsWith('sec-')) headers[k] = v;
  }
  if (spec.referrer && !Object.keys(headers).some(k => k.toLowerCase() === 'referer')) headers['Referer'] = spec.referrer;

  const method = (spec.method || 'GET').toUpperCase();
  const started = Date.now();
  try {
    const r = await fetch(spec.url, {
      method,
      headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : (spec.body ?? undefined),
      redirect: 'follow',
      signal: AbortSignal.timeout(180000),
    });
    const buf = Buffer.from(await r.arrayBuffer());
    sendJson(res, 200, {
      status: r.status,
      statusText: r.statusText,
      headers: Object.fromEntries(r.headers.entries()),
      body: buf.toString('utf8'),
      size: buf.length,
      timeMs: Date.now() - started,
    });
  } catch (e) {
    const cause = e.cause ? ` (${e.cause.code || e.cause.message})` : '';
    sendJson(res, 200, { networkError: (e.name === 'TimeoutError' ? 'Quá 3 phút không có phản hồi' : e.message) + cause, timeMs: Date.now() - started });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/proxy') return proxy(req, res);
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(INDEX).pipe(res);
  }
  if (req.method === 'GET' && req.url.split('?')[0] === '/bridge.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(__dirname, 'bridge.js')).pipe(res);
  }
  res.writeHead(404); res.end();
});

function listen(port) {
  server.once('error', e => {
    // EACCES: Windows giữ chỗ một số dải cổng (Hyper-V/WSL) → thử cổng kế tiếp
    if (['EADDRINUSE', 'EACCES'].includes(e.code) && port < START_PORT + 50) listen(port + 7);
    else { console.error(e); process.exit(1); }
  });
  server.listen(port, '127.0.0.1');
}
server.once('listening', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`\n  API Soi đang chạy: ${url}\n  Đóng cửa sổ này để tắt tool.\n`);
  if (!process.argv.includes('--no-open')) exec(`start "" "${url}"`);
});
listen(START_PORT);
