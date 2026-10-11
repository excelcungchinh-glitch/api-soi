// Chạy TRÊN TRANG HỆ THỐNG khi bấm bookmark "📌 API Soi".
// Chia đôi màn hình bằng 2 khung: TRÁI = chính trang hệ thống (mở lại trong khung riêng nên tự co đúng),
// PHẢI = tool. Vạch giữa kéo được. Trang gốc nằm ẩn bên dưới, bấm "Thoát" là trở lại như cũ.
// Tool nhờ trang này gọi API (vì API chỉ cho trang hệ thống gọi — CORS) và đọc token đăng nhập.
(() => {
  if (window.__apisoi) { window.__apisoi.style.display = window.__apisoi.style.display === 'none' ? 'block' : 'none'; return; }
  const VERSION = 4;
  const me = document.currentScript && document.currentScript.src;
  if (!me) return alert('API Soi: không xác định được địa chỉ tool');
  const toolUrl = new URL('./', me).href, O = new URL(me).origin;
  const Z = 2147483646;
  const ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch {} };
  const clampW = w => Math.max(360, Math.min(innerWidth - 360, w));
  let mode = ss('apisoi.mode') || 'split';
  if (mode === 'min' || innerWidth < 900) mode = innerWidth < 900 ? 'full' : 'split';
  let lastShown = mode, splitW = clampW(+ss('apisoi.w') || Math.round(innerWidth * 0.45));

  // ---- khung ----
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed;inset:0;z-index:${Z};display:flex;background:#f3f5fb`;
  const left = document.createElement('iframe');            // hệ thống
  left.src = location.href;
  left.style.cssText = 'border:0;height:100%;flex:1 1 auto;min-width:0;background:#fff';
  const bar = document.createElement('div');                // vạch chia
  bar.title = 'Kéo để đổi độ rộng';
  bar.style.cssText = 'flex:0 0 8px;cursor:col-resize;background:linear-gradient(180deg,#4f46e5,#06b6d4);position:relative';
  bar.innerHTML = '<div style="position:absolute;top:50%;left:1px;width:6px;height:40px;margin-top:-20px;border-radius:3px;background:rgba(255,255,255,.7)"></div>';
  const tool = document.createElement('iframe');            // tool
  tool.src = toolUrl + '?bridge=1';
  tool.style.cssText = 'border:0;height:100%;flex:0 0 auto;background:#f3f5fb';
  const tab = document.createElement('div');                // thẻ mở lại khi ẩn tool
  tab.textContent = '◀ API Soi';
  tab.title = 'Mở lại tool API Soi';
  tab.style.cssText = `position:fixed;right:0;top:45%;z-index:${Z + 1};display:none;cursor:pointer;padding:10px 8px;writing-mode:vertical-rl;` +
    'font:600 13px "Segoe UI",system-ui,sans-serif;color:#fff;background:linear-gradient(180deg,#4f46e5,#06b6d4);border-radius:10px 0 0 10px;box-shadow:-2px 2px 12px rgba(0,0,0,.25)';
  wrap.append(left, bar, tool);
  document.documentElement.append(wrap, tab);
  const oldOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  window.__apisoi = tool;

  const post = m => { if (tool.contentWindow) tool.contentWindow.postMessage(m, O); };
  let applying = false;
  function apply() {
    applying = true;
    if (mode === 'split') {
      splitW = clampW(splitW);
      left.style.display = 'block'; bar.style.display = 'block';
      Object.assign(tool.style, {display: 'block', flex: '0 0 auto', width: splitW + 'px'});
    } else if (mode === 'full') {
      left.style.display = 'none'; bar.style.display = 'none';
      Object.assign(tool.style, {display: 'block', flex: '1 1 auto', width: 'auto'});
    } else {   // min: hệ thống chiếm hết, tool ẩn
      left.style.display = 'block'; bar.style.display = 'none';
      tool.style.display = 'none';
    }
    tab.style.display = mode === 'min' ? 'block' : 'none';
    ss('apisoi.mode', mode);
    post({type: 'layout', mode});
    setTimeout(() => { applying = false; });
  }
  function setMode(m) { if (m !== 'min') lastShown = m; mode = m; apply(); }
  tab.onclick = () => setMode(lastShown);
  // bấm bookmark lần nữa (đổi style.display của tool) → ẩn / hiện tool
  new MutationObserver(() => {
    if (applying) return;
    const hidden = tool.style.display === 'none';
    if (hidden && mode !== 'min') setMode('min');
    else if (!hidden && mode === 'min') setMode(lastShown);
  }).observe(tool, {attributes: true, attributeFilter: ['style']});

  // kéo vạch chia
  bar.addEventListener('mousedown', e => {
    e.preventDefault();
    left.style.pointerEvents = tool.style.pointerEvents = 'none';   // iframe nuốt chuột khi kéo qua
    const move = ev => { splitW = clampW(innerWidth - ev.clientX - 4); tool.style.width = splitW + 'px'; };
    const up = () => {
      removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      left.style.pointerEvents = tool.style.pointerEvents = '';
      ss('apisoi.w', splitW);
    };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  });
  bar.addEventListener('dblclick', () => { splitW = Math.round(innerWidth * 0.45); ss('apisoi.w', splitW); apply(); });
  addEventListener('resize', () => { if (mode === 'split') { splitW = clampW(splitW); tool.style.width = splitW + 'px'; } });

  function exit() {
    wrap.remove(); tab.remove();
    document.documentElement.style.overflow = oldOverflow;
    removeEventListener('message', onMsg);
    delete window.__apisoi;
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

  async function onMsg(e) {
    if (e.origin !== O || e.source !== tool.contentWindow) return;
    const d = e.data || {};
    if (d.type === 'hello') return post({type: 'ready', version: VERSION, mode});
    if (d.type === 'close') return setMode('min');
    if (d.type === 'layout') return setMode(d.mode);
    if (d.type === 'exit') return exit();
    if (d.type === 'token') return post({type: 'token', id: d.id, token: findToken()});
    if (d.type !== 'req') return;
    const t = Date.now();
    try {
      const r = await fetch(d.url, {method: d.method, headers: d.headers, body: d.body || undefined, credentials: 'include'});
      const b = await r.arrayBuffer();
      post({type: 'res', id: d.id, status: r.status, statusText: r.statusText, headers: Object.fromEntries(r.headers), body: new TextDecoder().decode(b), size: b.byteLength, timeMs: Date.now() - t});
    } catch (x) { post({type: 'res', id: d.id, networkError: String(x), timeMs: Date.now() - t}); }
  }
  addEventListener('message', onMsg);
  apply();
})();
