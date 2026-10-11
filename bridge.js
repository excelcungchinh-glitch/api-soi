// Chạy TRÊN TRANG HỆ THỐNG khi bấm bookmark "📌 API Soi":
//  - mở tool (iframe): toàn màn hình / chia đôi (kéo được vạch chia) / thu nhỏ thành nút nổi
//  - ghi lại các API trang gọi (XHR + fetch) để tool nạp không cần F12
//    → tự gắn lại móc mỗi giây vì thư viện khác (vd PostHog) có thể gỡ/ghi đè
//  - PerformanceObserver đếm mọi API trang gọi (dự phòng + chẩn đoán khi móc không bắt được)
//  - gọi API hộ tool (vì API chỉ cho trang hệ thống gọi — CORS)
//  - tìm token đăng nhập mới nhất trong localStorage/sessionStorage
(() => {
  if (window.__apisoi) { window.__apisoi.style.display = window.__apisoi.style.display === 'none' ? 'block' : 'none'; return; }
  const VERSION = 3, HOOK = '__apisoiHook';
  const me = document.currentScript && document.currentScript.src;
  if (!me) return alert('API Soi: không xác định được địa chỉ tool');
  const toolUrl = new URL('./', me).href, O = new URL(me).origin;
  const LOG = [], SEEN = [], MAX = 300, own = new Map();
  const stat = {version: VERSION, installs: 0, xhr: false, fetch: false};
  let f = null, pill = null, handle = null;
  const post = m => { if (f && f.contentWindow) f.contentWindow.postMessage(m, O); };
  const abs = u => { try { return new URL(u, location.href).href; } catch { return String(u); } };
  const isStatic = u => /\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|map|html?)(\?|$)/i.test(u);
  const isApi = a => !isStatic(a.url) && !/^(OPTIONS|HEAD)$/.test(a.method || 'GET');
  const rec = a => { LOG.push(a); if (LOG.length > MAX) LOG.shift(); post({type: 'cap', item: a}); updatePill(); };

  // ---- móc XHR / fetch (gắn lại được nhiều lần, chỉ lớp ngoài cùng ghi nhận) ----
  function hookXHR() {
    const XP = XMLHttpRequest.prototype;
    if (!XP.open[HOOK]) {
      const orig = XP.open;
      const w = function (m, u) {
        if (!this.__asOpen) this.__as = {method: String(m).toUpperCase(), url: abs(u), headers: {}};
        this.__asOpen = true; try { return orig.apply(this, arguments); } finally { this.__asOpen = false; }
      };
      w[HOOK] = true; XP.open = w; stat.installs++;
    }
    if (!XP.setRequestHeader[HOOK]) {
      const orig = XP.setRequestHeader;
      const w = function (k, v) {
        if (!this.__asSet && this.__as) this.__as.headers[k] = String(v);
        this.__asSet = true; try { return orig.apply(this, arguments); } finally { this.__asSet = false; }
      };
      w[HOOK] = true; XP.setRequestHeader = w; stat.installs++;
    }
    if (!XP.send[HOOK]) {
      const orig = XP.send;
      const w = function (b) {
        const a = this.__as;
        if (!this.__asSend && a && !a.time) {
          a.body = typeof b === 'string' ? b : ''; a.time = Date.now();
          this.addEventListener('loadend', () => { a.status = this.status; a.ms = Date.now() - a.time; rec(a); });
        }
        this.__asSend = true; try { return orig.apply(this, arguments); } finally { this.__asSend = false; }
      };
      w[HOOK] = true; XP.send = w; stat.installs++;
    }
    stat.xhr = !!(XP.open[HOOK] && XP.send[HOOK]);
  }
  let inFetch = false;
  function hookFetch() {
    if (window.fetch[HOOK]) { stat.fetch = true; return; }
    const orig = window.fetch;
    const w = function (input, init) {
      if (inFetch) return orig.apply(this, arguments);
      const req = input instanceof Request ? input : null, o = init || {};
      const a = {method: String(o.method || (req && req.method) || 'GET').toUpperCase(), url: abs(req ? req.url : input), headers: {}, time: Date.now()};
      try { new Headers(o.headers || (req && req.headers) || {}).forEach((v, k) => { a.headers[k] = v; }); } catch {}
      a.body = typeof o.body === 'string' ? o.body : '';
      inFetch = true; let p;
      try { p = orig.apply(this, arguments); } finally { inFetch = false; }
      Promise.resolve(p).then(r => { a.status = r.status; a.ms = Date.now() - a.time; rec(a); }, () => { a.status = 0; a.ms = Date.now() - a.time; rec(a); });
      return p;
    };
    w[HOOK] = true; window.fetch = w; stat.installs++; stat.fetch = true;
  }
  const F0 = window.fetch;   // fetch gốc để tool gọi API (không bị tính là API của trang)
  hookXHR(); hookFetch();
  setInterval(() => { const n = stat.installs; hookXHR(); hookFetch(); if (stat.installs !== n) post({type: 'stat', stat}); }, 1000);

  // ---- dự phòng: Performance API thấy mọi request (chỉ có địa chỉ) ----
  const perfItem = e => ({url: e.name, time: Math.round(performance.timeOrigin + e.startTime), ms: Math.round(e.duration)});
  const perfApi = e => /^(xmlhttprequest|fetch)$/.test(e.initiatorType) && !isStatic(e.name);
  let past = [];
  try { past = performance.getEntriesByType('resource').filter(perfApi).map(perfItem); } catch {}
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (!perfApi(e)) continue;
        const k = own.get(e.name); if (k) { k > 1 ? own.set(e.name, k - 1) : own.delete(e.name); continue; }   // request do tool gọi
        const it = perfItem(e); SEEN.push(it); if (SEEN.length > MAX) SEEN.shift();
        post({type: 'seen', item: it}); updatePill();
      }
    }).observe({type: 'resource'});
  } catch {}

  // ---- tìm token trong bộ nhớ trang (ưu tiên access token còn hạn lâu nhất) ----
  function findToken() {
    let best = null;
    for (const st of [localStorage, sessionStorage]) {
      try {
        for (let i = 0; i < st.length; i++) {
          for (const t of (st.getItem(st.key(i)) || '').match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g) || []) {
            try {
              const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
              const score = (p.exp || 0) + (p.scope || p.client_id ? 1e10 : 0);
              if (!best || score > best.score) best = {t, score};
            } catch {}
          }
        }
      } catch {}
    }
    return best && best.t;
  }

  // ---- giao diện: toàn màn hình / chia đôi / thu nhỏ ----
  const ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch {} };
  let mode = ss('apisoi.mode') || (innerWidth >= 1100 ? 'split' : 'full'), lastShown = mode === 'min' ? 'split' : mode;
  let splitW = +ss('apisoi.w') || Math.round(innerWidth * 0.5);
  const clampW = w => Math.max(380, Math.min(innerWidth - 320, w));

  function updatePill() {
    if (!pill) return;
    const n = LOG.filter(isApi).length, s = SEEN.length;
    pill.innerHTML = `<b>📡 API Soi</b> · đã bắt <b>${n}</b> API${s > n ? ` <span style="opacity:.8">(trang gọi ${s})</span>` : ''}<br><span style="opacity:.85;font-size:11.5px">Bấm vào đây để mở lại tool</span>`;
  }
  pill = document.createElement('div');
  pill.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;display:none;cursor:pointer;padding:10px 16px;border-radius:14px;' +
    'font:13px/1.35 "Segoe UI",system-ui,sans-serif;color:#fff;background:linear-gradient(110deg,#4f46e5,#06b6d4);box-shadow:0 6px 24px rgba(30,40,90,.35)';
  pill.onclick = () => setMode(lastShown);
  document.documentElement.appendChild(pill);

  handle = document.createElement('div');   // vạch chia kéo được
  handle.title = 'Kéo để đổi độ rộng';
  handle.style.cssText = 'position:fixed;top:0;bottom:0;width:10px;cursor:col-resize;z-index:2147483647;display:none;' +
    'background:linear-gradient(90deg,transparent 3px,#4f46e5 3px,#4f46e5 6px,transparent 6px)';
  document.documentElement.appendChild(handle);

  f = document.createElement('iframe');
  f.src = toolUrl + '?bridge=1';
  f.style.cssText = 'position:fixed;top:0;height:100vh;border:0;z-index:2147483646;background:#f3f5fb';
  document.documentElement.appendChild(f);
  window.__apisoi = f;

  let applying = false;
  function apply(fireResize = true) {
    applying = true;
    const html = document.documentElement;
    if (mode === 'split') {
      splitW = clampW(splitW);
      Object.assign(f.style, {display: 'block', left: 'auto', right: '0', width: splitW + 'px', boxShadow: '-6px 0 20px rgba(20,30,60,.18)'});
      html.style.marginRight = splitW + 'px';
      Object.assign(handle.style, {display: 'block', right: (splitW - 6) + 'px'});
    } else {
      Object.assign(f.style, {display: mode === 'min' ? 'none' : 'block', left: '0', right: '0', width: '100vw', boxShadow: 'none'});
      html.style.marginRight = '';
      handle.style.display = 'none';
    }
    pill.style.display = mode === 'min' ? 'block' : 'none';
    updatePill();
    ss('apisoi.mode', mode);
    if (fireResize) dispatchEvent(new Event('resize'));   // để lưới Kendo / bản đồ co giãn theo
    post({type: 'layout', mode});
    setTimeout(() => { applying = false; });
  }
  function setMode(m) { if (m !== 'min') lastShown = m; else if (mode !== 'min') lastShown = mode; mode = m; apply(); }
  // bookmark bấm lần nữa chỉ đổi style.display → đồng bộ lại chế độ
  new MutationObserver(() => {
    if (applying) return;
    const hidden = f.style.display === 'none';
    if (hidden && mode !== 'min') setMode('min');
    else if (!hidden && mode === 'min') setMode(lastShown);
  }).observe(f, {attributes: true, attributeFilter: ['style']});

  handle.addEventListener('mousedown', e => {
    e.preventDefault(); f.style.pointerEvents = 'none';
    const move = ev => { splitW = clampW(innerWidth - ev.clientX); apply(false); };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); f.style.pointerEvents = ''; ss('apisoi.w', splitW); apply(); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  });
  addEventListener('resize', () => { if (mode === 'split' && !applying) { const w = clampW(splitW); if (w !== splitW) { splitW = w; apply(false); } } });
  apply();

  addEventListener('message', async e => {
    if (e.origin !== O || e.source !== f.contentWindow) return;
    const d = e.data || {};
    if (d.type === 'hello') return post({type: 'ready', log: LOG, seen: SEEN, past, capture: true, version: VERSION, stat, mode});
    if (d.type === 'close') return setMode('min');
    if (d.type === 'layout') return setMode(d.mode);
    if (d.type === 'token') return post({type: 'token', id: d.id, token: findToken()});
    if (d.type !== 'req') return;
    const t = Date.now(), url = abs(d.url);
    own.set(url, (own.get(url) || 0) + 1);
    try {
      const r = await F0(d.url, {method: d.method, headers: d.headers, body: d.body || undefined, credentials: 'include'});
      const b = await r.arrayBuffer();
      post({type: 'res', id: d.id, status: r.status, statusText: r.statusText, headers: Object.fromEntries(r.headers), body: new TextDecoder().decode(b), size: b.byteLength, timeMs: Date.now() - t});
    } catch (x) { post({type: 'res', id: d.id, networkError: String(x), timeMs: Date.now() - t}); }
  });
})();
