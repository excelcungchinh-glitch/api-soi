// Fitfood · Gom đơn hàng — chạy TRÊN trang fitfood.vn/admin (bấm bookmark)
// Tải trang danh sách đơn theo từng tuần + lật hết các trang, tách thành 3 bảng:
//   Đơn hàng · Chi tiết gói · Suất ăn theo ngày → xem, thống kê, xuất Excel.
(() => {
  if (window.__ffTool) { window.__ffTool.toggle(); return; }
  const onListing = !!document.querySelector('#table-listing') || /\/admin\//.test(location.pathname);
  if (!/fitfood/i.test(location.host) && !onListing && !confirm('Trang này không phải fitfood.vn/admin. Vẫn mở tool?')) return;

  const LIST_URL = location.origin + '/admin/order/listing';
  const CONCURRENCY = 3, MAX_WEEKS = 26, SHOW_ROWS = 2000;

  /* ---------- tiện ích ---------- */
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dmy = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const parseYmd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
  const monday = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const txt = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  const money = s => { const d = String(s || '').replace(/[^\d-]/g, ''); return d ? Number(d) : null; };
  const fmtNum = n => Number(n || 0).toLocaleString('vi-VN');
  const lines = cell => { if (!cell) return []; const c = cell.cloneNode(true); c.querySelectorAll('br').forEach(b => b.replaceWith('\n')); return c.textContent.split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean); };
  // ngày dạng dd/mm (không có năm) → Date, lấy năm gần với tuần đang tải nhất
  const ddmmToDate = (dd, mm, ref) => {
    let best = null;
    for (const y of [ref.getFullYear() - 1, ref.getFullYear(), ref.getFullYear() + 1]) {
      const d = new Date(y, mm - 1, dd);
      if (!best || Math.abs(d - ref) < Math.abs(best - ref)) best = d;
    }
    return best;
  };
  const DAY = {'thứ 2': 0, 'thứ 3': 1, 'thứ 4': 2, 'thứ 5': 3, 'thứ 6': 4, 'thứ 7': 5, 'chủ nhật': 6, 'cn': 6};

  /* ---------- tải + đọc 1 trang ---------- */
  async function getPage(week, page, extra) {
    const u = new URL(LIST_URL);
    for (const [k, v] of extra) u.searchParams.append(k, v);
    u.searchParams.set('week', week); u.searchParams.set('is_reload', '1');
    if (page > 1) u.searchParams.set('page', page);
    const r = await fetch(u, {credentials: 'include'});
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const tbl = doc.querySelector('#table-listing');
    if (!tbl) {
      if (/login/i.test(r.url) || doc.querySelector('input[type=password]')) throw new Error('LOGIN');
      throw new Error(`Trang không có bảng đơn (HTTP ${r.status})`);
    }
    // số trang: lấy số lớn nhất trong phân trang, và từ dòng "Total: 15/92"
    let pages = 1;
    doc.querySelectorAll('.pagination a, .pagination span').forEach(a => {
      const m = /[?&]page=(\d+)/.exec(a.getAttribute('href') || ''); if (m) pages = Math.max(pages, +m[1]);
      const n = parseInt(txt(a), 10); if (n > 0) pages = Math.max(pages, n);
    });
    const tot = /Total:\s*(\d+)\s*\/\s*(\d+)/i.exec(txt(doc.querySelector('.page-text')));
    const perPage = tbl.querySelectorAll('tbody > tr.order').length;
    if (tot && perPage) pages = Math.max(pages, Math.ceil(+tot[2] / Math.max(perPage, +tot[1] || perPage)));
    return {tbl, pages, total: tot ? +tot[2] : null};
  }

  function parseTable(tbl, week) {
    const heads = [...tbl.querySelectorAll('thead th')].map(th => txt(th).toLowerCase());
    const ix = n => heads.indexOf(n);
    const I = {id: ix('id'), num: ix('number'), name: ix('customer name'), phone: ix('phone'), addr: ix('ship address'), time: ix('ship time'),
      ward: ix('ship ward'), pay: ix('payment'), paySt: ix('payment status'), note: ix('note'), yes: ix('yes change'), guest: ix('guest'), total: ix('total bill')};
    const wk = parseYmd(week), wkLabel = dmy(wk);
    const orders = [], items = [], meals = [];
    for (const tr of tbl.querySelectorAll('tbody > tr')) {
      const td = [...tr.children], c = i => (i >= 0 ? td[i] : null);
      if (tr.classList.contains('order')) {
        const st = txt(c(I.time)), m = /^\[(\d{1,2})\/(\d{1,2})\]\s*(.*)$/.exec(st);
        const notes = [...(c(I.note) ? c(I.note).querySelectorAll('p') : [])].map(txt);
        const nv = k => { const n = notes.find(x => x.toLowerCase().startsWith(k)); return n ? n.replace(/^[^:]*:\s*/, '') : ''; };
        orders.push({
          'Tuần': wkLabel, 'ID': tr.dataset.id || txt(c(I.id)), 'Mã đơn': txt(c(I.num)), 'Khách hàng': txt(c(I.name)), 'SĐT': txt(c(I.phone)),
          'Địa chỉ': txt(c(I.addr)), 'Ngày giao': m ? dmy(ddmmToDate(+m[1], +m[2], wk)) : '', 'Khung giờ': m ? m[3] : st, 'Phường': txt(c(I.ward)),
          'Thanh toán': txt(c(I.pay)), 'Trạng thái TT': txt(c(I.paySt)), 'Ghi chú gói': nv('package'), 'Ghi chú ship': nv('ship'),
          'YES Change': txt(c(I.yes)), 'Guest': txt(c(I.guest)), 'Tổng tiền': money(txt(c(I.total)))
        });
      } else if (tr.classList.contains('order-detail')) {
        const id = (/order-detail-(\d+)/.exec(tr.className) || [])[1] || '';
        const goi = txt(c(I.pay)), lich = lines(c(I.paySt));
        const base = {'Tuần': wkLabel, 'ID đơn': id, 'Mã đơn': txt(c(I.num)), 'Khách hàng': txt(c(I.name)), 'SĐT': txt(c(I.phone)), 'Gói': goi};
        const isFee = !lich.length && /fee|discount|ship|giảm|phí/i.test(goi);
        items.push({...base, 'Loại': isFee ? 'Phí / giảm giá' : 'Gói ăn', 'Lịch ăn': lich.filter(l => !/^-+$/.test(l)).join(' | '), 'Giá': money(txt(c(I.total)))});
        // lịch: "W19/10" mở 1 tuần ăn; "Thứ 2: Trưa Tối" = các bữa trong ngày
        let wkStart = null, wkName = '';
        for (const l of lich) {
          const w = /^W(\d{1,2})\/(\d{1,2})$/i.exec(l);
          if (w) { wkStart = ddmmToDate(+w[1], +w[2], wk); wkName = l; continue; }
          const d = /^([^:]+):\s*(.*)$/.exec(l);
          if (!d || !wkStart) continue;
          const off = DAY[d[1].trim().toLowerCase()]; if (off === undefined) continue;
          const day = new Date(wkStart); day.setDate(day.getDate() + off);
          for (const bua of d[2].split(/[\s,]+/).filter(Boolean))
            meals.push({...base, 'Tuần ăn': wkName, 'Ngày ăn': dmy(day), 'Thứ': d[1].trim(), 'Bữa': bua, _ngay: +day});
        }
      }
    }
    return {orders, items, meals};
  }

  /* ---------- dữ liệu ---------- */
  let RAW = {orders: [], items: [], meals: []}, DATA = RAW, stopFlag = false, running = false;
  function dedupe() {
    if (!ui.dedup.checked) { DATA = RAW; return; }
    const uniq = (arr, key) => { const s = new Set(); return arr.filter(r => { const k = key(r); if (s.has(k)) return false; s.add(k); return true; }); };
    DATA = {
      orders: uniq(RAW.orders, r => r['ID']),
      items: uniq(RAW.items, r => r['ID đơn'] + '|' + r['Gói'] + '|' + r['Lịch ăn'] + '|' + r['Giá']),
      meals: uniq(RAW.meals, r => r['ID đơn'] + '|' + r['Gói'] + '|' + r['Ngày ăn'] + '|' + r['Bữa'])
    };
  }

  async function run() {
    if (running) return;
    const a = parseYmd(ui.from.value), b = parseYmd(ui.to.value);
    if (!a || !b) return alert('Chọn tuần bắt đầu và kết thúc');
    const weeks = [];
    for (let d = monday(a < b ? a : b); d <= monday(a < b ? b : a); d.setDate(d.getDate() + 7)) weeks.push(ymd(d));
    if (weeks.length > MAX_WEEKS) return alert(`Tối đa ${MAX_WEEKS} tuần mỗi lần`);
    const extra = [];
    if (ui.keep.checked) for (const [k, v] of new URLSearchParams(location.search)) if (!['week', 'page', 'is_reload'].includes(k)) extra.push([k, v]);
    running = true; stopFlag = false; ui.go.disabled = true; ui.stop.classList.remove('hide');
    RAW = {orders: [], items: [], meals: []};
    const log = [];
    try {
      for (let wi = 0; wi < weeks.length && !stopFlag; wi++) {
        const w = weeks[wi], label = dmy(parseYmd(w));
        progress(wi, weeks.length, `Tuần ${label}: trang 1…`);
        const first = await getPage(w, 1, extra);
        const parts = [parseTable(first.tbl, w)];
        let done = 1;
        const rest = []; for (let p = 2; p <= first.pages; p++) rest.push(p);
        while (rest.length && !stopFlag) {
          const batch = rest.splice(0, CONCURRENCY);
          const res = await Promise.all(batch.map(p => getPage(w, p, extra)));
          res.forEach(r => parts.push(parseTable(r.tbl, w)));
          done += batch.length;
          progress(wi + done / first.pages, weeks.length, `Tuần ${label}: trang ${done}/${first.pages}`);
        }
        const n = parts.reduce((s, p) => s + p.orders.length, 0);
        for (const p of parts) { RAW.orders.push(...p.orders); RAW.items.push(...p.items); RAW.meals.push(...p.meals); }
        log.push(`${label}: ${n} đơn${first.total != null && first.total !== n ? ` (trang báo ${first.total})` : ''}`);
      }
      progress(1, 1, (stopFlag ? '⏹ Đã dừng. ' : '✅ Xong. ') + log.join(' · '));
    } catch (e) {
      progress(0, 1, e.message === 'LOGIN' ? '❌ Phiên đăng nhập fitfood đã hết — đăng nhập lại rồi bấm tải lại.' : '❌ Lỗi: ' + e.message, true);
    }
    running = false; ui.go.disabled = false; ui.stop.classList.add('hide');
    dedupe(); render();
  }
  function progress(x, total, msg, bad) {
    ui.bar.style.width = Math.min(100, x / total * 100) + '%';
    ui.msg.textContent = msg; ui.msg.className = 'msg' + (bad ? ' bad' : '');
  }

  /* ---------- bảng ---------- */
  const VIEWS = {
    orders: {label: '🧾 Đơn hàng', cols: ['Tuần', 'ID', 'Mã đơn', 'Khách hàng', 'SĐT', 'Địa chỉ', 'Ngày giao', 'Khung giờ', 'Phường', 'Thanh toán', 'Trạng thái TT', 'Ghi chú gói', 'Ghi chú ship', 'YES Change', 'Guest', 'Tổng tiền']},
    items: {label: '📦 Chi tiết gói', cols: ['Tuần', 'ID đơn', 'Mã đơn', 'Khách hàng', 'SĐT', 'Loại', 'Gói', 'Lịch ăn', 'Giá']},
    meals: {label: '🍱 Suất ăn theo ngày', cols: ['Tuần', 'ID đơn', 'Mã đơn', 'Khách hàng', 'SĐT', 'Gói', 'Tuần ăn', 'Ngày ăn', 'Thứ', 'Bữa']},
    stats: {label: '📊 Thống kê'}
  };
  let view = 'orders', q = '', sort = {col: null, dir: 1};
  const cmp = (a, b) => {
    if (a == null || a === '') return b == null || b === '' ? 0 : 1;
    if (b == null || b === '') return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const da = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(a), db = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(b);
    if (da && db) return (da[3] + da[2] + da[1]).localeCompare(db[3] + db[2] + db[1]);
    return String(a).localeCompare(String(b), 'vi', {numeric: true, sensitivity: 'base'});
  };
  function rowsOf(v) {
    let rows = DATA[v];
    if (q) { const s = q.toLowerCase(); rows = rows.filter(r => VIEWS[v].cols.some(c => String(r[c] ?? '').toLowerCase().includes(s))); }
    if (sort.col) rows = [...rows].sort((x, y) => cmp(x[sort.col], y[sort.col]) * sort.dir);
    return rows;
  }
  function tableHtml(cols, rows) {
    return `<div class="scroll"><table><thead><tr><th>#</th>${cols.map(c => `<th data-sort="${esc(c)}" class="${sort.col === c ? 'sorted' : ''}">${esc(c)}${sort.col === c ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0, SHOW_ROWS).map((r, i) => `<tr><td class="muted">${i + 1}</td>${cols.map(c => { const v = r[c]; return `<td class="${typeof v === 'number' ? 'num' : ''}" title="${esc(v)}">${esc(typeof v === 'number' ? fmtNum(v) : v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
      ${rows.length > SHOW_ROWS ? `<div class="muted">Hiển thị ${SHOW_ROWS} dòng đầu — xuất Excel để có đủ ${fmtNum(rows.length)} dòng.</div>` : ''}`;
  }

  /* ---------- thống kê ---------- */
  let gOrders = 'Ngày giao', gMealPkg = '';
  function groupTable(rows, key, sumKey, title) {
    const g = new Map();
    for (const r of rows) { const k = r[key] ?? ''; const o = g.get(k) || {n: 0, s: 0}; o.n++; if (sumKey) o.s += r[sumKey] || 0; g.set(k, o); }
    let arr = [...g.entries()];
    arr.sort((a, b) => /Ngày|Tuần/.test(key) ? cmp(a[0], b[0]) : b[1].n - a[1].n);
    const max = Math.max(1, ...arr.map(x => x[1].n)), tot = rows.length;
    return `<table class="stat"><thead><tr><th>${esc(title || key)}</th><th class="num">Số lượng</th><th style="width:28%">Tỉ lệ</th><th class="num">%</th>${sumKey ? `<th class="num">${/^Tổng/.test(sumKey) ? esc(sumKey) : 'Tổng ' + esc(sumKey)}</th>` : ''}</tr></thead><tbody>
      ${arr.map(([k, o]) => `<tr><td>${k === '' ? '<span class="muted">(trống)</span>' : esc(k)}</td><td class="num">${fmtNum(o.n)}</td>
        <td><div class="bar" title="${esc(k)}: ${fmtNum(o.n)}"><span style="width:${Math.max(o.n / max * 100, 0.5)}%"></span></div></td>
        <td class="num">${(o.n / tot * 100).toFixed(1)}%</td>${sumKey ? `<td class="num">${fmtNum(o.s)}</td>` : ''}</tr>`).join('')}
      <tr class="totalrow"><td>Tổng</td><td class="num">${fmtNum(tot)}</td><td></td><td class="num">100%</td>${sumKey ? `<td class="num">${fmtNum(arr.reduce((s, x) => s + x[1].s, 0))}</td>` : ''}</tr></tbody></table>`;
  }
  function mealPivot(rows) {
    const buas = [...new Set(rows.map(r => r['Bữa']))];
    const order = ['Sáng', 'Trưa', 'Chiều', 'Tối']; buas.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    const days = new Map();
    for (const r of rows) { const d = days.get(r['Ngày ăn']) || {t: r._ngay, thu: r['Thứ'], c: {}}; d.c[r['Bữa']] = (d.c[r['Bữa']] || 0) + 1; days.set(r['Ngày ăn'], d); }
    const arr = [...days.entries()].sort((a, b) => a[1].t - b[1].t);
    const colTot = Object.fromEntries(buas.map(b => [b, 0]));
    return `<table class="stat"><thead><tr><th>Ngày ăn</th><th>Thứ</th>${buas.map(b => `<th class="num">${esc(b)}</th>`).join('')}<th class="num">Tổng suất</th></tr></thead><tbody>
      ${arr.map(([d, o]) => { let s = 0; const cells = buas.map(b => { const n = o.c[b] || 0; s += n; colTot[b] += n; return `<td class="num">${n ? fmtNum(n) : '<span class="muted">·</span>'}</td>`; }).join(''); return `<tr><td>${esc(d)}</td><td>${esc(o.thu)}</td>${cells}<td class="num"><b>${fmtNum(s)}</b></td></tr>`; }).join('')}
      <tr class="totalrow"><td>Tổng</td><td></td>${buas.map(b => `<td class="num">${fmtNum(colTot[b])}</td>`).join('')}<td class="num">${fmtNum(rows.length)}</td></tr></tbody></table>`;
  }
  function statsHtml() {
    const o = DATA.orders, revenue = o.reduce((s, r) => s + (r['Tổng tiền'] || 0), 0), cus = new Set(o.map(r => r['SĐT'] || r['Khách hàng'])).size;
    const pk = DATA.items.filter(r => r['Loại'] === 'Gói ăn'), fees = DATA.items.filter(r => r['Loại'] !== 'Gói ăn');
    const pkgs = [...new Set(DATA.meals.map(r => r['Gói']))].sort();
    const meals = gMealPkg ? DATA.meals.filter(r => r['Gói'] === gMealPkg) : DATA.meals;
    const gOpts = ['Tuần', 'Ngày giao', 'Khung giờ', 'Phường', 'Thanh toán', 'Trạng thái TT', 'Guest', 'YES Change'];
    return `<div class="tiles">
        <div class="tile"><div class="lb">Số đơn</div><div class="vl">${fmtNum(o.length)}</div></div>
        <div class="tile"><div class="lb">Doanh thu (Tổng tiền)</div><div class="vl">${fmtNum(revenue)}đ</div></div>
        <div class="tile"><div class="lb">Số khách</div><div class="vl">${fmtNum(cus)}</div></div>
        <div class="tile"><div class="lb">Số gói ăn</div><div class="vl">${fmtNum(pk.length)}</div></div>
        <div class="tile"><div class="lb">Tổng suất ăn</div><div class="vl">${fmtNum(DATA.meals.length)}</div></div></div>
      <div class="grid2">
        <section><h3>Đơn hàng theo <select data-g="orders">${gOpts.map(x => `<option ${x === gOrders ? 'selected' : ''}>${x}</option>`).join('')}</select></h3>${groupTable(o, gOrders, 'Tổng tiền')}</section>
        <section><h3>Gói ăn</h3>${groupTable(pk, 'Gói', 'Giá')}${fees.length ? `<h3 style="margin-top:12px">Phí / giảm giá</h3>${groupTable(fees, 'Gói', 'Giá', 'Khoản')}` : ''}</section>
      </div>
      <section><h3>Suất ăn theo ngày & bữa <select data-g="meal"><option value="">Tất cả gói</option>${pkgs.map(p => `<option ${p === gMealPkg ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <span class="muted">— đếm từ lịch ăn trong chi tiết gói</span></h3>${meals.length ? mealPivot(meals) : '<div class="muted">Không có lịch ăn.</div>'}</section>`;
  }

  /* ---------- xuất Excel ---------- */
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => ok(window.XLSX); s.onerror = () => fail(new Error('Không tải được thư viện Excel'));
      document.documentElement.appendChild(s);
    });
  }
  async function exportXlsx() {
    if (!DATA.orders.length) return alert('Chưa có dữ liệu — bấm Tải dữ liệu trước.');
    const name = `fitfood_${ymd(monday(parseYmd(ui.from.value)))}_den_${ymd(monday(parseYmd(ui.to.value)))}.xlsx`;
    const sheet = v => DATA[v].map(r => Object.fromEntries(VIEWS[v].cols.map(c => [c, r[c] ?? ''])));
    try {
      const X = await loadXlsx(), wb = X.utils.book_new();
      for (const [v, nm] of [['orders', 'Don hang'], ['items', 'Chi tiet goi'], ['meals', 'Suat an']]) {
        const ws = X.utils.json_to_sheet(sheet(v), {header: VIEWS[v].cols});
        ws['!cols'] = VIEWS[v].cols.map(c => ({wch: Math.min(40, Math.max(c.length + 2, ...DATA[v].slice(0, 200).map(r => String(r[c] ?? '').length + 1)))}));
        X.utils.book_append_sheet(wb, ws, nm);
      }
      X.writeFile(wb, name);
    } catch (e) {
      // dự phòng: CSV đơn hàng
      const e2 = v => { const t = String(v ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
      const csv = '﻿' + [VIEWS.orders.cols.join(','), ...DATA.orders.map(r => VIEWS.orders.cols.map(c => e2(r[c])).join(','))].join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'})); a.download = name.replace('.xlsx', '_don-hang.csv'); a.click();
      alert(e.message + ' — đã xuất file CSV đơn hàng thay thế.');
    }
  }

  /* ---------- giao diện ---------- */
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({mode: 'open'});
  const curWeek = new URLSearchParams(location.search).get('week') || (document.querySelector('input[name=week]') || {}).value || ymd(monday(new Date()));
  root.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box}
    .app{position:fixed;inset:0;background:#f3f6f4;color:#1c2a22;font:14px/1.5 "Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column}
    .top{background:linear-gradient(110deg,#15803d,#0d9488);color:#fff;padding:10px 18px;display:flex;align-items:center;gap:12px}
    .top h1{font-size:18px;margin:0}.top .sub{opacity:.85;font-size:12.5px}.grow{flex:1}
    .top button{background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.4)}
    .body{flex:1;overflow:auto;padding:14px 18px}
    .card{background:#fff;border:1px solid #dfe7e2;border-radius:12px;padding:12px 14px;margin-bottom:12px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
    .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    label{font-size:13px;color:#4b5b52}
    input,select,button{font:inherit;color:inherit;border:1px solid #cfdad3;border-radius:8px;padding:6px 10px;background:#fff}
    button{cursor:pointer}button:hover{border-color:#15803d}button:disabled{opacity:.55;cursor:wait}
    .pri{background:linear-gradient(110deg,#15803d,#0d9488);color:#fff;border:none;font-weight:600;padding:8px 18px}
    .hide{display:none!important}
    .prog{height:6px;background:#e5ece8;border-radius:99px;overflow:hidden;margin-top:10px}.prog span{display:block;height:100%;width:0;background:#15803d;transition:width .2s}
    .msg{font-size:13px;color:#4b5b52;margin-top:6px}.msg.bad{color:#b91c1c;font-weight:600}
    .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
    .tab{border-radius:99px;padding:6px 14px;font-weight:600;color:#4b5b52}.tab.on{background:#15803d;border-color:#15803d;color:#fff}
    .tab .n{display:inline-block;margin-left:4px;padding:0 7px;border-radius:99px;background:#e5ece8;color:#1c2a22;font-size:12px}.tab.on .n{background:rgba(255,255,255,.25);color:#fff}
    .scroll{max-height:calc(100vh - 330px);overflow:auto;border:1px solid #dfe7e2;border-radius:10px;background:#fff}
    table{border-collapse:collapse;width:100%}
    th,td{border-bottom:1px solid #e8eee9;padding:5px 8px;text-align:left;font-size:13px;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}
    th{background:#eef4f0;position:sticky;top:0;cursor:pointer;user-select:none;z-index:1}th.sorted{color:#15803d}
    .num{text-align:right;font-variant-numeric:tabular-nums}.muted{color:#7b8a81}
    .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:12px}
    .tile{background:#fff;border:1px solid #dfe7e2;border-left:4px solid #15803d;border-radius:10px;padding:10px 12px}
    .tile .lb{font-size:12px;color:#6b7a71;text-transform:uppercase;letter-spacing:.3px}.tile .vl{font-size:20px;font-weight:700}
    .grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:12px}
    section{background:#fff;border:1px solid #dfe7e2;border-radius:10px;padding:10px 12px;margin-bottom:12px;overflow:auto}
    h3{font-size:14px;margin:0 0 8px}
    table.stat th{cursor:default}table.stat td{max-width:none}
    .totalrow td{font-weight:700;background:#f4f8f5}
    .bar{height:10px;background:#eef4f0;border-radius:0 5px 5px 0}.bar span{display:block;height:100%;background:#15803d;border-radius:0 4px 4px 0}
  </style>
  <div class="app">
    <div class="top"><div><h1>🥗 Fitfood · Gom đơn hàng</h1><div class="sub">Tải nhiều tuần · gộp tất cả các trang · thống kê · xuất Excel</div></div>
      <span class="grow"></span><button id="close" title="Ẩn tool (bấm bookmark để mở lại)">✕ Đóng</button></div>
    <div class="body">
      <div class="card">
        <div class="row">
          <label>Từ tuần <input type="date" id="from" value="${esc(curWeek)}"></label>
          <label>Đến tuần <input type="date" id="to" value="${esc(curWeek)}"></label>
          <label title="Áp dụng các ô lọc đang chọn trên trang fitfood (khách, gói, phường…)"><input type="checkbox" id="keep"> Giữ bộ lọc đang chọn trên trang</label>
          <label title="Đơn kéo dài 2 tuần sẽ xuất hiện ở cả 2 tuần — bật để chỉ tính 1 lần"><input type="checkbox" id="dedup" checked> Bỏ trùng đơn giữa các tuần</label>
          <span class="grow"></span>
          <button class="pri" id="go">⬇ Tải dữ liệu</button><button id="stop" class="hide">⏹ Dừng</button>
          <button id="xlsx">📗 Xuất Excel</button>
        </div>
        <div class="prog"><span id="bar"></span></div><div class="msg" id="msg">Chọn tuần (ngày bất kỳ trong tuần cũng được) rồi bấm Tải dữ liệu.</div>
      </div>
      <div class="tabs" id="tabs"></div>
      <div id="view"></div>
    </div>
  </div>`;
  const $ = s => root.querySelector(s);
  const ui = {from: $('#from'), to: $('#to'), keep: $('#keep'), dedup: $('#dedup'), go: $('#go'), stop: $('#stop'), bar: $('#bar'), msg: $('#msg')};

  function render() {
    $('#tabs').innerHTML = Object.entries(VIEWS).map(([k, v]) => `<button class="tab ${view === k ? 'on' : ''}" data-v="${k}">${v.label}${DATA[k] ? `<span class="n">${fmtNum(DATA[k].length)}</span>` : ''}</button>`).join('');
    const box = $('#view');
    if (!DATA.orders.length) { box.innerHTML = '<div class="card muted">Chưa có dữ liệu.</div>'; return; }
    if (view === 'stats') { box.innerHTML = statsHtml(); return; }
    const rows = rowsOf(view);
    box.innerHTML = `<div class="row" style="margin-bottom:8px"><input id="q" placeholder="🔎 Tìm (tên, SĐT, mã đơn, phường…)" value="${esc(q)}" style="flex:1;min-width:240px">
      <span class="muted">${fmtNum(rows.length)} dòng · bấm tiêu đề cột để sắp xếp</span></div>${tableHtml(VIEWS[view].cols, rows)}`;
    const qi = $('#q');
    qi.oninput = () => { q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { render(); const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  }
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-v],[data-sort]'); if (!t) return;
    if (t.dataset.v) { view = t.dataset.v; sort = {col: null, dir: 1}; render(); }
    else { const c = t.dataset.sort; sort = sort.col !== c ? {col: c, dir: 1} : sort.dir > 0 ? {col: c, dir: -1} : {col: null, dir: 1}; render(); }
  });
  root.addEventListener('change', e => {
    if (e.target.dataset.g === 'orders') { gOrders = e.target.value; render(); }
    if (e.target.dataset.g === 'meal') { gMealPkg = e.target.value; render(); }
  });
  ui.from.onchange = () => { if (ui.to.value < ui.from.value) ui.to.value = ui.from.value; };
  ui.go.onclick = run;
  ui.stop.onclick = () => { stopFlag = true; };
  ui.dedup.onchange = () => { dedupe(); render(); };
  $('#xlsx').onclick = exportXlsx;
  $('#close').onclick = () => { host.style.display = 'none'; };
  window.__ffTool = {toggle: () => { host.style.display = host.style.display === 'none' ? '' : 'none'; }};
  render();
})();
