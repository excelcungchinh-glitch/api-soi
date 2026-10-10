// Chạy TRÊN TRANG HỆ THỐNG khi bấm bookmark "📌 API Soi":
//  - mở tool (iframe) đè lên trang; khi thu nhỏ thì hiện nút nổi đếm số API bắt được
//  - ghi lại các API trang gọi (XHR + fetch) để tool nạp không cần F12
//  - liệt kê API trang đã gọi TRƯỚC khi bấm bookmark (chỉ có địa chỉ, từ Performance API)
//  - gọi API hộ tool (vì API chỉ cho trang hệ thống gọi — CORS)
//  - tìm token đăng nhập mới nhất trong localStorage/sessionStorage
(() => {
  if (window.__apisoi) { window.__apisoi.style.display = window.__apisoi.style.display === 'none' ? 'block' : 'none'; return; }
  const VERSION = 2;
  const me = document.currentScript && document.currentScript.src;
  if (!me) return alert('API Soi: không xác định được địa chỉ tool');
  const toolUrl = new URL('./', me).href, O = new URL(me).origin;
  const LOG = [], MAX = 300;
  let f = null, pill = null, seen = 0;
  const post = m => { if (f && f.contentWindow) f.contentWindow.postMessage(m, O); };
  const abs = u => { try { return new URL(u, location.href).href; } catch { return String(u); } };
  const isStatic = u => /\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|map|html?)(\?|$)/i.test(u);
  const rec = a => {
    delete a.t0; LOG.push(a); if (LOG.length > MAX) LOG.shift(); seen++;
    post({type: 'cap', item: a}); updatePill();
  };

  // ---- bắt XHR ----
  const XP = XMLHttpRequest.prototype, xOpen = XP.open, xSend = XP.send, xSet = XP.setRequestHeader;
  XP.open = function (m, u) { this.__as = {method: String(m).toUpperCase(), url: abs(u), headers: {}}; return xOpen.apply(this, arguments); };
  XP.setRequestHeader = function (k, v) { if (this.__as) this.__as.headers[k] = String(v); return xSet.apply(this, arguments); };
  XP.send = function (b) {
    const a = this.__as;
    if (a) {
      a.body = typeof b === 'string' ? b : ''; a.t0 = Date.now(); a.time = a.t0;
      this.addEventListener('loadend', () => { a.status = this.status; a.ms = Date.now() - a.t0; rec(a); });
    }
    return xSend.apply(this, arguments);
  };
  // ---- bắt fetch ----
  const F0 = window.fetch;
  window.fetch = async function (input, init) {
    const req = input instanceof Request ? input : null, o = init || {};
    const a = {method: String(o.method || (req && req.method) || 'GET').toUpperCase(), url: abs(req ? req.url : input), headers: {}, t0: Date.now()};
    a.time = a.t0;
    try { new Headers(o.headers || (req && req.headers) || {}).forEach((v, k) => { a.headers[k] = v; }); } catch {}
    a.body = typeof o.body === 'string' ? o.body : '';
    try { const r = await F0.apply(this, arguments); a.status = r.status; a.ms = Date.now() - a.t0; rec(a); return r; }
    catch (e) { a.status = 0; a.ms = Date.now() - a.t0; rec(a); throw e; }
  };

  // ---- API đã gọi trước khi bấm bookmark (chỉ biết địa chỉ + thời điểm) ----
  function pastCalls() {
    try {
      const t0 = performance.timeOrigin;
      return performance.getEntriesByType('resource')
        .filter(e => /^(xmlhttprequest|fetch)$/.test(e.initiatorType) && !isStatic(e.name))
        .map(e => ({url: e.name, time: Math.round(t0 + e.startTime), ms: Math.round(e.duration)}));
    } catch { return []; }
  }

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

  // ---- nút nổi khi tool thu nhỏ ----
  function updatePill() {
    if (!pill) return;
    const n = LOG.filter(a => !isStatic(a.url) && !/^(OPTIONS|HEAD)$/.test(a.method)).length;
    pill.innerHTML = `<b>📡 API Soi</b> · đã bắt <b>${n}</b> API<br><span style="opacity:.85;font-size:11.5px">Thao tác trên hệ thống rồi bấm vào đây để mở lại</span>`;
  }
  pill = document.createElement('div');
  pill.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;display:none;cursor:pointer;padding:10px 16px;border-radius:14px;' +
    'font:13px/1.35 "Segoe UI",system-ui,sans-serif;color:#fff;background:linear-gradient(110deg,#4f46e5,#06b6d4);box-shadow:0 6px 24px rgba(30,40,90,.35)';
  pill.onclick = () => window.__apisoiShow(true);
  document.documentElement.appendChild(pill);

  // ---- mở tool ----
  f = document.createElement('iframe');
  f.src = toolUrl + '?bridge=1';
  f.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647;background:#f3f5fb';
  document.documentElement.appendChild(f);
  window.__apisoi = f;
  window.__apisoiShow = show => { f.style.display = show ? 'block' : 'none'; };
  // bookmark bản cũ ẩn/hiện bằng cách đổi thẳng style → theo dõi style để nút nổi luôn khớp
  new MutationObserver(() => {
    const vis = f.style.display !== 'none';
    pill.style.display = vis ? 'none' : 'block';
    updatePill();
    if (vis) post({type: 'shown'});
  }).observe(f, {attributes: true, attributeFilter: ['style']});

  addEventListener('message', async e => {
    if (e.origin !== O || e.source !== f.contentWindow) return;
    const d = e.data || {};
    if (d.type === 'hello') return post({type: 'ready', log: LOG, past: pastCalls(), capture: true, version: VERSION});
    if (d.type === 'close') return window.__apisoiShow(false);
    if (d.type === 'token') return post({type: 'token', id: d.id, token: findToken()});
    if (d.type !== 'req') return;
    const t = Date.now();
    try {
      const r = await F0(d.url, {method: d.method, headers: d.headers, body: d.body || undefined, credentials: 'include'});
      const b = await r.arrayBuffer();
      post({type: 'res', id: d.id, status: r.status, statusText: r.statusText, headers: Object.fromEntries(r.headers), body: new TextDecoder().decode(b), size: b.byteLength, timeMs: Date.now() - t});
    } catch (x) { post({type: 'res', id: d.id, networkError: String(x), timeMs: Date.now() - t}); }
  });
})();
