/* LAN配線系統図エディタ: UI (共聴系統図エディタと同じ構成) */
(() => {
  'use strict';
  const NZ = window.NZ;
  const $ = (s) => document.querySelector(s);
  const svg = $('#canvas'), viewport = $('#viewport'), world = $('#world'), overlay = $('#overlay');
  const STORE = 'network_zumen_v1';
  const GRID = 5;
  const TOUCH = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

  const today = () => new Date().toISOString().slice(0, 10);
  const blank = () => ({
    version: 1, title: '新規 LAN配線系統図', author: '', date: today(),
    floors: ['3F', '2F', '1F'], laneH: 200, nodes: [], edges: [], seq: 1, labelFmt: '{floor}-{panel}-{port}',
  });
  const EDGE_DEF = { cable: 'cat6a', qty: 1, len: 10, method: 'ceil', conduit: '', pairs: '' };

  let model = loadLocal() || normalize(NZ.sample());
  let res = null, lab = {};
  let sel = null;
  let view = { x: 0, y: 0, k: 1 };
  let tool = null;
  let drag = null;
  let lastCable = { cable: 'cat6a', qty: 1, len: 15, method: 'ceil', conduit: '' };
  const undoStack = [], redoStack = [];
  const show = { label: true, cable: true, room: true };
  let activeTab = 'table';
  let linkFrom = null;            // タップ配線: 接続元の機器 id
  const touches = new Map();      // ピンチ操作用
  let pinch = null;

  /* ---------- 永続化 ---------- */
  function loadLocal() {
    try { const s = localStorage.getItem(STORE); return s ? normalize(JSON.parse(s)) : null; } catch (e) { return null; }
  }
  function saveLocal() {
    try { localStorage.setItem(STORE, JSON.stringify(model)); } catch (e) { /* 保存不可でも動作継続 */ }
  }
  function normalize(m) {
    m = Object.assign(blank(), m);
    m.nodes = m.nodes.filter((n) => NZ.TYPES[n.type]);
    m.nodes.forEach((n) => { n.p = Object.assign({}, NZ.TYPES[n.type].defaults, n.p); });
    m.edges.forEach((e) => { e.p = Object.assign({}, EDGE_DEF, e.p); });
    if (!m.seq) m.seq = m.nodes.length + m.edges.length + 1;
    return m;
  }
  const newId = (pfx) => pfx + model.seq++;

  function snapshot() {
    undoStack.push(JSON.stringify(model));
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(model));
    model = JSON.parse(undoStack.pop());
    validateSel(); render();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(model));
    model = JSON.parse(redoStack.pop());
    validateSel(); render();
  }
  function validateSel() {
    if (!sel) return;
    const ok = sel.k === 'n' ? model.nodes.some((n) => n.id === sel.id) : model.edges.some((e) => e.id === sel.id);
    if (!ok) sel = null;
  }

  const nodeById = (id) => model.nodes.find((n) => n.id === id);
  const edgeById = (id) => model.edges.find((e) => e.id === id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const snap = (v) => Math.round(v / GRID) * GRID;
  const floorOf = (n) => model.floors[Math.floor(n.y / model.laneH)] || '-';
  const nm = (n) => (n ? NZ.displayName(n).trim() : '?');

  /* ---------- 配線ルート ---------- */
  function portAbs(n, pid) {
    const q = NZ.port(n, pid);
    return q ? { x: n.x + q.x, y: n.y + q.y, dir: q.dir, kind: q.kind } : null;
  }
  function route(a, b) {
    const [dx, dy] = NZ.DIRV[a.dir];
    const P = [[a.x, a.y]];
    const intoLeft = b.dir === 'left';
    if (dy !== 0) {
      if (intoLeft && b.y > a.y + 6 && b.x > a.x + 6) {
        P.push([a.x, b.y]);
      } else if (!intoLeft && b.y - 8 >= a.y + 6) {
        if (Math.abs(a.x - b.x) > 0.5) { const my = snap((a.y + b.y) / 2); P.push([a.x, my], [b.x, my]); }
      } else {
        const mx = Math.max(a.x, b.x) + 40;
        P.push([a.x, a.y + 10], [mx, a.y + 10], [mx, b.y - 10], [b.x, b.y - 10]);
      }
    } else if (intoLeft && (b.x - a.x) * dx >= 12) {
      if (Math.abs(a.y - b.y) > 0.5) { const mx = snap((a.x + b.x) / 2); P.push([mx, a.y], [mx, b.y]); }
    } else if (!intoLeft && (b.x - a.x) * dx >= 6 && b.y - 8 >= a.y - 0.5) {
      P.push([b.x, a.y]);
    } else {
      const sx = a.x + dx * 12;
      P.push([sx, a.y], [sx, b.y - (intoLeft ? 0 : 10)]);
      if (!intoLeft) P.push([b.x, b.y - 10]);
    }
    P.push([b.x, b.y]);
    return P.filter((p, i) => i === 0 || p[0] !== P[i - 1][0] || p[1] !== P[i - 1][1]);
  }

  /* ---------- 図面描画 ---------- */
  function bounds() {
    let minX = 0, maxX = 1000;
    model.nodes.forEach((n) => {
      const w = n.type === 'rack' ? +n.p.w : 0;
      minX = Math.min(minX, n.x - 120);
      maxX = Math.max(maxX, n.x + w + 200);
    });
    return { x: minX, y: 0, w: maxX - minX, h: model.floors.length * model.laneH };
  }
  function labelPos(n) {
    const T = NZ.TYPES[n.type];
    if (T.box) return [T.w / 2 + 4, -13];
    if (n.type === 'tel') return [12, -6];
    return [n.p.mount === 'raised' ? 13 : 11, -8];
  }

  function drawing(live) {
    const b = bounds();
    const out = [];
    model.floors.forEach((f, i) => {
      const y = i * model.laneH;
      out.push(`<rect x="${b.x}" y="${y}" width="${b.w}" height="${model.laneH}" fill="${i % 2 ? '#ffffff' : '#fafbfc'}" stroke="#c9ced6" stroke-width="0.8" stroke-dasharray="6 4"/>`);
      out.push(`<text x="${b.x + 12}" y="${y + 24}" font-size="16" font-weight="700" fill="#4b5563">${esc(f)}</text>`);
    });
    // ラック・盤
    model.nodes.filter((n) => n.type === 'rack').forEach((n) => {
      const cls = ['node', 'box', sel && sel.k === 'n' && sel.id === n.id ? 'sel' : ''].join(' ');
      out.push(`<g class="${cls}" data-node="${n.id}" transform="translate(${n.x},${n.y})">` +
        `<rect class="boxrect" width="${n.p.w}" height="${n.p.h}" fill="none" stroke="#374151" stroke-width="1.1" stroke-dasharray="10 3 2 3"/>` +
        (live ? `<rect class="boxhit" width="${n.p.w}" height="${n.p.h}"/>` : '') +
        `<text x="6" y="${n.p.h - 6}" font-size="11" fill="#374151">${esc(n.p.label)}</text>` +
        (live && sel && sel.id === n.id ? `<rect class="handle" data-handle="${n.id}" x="${n.p.w - 6}" y="${n.p.h - 6}" width="12" height="12"/>` : '') +
        `</g>`);
    });
    // ケーブル
    const errEdges = new Set(res.warnings.filter((w) => w.edge).map((w) => w.edge));
    model.edges.forEach((e) => {
      const a = nodeById(e.from.n), c = nodeById(e.to.n);
      if (!a || !c) return;
      const pa = portAbs(a, e.from.p), pc = portAbs(c, e.to.p);
      if (!pa || !pc) return;
      const pts = route(pa, pc);
      const ps = pts.map((p) => p.join(',')).join(' ');
      const isSel = sel && sel.k === 'e' && sel.id === e.id;
      const cab = NZ.CABLES[e.p.cable] || NZ.CABLES.cat6a;
      const dash = cab.kind === 'cord' ? '' : (NZ.METHODS[e.p.method] || NZ.METHODS.ceil).dash;
      const sw = cab.kind === 'fiber' ? 2.4 : cab.kind === 'cord' ? 1 : 1.3;
      let label = '';
      const txt = show.cable ? NZ.cableText(e) : '';
      if (txt) {
        // 最後の区間が十分長ければそこへ(共通の幹線部分に重ねない)、なければ最長区間
        const last = [pts[pts.length - 2], pts[pts.length - 1]];
        const segLen = (s) => Math.abs(s[1][0] - s[0][0]) + Math.abs(s[1][1] - s[0][1]);
        let seg = segLen(last) >= 40 ? last : null;
        if (!seg) {
          let best = 0;
          for (let i = 1; i < pts.length; i++) { const s = [pts[i - 1], pts[i]]; if (segLen(s) > best) { best = segLen(s); seg = s; } }
        }
        if (seg) {
          const vert = seg[0][0] === seg[1][0];
          const mx = (seg[0][0] + seg[1][0]) / 2, my = (seg[0][1] + seg[1][1]) / 2;
          label = vert
            ? `<text x="${mx - 4}" y="${my + 3}" font-size="9.5" fill="#1f2937" text-anchor="end">${esc(txt)}</text>`
            : `<text x="${mx}" y="${my - 4}" font-size="9.5" fill="#1f2937" text-anchor="middle">${esc(txt)}</text>`;
        }
      }
      const col = live && errEdges.has(e.id) ? '#dc2626' : '#111827';
      out.push(`<g class="edge${isSel ? ' sel' : ''}" data-edge="${e.id}">` +
        `<polyline class="wire" points="${ps}" fill="none" stroke="${col}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>` +
        (live ? `<polyline class="hit" points="${ps}"/>` : '') + label + `</g>`);
    });
    // 警告ノード
    const bad = new Map();
    res.warnings.forEach((w) => { if (w.node && !w.edge) bad.set(w.node, w.level === 'err' || bad.get(w.node) === 'err' ? 'err' : 'warn'); });
    // 機器
    model.nodes.filter((n) => n.type !== 'rack').forEach((n) => {
      const isSel = sel && sel.k === 'n' && sel.id === n.id;
      const cls = ['node', 't-' + n.type, isSel ? 'sel' : '', live && bad.get(n.id) === 'err' ? 'bad' : live && bad.get(n.id) ? 'warn' : ''].join(' ');
      let g = `<g class="${cls}" data-node="${n.id}" transform="translate(${n.x},${n.y})">`;
      if (n.type === 'text') {
        const lines = String(n.p.text).split('\n');
        const fs = +n.p.size || 13;
        if (live) g += `<rect class="hit" x="-4" y="${-fs}" width="${Math.max(40, Math.max(...lines.map((l) => l.length)) * fs + 8)}" height="${lines.length * fs * 1.35 + 6}"/>`;
        g += `<text font-size="${fs}" fill="#111827">${lines.map((l, i) => `<tspan x="0" dy="${i ? fs * 1.35 : 0}">${esc(l)}</tspan>`).join('')}</text>`;
        out.push(g + '</g>');
        return;
      }
      const T = NZ.TYPES[n.type];
      const hw = T.box ? T.w / 2 + 6 : 15;
      if (live) g += `<rect class="hit" x="${-hw}" y="-16" width="${hw * 2}" height="34" rx="5"/>`;
      g += `<g class="sym">${NZ.symbol(n)}</g>`;
      const [lx, ly] = labelPos(n);
      const ann = NZ.annotation(n);
      let row = ly;
      if (ann) { g += `<text x="${lx}" y="${row}" font-size="10.5" fill="#111827">${esc(ann)}</text>`; row += 12; }
      if (NZ.isOutlet(n.type)) {
        // 識別子・室名は記号の下に中央揃え(横に並ぶアウトレットと重ならないように)
        let by = n.p.mount === 'wall' ? 20 : 25;
        if (show.label && lab[n.id]) { g += `<text x="0" y="${by}" font-size="9.5" fill="#1d4ed8" font-weight="600" text-anchor="middle">${esc(lab[n.id].text)}</text>`; by += 11; }
        if (show.room && n.p.room) { g += `<text x="0" y="${by}" font-size="9.5" fill="#6b7280" text-anchor="middle">${esc(n.p.room)}</text>`; }
      }
      if (live) {
        NZ.ports(n).forEach((q) => { g += `<circle class="port ${q.kind}" data-port="${n.id}:${q.id}" cx="${q.x}" cy="${q.y}" r="4"/>`; });
      }
      out.push(g + '</g>');
    });
    return out.join('');
  }

  /* ---------- 全体描画 ---------- */
  function recompute() { res = NZ.compute(model); lab = NZ.labels(model, res); }
  function render() {
    recompute();
    world.innerHTML = drawing(true);
    applyView();
    renderProps();
    renderWarnings();
    renderBottom();
    $('#docTitle').value = model.title || '';
    saveLocal();
  }
  function renderCanvasOnly() { recompute(); world.innerHTML = drawing(true); }
  function applyView() { viewport.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`); }
  function fit() {
    const b = bounds();
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    view.k = Math.max(0.2, Math.min((r.width - 40) / b.w, (r.height - 40) / b.h, 1.6));
    view.x = (r.width - b.w * view.k) / 2 - b.x * view.k;
    view.y = (r.height - b.h * view.k) / 2 - b.y * view.k;
    if (r.width < 600) {
      // スマホ: 幅いっぱいに広げて上寄せ(縦は指でスクロール)
      view.k = Math.max(0.2, (r.width - 16) / b.w);
      view.x = 8 - b.x * view.k;
      view.y = 8 - b.y * view.k;
    }
    applyView();
  }
  function toWorld(ev) {
    const r = svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left - view.x) / view.k, y: (ev.clientY - r.top - view.y) / view.k };
  }
  function zoomAt(cx, cy, factor) {
    const k = Math.min(4, Math.max(0.15, view.k * factor));
    view.x = cx - (cx - view.x) * (k / view.k);
    view.y = cy - (cy - view.y) * (k / view.k);
    view.k = k;
    applyView();
  }

  /* ---------- パレット ---------- */
  const PALETTE = [
    ['回線・中枢', [['onu', {}, 'ONU'], ['rt', {}, 'ルータ (RT)'], ['fw', {}, 'ファイアウォール'], ['sw', { l3: true, name: 'SW-C', sfp: 8 }, 'L3スイッチ (コア)']]],
    ['フロア', [['sw', {}, 'スイッチ (SW)'], ['sw', { poe: true }, 'PoEスイッチ'], ['hub', {}, 'ハブ'], ['pp', {}, 'パッチパネル'], ['rack', {}, 'ラック・盤']]],
    ['アウトレット', [['outlet', { mount: 'wall' }, '情報用(壁付)'], ['outlet', { mount: 'wall', conn: 2 }, '情報用(壁付) 2口'], ['outlet', { mount: 'floor' }, '情報用(床付)'], ['outlet', { mount: 'raised' }, '二重床情報'],
      ['tel_outlet', { mount: 'wall' }, '電話用(壁付)']]],
    ['端末', [['ap', {}, '無線AP'], ['cam', {}, 'ネットワークカメラ'], ['pc', {}, 'PC・端末'], ['prn', {}, '複合機'], ['tv', {}, 'テレビ'], ['stb', {}, 'STB'], ['sv', {}, 'サーバー'], ['tel', {}, '内線電話機']]],
    ['電話・その他', [['mdf', {}, '本配線盤 (MDF)'], ['pbx', {}, '交換装置 (PBX)'], ['text', {}, 'テキスト']]],
  ];
  function iconSvg(type, p, size = 34) {
    const n = { type, p: Object.assign({}, NZ.TYPES[type].defaults, p) };
    let inner;
    if (type === 'rack') inner = `<rect x="-14" y="-9" width="28" height="18" fill="none" stroke="#111827" stroke-width="1.4" stroke-dasharray="6 2 1.5 2"/>`;
    else if (type === 'text') inner = `<text x="0" y="6" font-size="17" text-anchor="middle" fill="#111827">A</text>`;
    else inner = NZ.symbol(n);
    return `<svg width="${size}" height="${size}" viewBox="-24 -24 48 48">${inner}</svg>`;
  }
  function buildPalette() {
    const el = $('#palette');
    el.innerHTML = PALETTE.map(([g, items], gi) => `<div class="pal-group"><h4>${g}</h4>` +
      items.map(([t, p, name], ii) => `<button class="pal-item" draggable="true" data-pal="${gi}:${ii}" title="クリックして図面上をクリック、またはドラッグで配置">${iconSvg(t, p)}<span>${name}</span></button>`).join('') +
      `</div>`).join('');
    el.querySelectorAll('.pal-item').forEach((b) => {
      const [gi, ii] = b.dataset.pal.split(':').map(Number);
      const [t, p] = PALETTE[gi][1][ii];
      b.addEventListener('click', () => {
        tool = tool && tool.key === b.dataset.pal ? null : { type: t, p, key: b.dataset.pal };
        updateArmed();
      });
      b.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', b.dataset.pal); });
    });
  }
  function updateArmed() {
    document.querySelectorAll('.pal-item').forEach((b) => b.classList.toggle('armed', !!tool && tool.key === b.dataset.pal));
    svg.classList.toggle('armed', !!tool);
    setHint();
  }
  function setHint(msg) {
    $('#hint').textContent = msg || (tool
      ? '図面をクリックして配置(Shift+クリックで連続配置、Escで解除)'
      : TOUCH ? 'タップで選択 → 下のボタンで配線・削除 / 2本指で拡大縮小・移動'
      : 'ドラッグ: 移動 / 端子(橙→緑)をドラッグ、または選択して「配線」(L)→接続先をクリックで配線 / ホイール: 拡大縮小');
  }
  function addNode(type, p, x, y) {
    snapshot();
    const n = { id: newId('n'), type, x: snap(x), y: snap(y), p: Object.assign({}, NZ.TYPES[type].defaults, p) };
    if (type === 'rack') { n.x = snap(x - 40); n.y = snap(y - 20); }
    model.nodes.push(n);
    sel = { k: 'n', id: n.id };
    render();
    return n;
  }

  /* ---------- ポインタ操作 ---------- */
  svg.addEventListener('pointerdown', (ev) => {
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (touches.size === 2) { startPinch(); return; }
    if (touches.size > 2 || pinch) return;
    if (ev.button === 1 || (ev.button === 0 && ev.altKey)) { startPan(ev); return; }
    if (ev.button !== 0) return;
    const t = ev.target;
    const w = toWorld(ev);
    const portEl = t.closest('[data-port]');
    const handleEl = t.closest('[data-handle]');
    const nodeEl = t.closest('[data-node]');
    const edgeEl = t.closest('[data-edge]');
    if (linkFrom) {
      const target = nodeEl ? nodeById(nodeEl.dataset.node) : null;
      const from = linkFrom;
      linkFrom = null;
      if (target && NZ.TYPES[target.type].cat !== 'deco' && target.id !== from) { autoConnect(from, target.id); return; }
      setHint();
      renderActbar();
    }
    if (tool && !portEl && !handleEl) {
      addNode(tool.type, tool.p, w.x, w.y);
      if (!ev.shiftKey) { tool = null; updateArmed(); }
      return;
    }
    if (portEl) {
      const [nid, pid] = portEl.dataset.port.split(':');
      const pa = portAbs(nodeById(nid), pid);
      drag = { mode: 'wire', nid, pid, kind: pa.kind, start: pa };
      svg.classList.add('wiring');
      svg.setPointerCapture(ev.pointerId);
      return;
    }
    if (handleEl) {
      const n = nodeById(handleEl.dataset.handle);
      drag = { mode: 'resize', n, w0: +n.p.w, h0: +n.p.h, s: w, snap: false };
      svg.setPointerCapture(ev.pointerId);
      return;
    }
    if (nodeEl) {
      const n = nodeById(nodeEl.dataset.node);
      sel = { k: 'n', id: n.id };
      drag = { mode: 'move', n, ox: w.x - n.x, oy: w.y - n.y, moved: false, sx: ev.clientX, sy: ev.clientY };
      svg.setPointerCapture(ev.pointerId);
      renderCanvasOnly(); renderProps(); renderBottom();
      return;
    }
    if (edgeEl) {
      sel = { k: 'e', id: edgeEl.dataset.edge };
      renderCanvasOnly(); renderProps(); renderBottom();
      return;
    }
    sel = null;
    renderCanvasOnly(); renderProps(); renderBottom();
    startPan(ev);
  });
  function startPan(ev) {
    drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y };
    svg.classList.add('panning');
    svg.setPointerCapture(ev.pointerId);
  }
  svg.addEventListener('pointermove', (ev) => {
    if (touches.has(ev.pointerId)) touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch) { movePinch(); return; }
    if (!drag) return;
    const w = toWorld(ev);
    if (drag.mode === 'pan') {
      view.x = drag.vx + ev.clientX - drag.sx;
      view.y = drag.vy + ev.clientY - drag.sy;
      applyView();
    } else if (drag.mode === 'move') {
      // 指のぶれで動かないよう、6px 以上動かしてから移動を始める
      if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 6) return;
      const nx = snap(w.x - drag.ox), ny = snap(w.y - drag.oy);
      if (nx !== drag.n.x || ny !== drag.n.y) {
        if (!drag.moved) { snapshot(); drag.moved = true; }
        drag.n.x = nx; drag.n.y = ny;
        renderCanvasOnly();
      }
    } else if (drag.mode === 'resize') {
      if (!drag.snap) { snapshot(); drag.snap = true; }
      drag.n.p.w = Math.max(40, snap(drag.w0 + w.x - drag.s.x));
      drag.n.p.h = Math.max(30, snap(drag.h0 + w.y - drag.s.y));
      renderCanvasOnly();
    } else if (drag.mode === 'wire') {
      overlay.innerHTML = `<line x1="${drag.start.x}" y1="${drag.start.y}" x2="${w.x}" y2="${w.y}" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    }
  });
  function startPinch() {
    if (drag && drag.moved) render();
    drag = null;
    svg.classList.remove('panning', 'wiring');
    overlay.innerHTML = '';
    const [a, b] = [...touches.values()];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: view.k, vx: view.x, vy: view.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }
  function movePinch() {
    const [a, b] = [...touches.values()];
    if (!a || !b) return;
    const r = svg.getBoundingClientRect();
    const k = Math.min(4, Math.max(0.15, pinch.k0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0));
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    // 指の中点の下にある図面上の点を、中点の移動に合わせて動かす
    const wx = (pinch.mx - r.left - pinch.vx) / pinch.k0, wy = (pinch.my - r.top - pinch.vy) / pinch.k0;
    view.k = k;
    view.x = mx - r.left - wx * k;
    view.y = my - r.top - wy * k;
    applyView();
  }
  const endTouch = (ev) => {
    touches.delete(ev.pointerId);
    if (pinch && touches.size < 2) { pinch = null; drag = null; return true; }
    return !!pinch;
  };
  svg.addEventListener('pointercancel', (ev) => {
    endTouch(ev);
    if (drag && drag.moved) render();
    drag = null;
    svg.classList.remove('panning', 'wiring');
    overlay.innerHTML = '';
  });
  svg.addEventListener('pointerup', (ev) => {
    if (endTouch(ev)) return;
    if (!drag) return;
    const d = drag;
    drag = null;
    svg.classList.remove('panning', 'wiring');
    overlay.innerHTML = '';
    if (d.mode === 'move' || d.mode === 'resize') { render(); return; }
    if (d.mode !== 'wire') return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el) return;
    let tn = null, tp = null;
    const portEl = el.closest('[data-port]');
    if (portEl) [tn, tp] = portEl.dataset.port.split(':');
    else {
      const nodeEl = el.closest('[data-node]');
      if (nodeEl) {
        tn = nodeEl.dataset.node;
        const n = nodeById(tn);
        const want = d.kind === 'out' ? 'in' : 'out';
        const ps = NZ.ports(n).filter((q) => q.kind === want);
        const free = ps.filter((q) => !model.edges.some((e) => (want === 'in' ? e.to : e.from).n === tn && (want === 'in' ? e.to : e.from).p === q.id));
        tp = (free[0] || ps[0] || {}).id;
      }
    }
    if (!tn || !tp || tn === d.nid) return;
    const tq = NZ.port(nodeById(tn), tp);
    if (!tq || tq.kind === d.kind) return;
    const from = d.kind === 'out' ? { n: d.nid, p: d.pid } : { n: tn, p: tp };
    const to = d.kind === 'out' ? { n: tn, p: tp } : { n: d.nid, p: d.pid };
    connect(from, to);
  });
  function connect(from, to) {
    snapshot();
    // 出力端子は複数本OK(幹線から分ける)。入力端子は1本まで
    model.edges = model.edges.filter((e) => !(e.to.n === to.n && e.to.p === to.p));
    const a = nodeById(from.n), b = nodeById(to.n);
    const cord = (NZ.isOutlet(a.type) && NZ.TYPES[b.type].cat === 'end');
    const p = Object.assign({}, EDGE_DEF, cord ? { cable: 'cord', len: 0 } : lastCable);
    if (b.type === 'outlet' && !cord) p.qty = +b.p.conn || 1;
    if (b.type === 'tel_outlet') { p.cable = 'tel'; p.qty = +b.p.conn || 1; }
    const e = { id: newId('e'), from, to, p };
    model.edges.push(e);
    sel = { k: 'e', id: e.id };
    render();
  }
  // タップ配線: 2つの機器の位置関係から、出力端子と入力端子を自動で選ぶ
  const RANK = (n) => {
    const T = NZ.TYPES[n.type];
    if (!NZ.ports(n).some((q) => q.kind === 'out')) return -1;
    return T.cat === 'active' ? 3 : T.box ? 2 : 1;
  };
  function autoConnect(aId, bId) {
    let a = nodeById(aId), b = nodeById(bId);
    if (RANK(b) > RANK(a)) [a, b] = [b, a];
    if (RANK(a) < 0) { setHint('どちらの機器にも出力端子がないため、接続できません'); renderActbar(); return; }
    const outs = NZ.ports(a).filter((q) => q.kind === 'out').map((q) => q.id);
    const ins = NZ.ports(b).filter((q) => q.kind === 'in').map((q) => q.id);
    if (!ins.length) { setHint('接続先に入力端子がありません'); renderActbar(); return; }
    const dx = b.x - a.x, dy = b.y - a.y;
    let fp = dy > 25 && Math.abs(dx) < dy ? 'out' : 'outR';
    if (!outs.includes(fp)) fp = outs[0];
    let tp = fp === 'outR' && Math.abs(dy) <= 25 && dx > 0 && ins.includes('inL') ? 'inL' : 'in';
    if (!ins.includes(tp)) tp = ins[0];
    setHint();
    connect({ n: a.id, p: fp }, { n: b.id, p: tp });
  }
  function startLink() {
    if (!sel || sel.k !== 'n') return;
    linkFrom = sel.id;
    setHint('接続先の機器をタップしてください(何もない所をタップで中止)');
    renderActbar();
  }

  /* ---------- 操作バー(選択中の機器・ケーブルへの操作。スマホでも押しやすい大きさ) ---------- */
  function renderActbar() {
    const el = $('#actbar');
    if (linkFrom) {
      el.innerHTML = `<span class="ab-msg">接続先をタップ</span><button data-ab="cancel">中止</button>`;
    } else if (!sel) {
      el.innerHTML = '';
    } else {
      const it = sel.k === 'n' ? nodeById(sel.id) : edgeById(sel.id);
      if (!it) { el.innerHTML = ''; el.classList.remove('on'); return; }
      const canLink = sel.k === 'n' && NZ.TYPES[it.type].cat !== 'deco';
      const name = sel.k === 'n' ? nm(it) : 'ケーブル ' + (NZ.cableText(it) || '');
      el.innerHTML = `<span class="ab-msg">${esc(name)}</span>` +
        (canLink ? `<button data-ab="link" title="この機器から配線(L キー)→ 接続先をクリック">配線</button>` : '') +
        `<button data-ab="props" class="mobile-only">詳細</button>` +
        (sel.k === 'n' ? `<button data-ab="dup">複製</button>` : '') +
        `<button data-ab="del" class="danger">削除</button><button data-ab="close" title="選択解除" aria-label="選択解除">✕</button>`;
    }
    el.classList.toggle('on', !!el.innerHTML);
    el.querySelectorAll('[data-ab]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const a = b.dataset.ab;
      if (a === 'cancel') { linkFrom = null; setHint(); renderActbar(); }
      if (a === 'link') startLink();
      if (a === 'props') document.body.classList.add('show-side');
      if (a === 'dup') duplicate();
      if (a === 'del') removeSel();
      if (a === 'close') { sel = null; renderCanvasOnly(); renderProps(); renderBottom(); }
    }));
  }

  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  svg.addEventListener('dragover', (ev) => ev.preventDefault());
  svg.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const key = ev.dataTransfer.getData('text/plain');
    if (!key) return;
    const [gi, ii] = key.split(':').map(Number);
    const item = PALETTE[gi] && PALETTE[gi][1][ii];
    if (!item) return;
    const w = toWorld(ev);
    addNode(item[0], item[1], w.x, w.y);
  });

  /* ---------- キーボード ---------- */
  document.addEventListener('keydown', (ev) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !typing) { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y' && !typing) { ev.preventDefault(); redo(); return; }
    if (typing) return;
    if (ev.key === 'Escape') { tool = null; linkFrom = null; updateArmed(); setHint(); sel = null; render(); }
    if (ev.key.toLowerCase() === 'l' && sel && sel.k === 'n' && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); startLink(); }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel) { ev.preventDefault(); removeSel(); }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd' && sel && sel.k === 'n') { ev.preventDefault(); duplicate(); }
    if (sel && sel.k === 'n' && ev.key.startsWith('Arrow')) {
      ev.preventDefault();
      const n = nodeById(sel.id), s = ev.shiftKey ? 20 : GRID;
      snapshot();
      if (ev.key === 'ArrowLeft') n.x -= s; if (ev.key === 'ArrowRight') n.x += s;
      if (ev.key === 'ArrowUp') n.y -= s; if (ev.key === 'ArrowDown') n.y += s;
      render();
    }
  });
  function removeSel() {
    if (!sel) return;
    snapshot();
    if (sel.k === 'n') {
      model.nodes = model.nodes.filter((n) => n.id !== sel.id);
      model.edges = model.edges.filter((e) => e.from.n !== sel.id && e.to.n !== sel.id);
    } else {
      model.edges = model.edges.filter((e) => e.id !== sel.id);
    }
    sel = null;
    render();
  }
  function duplicate() {
    const n = nodeById(sel.id);
    snapshot();
    const c = JSON.parse(JSON.stringify(n));
    c.id = newId('n'); c.x += 60;
    if (c.p.tag) c.p.tag = '';
    model.nodes.push(c);
    // アウトレットの複製は、元と同じ上流から配線も複製する(横に並べて増やす用)
    if (NZ.isOutlet(n.type)) {
      model.edges.filter((e) => e.to.n === n.id).forEach((e) => {
        model.edges.push({ id: newId('e'), from: Object.assign({}, e.from), to: { n: c.id, p: e.to.p }, p: Object.assign({}, e.p) });
      });
    }
    sel = { k: 'n', id: c.id };
    render();
  }
  function pruneEdges(n) {
    const ids = new Set(NZ.ports(n).map((q) => q.id));
    model.edges = model.edges.filter((e) => !((e.from.n === n.id && !ids.has(e.from.p)) || (e.to.n === n.id && !ids.has(e.to.p))));
  }

  /* ---------- プロパティパネル ---------- */
  const F = (key, label, type = 'num', opt) => ({ key, label, type, opt });
  const H = (label) => ({ head: label });
  const NAME = F('name', '機器名', 'text');
  const LBL = F('label', '傍記(空欄で自動)', 'text');
  const MOUNT = F('mount', '取付', 'sel', [['wall', '壁付'], ['floor', '床付'], ['raised', '二重床']]);
  const SCHEMA = {
    onu: [NAME, LBL],
    rt: [NAME, LBL, F('ports', 'LANポート数')],
    fw: [NAME, LBL, F('ports', 'ポート数')],
    sw: [NAME, LBL, F('ports', 'ポート数(RJ45)'), F('sfp', 'SFPポート数'), F('l3', 'L3スイッチ', 'bool'),
      H('PoE'), F('poe', 'PoE給電', 'bool'), F('poeBudget', 'PoE給電容量 W'),
      H('識別子'), F('panel', '収容記号(空欄で機器名)', 'text')],
    hub: [NAME, LBL, F('ports', 'ポート数(アップリンク除く)'), H('PoE'), F('poe', 'PoE給電', 'bool'), F('poeBudget', 'PoE給電容量 W'),
      H('識別子'), F('panel', '収容記号(空欄で機器名)', 'text')],
    tv: [NAME, LBL],
    stb: [NAME, LBL],
    pp: [NAME, LBL, F('ports', 'ポート数'), F('panel', '収容記号(例: A)', 'text')],
    mdf: [NAME, LBL, F('panel', '収容記号', 'text')],
    pbx: [NAME, LBL],
    sv: [NAME, LBL, F('poeW', 'PoE消費 W')],
    outlet: [MOUNT, F('conn', '通信コネクタ数', 'sel', [[1, '1'], [2, '2'], [3, '3'], [4, '4']]), F('cat', '種類(傍記: 例 Cat6A)', 'text'),
      F('room', '室名', 'text'), F('tag', '識別子(空欄で自動採番)', 'text'), LBL],
    tel_outlet: [MOUNT, F('conn', '通信コネクタ数', 'sel', [[1, '1'], [2, '2']]), F('room', '室名', 'text'), F('tag', '識別子(空欄で自動採番)', 'text'), LBL],
    ap: [NAME, LBL, F('poeW', 'PoE消費 W')],
    cam: [NAME, LBL, F('poeW', 'PoE消費 W')],
    pc: [NAME, LBL, F('poeW', 'PoE消費 W')],
    prn: [NAME, LBL, F('poeW', 'PoE消費 W')],
    tel: [F('bt', 'ボタン電話機(BT)', 'bool'), F('poeW', 'PoE消費 W(IP電話)'), LBL],
    rack: [F('label', '名称', 'text'), F('w', '幅'), F('h', '高さ')],
    text: [F('text', 'テキスト', 'textarea'), F('size', '文字サイズ')],
  };
  const STRUCT_KEYS = new Set(['mount']);

  function fieldHtml(f, val) {
    const id = 'f_' + f.key;
    if (f.head) return `<h5>${f.head}</h5>`;
    switch (f.type) {
      case 'bool': return `<div class="field"><label for="${id}">${f.label}</label><input type="checkbox" id="${id}" data-key="${f.key}" ${val ? 'checked' : ''}></div>`;
      case 'sel': return `<div class="field"><label for="${id}">${f.label}</label><select id="${id}" data-key="${f.key}">${f.opt.map(([v, t]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
      case 'text': return `<div class="field wide"><label for="${id}">${f.label}</label><input type="text" id="${id}" data-key="${f.key}" value="${esc(val)}"></div>`;
      case 'textarea': return `<div class="field wide"><label for="${id}">${f.label}</label><textarea id="${id}" data-key="${f.key}" rows="3">${esc(val)}</textarea></div>`;
      default: return `<div class="field"><label for="${id}">${f.label}</label><input type="number" step="1" min="0" id="${id}" data-key="${f.key}" value="${esc(val)}"></div>`;
    }
  }
  const opts = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v.name}</option>`).join('');

  function renderProps() {
    renderActbar();
    const el = $('#props');
    if (!sel) { el.innerHTML = docSettingsHtml(); bindDocSettings(); return; }
    if (sel.k === 'e') {
      const e = edgeById(sel.id);
      if (!e) { sel = null; return renderProps(); }
      const a = nodeById(e.from.n), b = nodeById(e.to.n);
      const kind = (NZ.CABLES[e.p.cable] || {}).kind;
      el.innerHTML = `<h3>ケーブル</h3>
        <div class="note">${esc(nm(a))} → ${esc(nm(b))}</div>
        <div class="field"><label>種類</label><select data-ekey="cable">${opts(NZ.CABLES, e.p.cable)}</select></div>
        <div class="field"><label>${kind === 'fiber' ? '心数 (C)' : '本数'}</label><input type="number" min="1" step="1" data-ekey="qty" value="${e.p.qty}"></div>
        ${kind === 'tel' ? `<div class="field"><label>対数 (P)</label><input type="number" min="0" step="1" data-ekey="pairs" value="${esc(e.p.pairs)}"></div>` : ''}
        <div class="field"><label>長さ m</label><input type="number" step="1" min="0" data-ekey="len" value="${e.p.len}"></div>
        <div class="field"><label>配線方法(線種)</label><select data-ekey="method">${opts(NZ.METHODS, e.p.method)}</select></div>
        <div class="field wide"><label>配管・ラック(傍記: 例 E25, PF22, ケーブルラック)</label><input type="text" data-ekey="conduit" value="${esc(e.p.conduit)}"></div>
        <div class="note">傍記: <b>${esc(NZ.cableText(e) || '(なし)')}</b></div>
        <div class="btnrow"><button class="danger" data-act="del">削除</button></div>
        <div class="note">新しく配線したケーブルには、最後に設定した種類・長さ・配線方法が入ります。アウトレットへの本数は、コネクタ数に合わせて自動で入ります。</div>`;
      el.querySelectorAll('[data-ekey]').forEach((inp) => inp.addEventListener('change', () => {
        snapshot();
        const k = inp.dataset.ekey;
        e.p[k] = inp.type === 'number' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
        if (e.p.cable !== 'cord' && e.p.cable !== 'tel') lastCable = { cable: e.p.cable, qty: 1, len: e.p.len, method: e.p.method, conduit: e.p.conduit };
        render();
      }));
      el.querySelector('[data-act=del]').onclick = removeSel;
      return;
    }
    const n = nodeById(sel.id);
    if (!n) { sel = null; return renderProps(); }
    let html = `<h3>${esc(nm(n))}</h3>`;
    html += (SCHEMA[n.type] || []).map((f) => fieldHtml(f, f.head ? null : n.p[f.key])).join('');
    const u = res.usage[n.id];
    if (u) {
      html += `<h5>使用状況</h5><table class="grid levels">
        <tr><td class="l">ポート</td><td class="${u.utp > n.p.ports ? 'ng' : ''}">${u.utp} / ${n.p.ports}</td></tr>
        ${n.type === 'sw' ? `<tr><td class="l">SFP</td><td class="${u.sfp > n.p.sfp ? 'ng' : ''}">${u.sfp} / ${n.p.sfp}</td></tr>` : ''}
        ${hasPoe(n) ? `<tr><td class="l">PoE</td><td class="${u.poe > n.p.poeBudget ? 'ng' : ''}">${u.poe.toFixed(1)} / ${n.p.poeBudget} W</td></tr>` : ''}
        </table>`;
    }
    if (lab[n.id]) html += `<div class="note">収容: ${esc(nm(nodeById(lab[n.id].src)))} ポート ${lab[n.id].ports.join(', ')}<br>自動識別子: ${esc(lab[n.id].auto.join(' / '))}</div>`;
    html += `<div class="btnrow"><button data-act="dup">複製 (Ctrl+D)</button><button class="danger" data-act="del">削除</button></div>`;
    if (NZ.isOutlet(n.type)) html += `<div class="note">アウトレットを複製すると、同じ収容元からの配線も一緒に複製されます。</div>`;
    el.innerHTML = html;
    el.querySelectorAll('[data-key]').forEach((inp) => inp.addEventListener('change', () => {
      snapshot();
      const k = inp.dataset.key;
      let v = inp.type === 'checkbox' ? inp.checked : inp.value;
      if (inp.type === 'number' || (inp.tagName === 'SELECT' && v !== '' && !isNaN(Number(v)))) v = Number(v);
      n.p[k] = v;
      if (STRUCT_KEYS.has(k)) pruneEdges(n);
      render();
    }));
    el.querySelector('[data-act=del]').onclick = removeSel;
    el.querySelector('[data-act=dup]').onclick = duplicate;
  }

  function docSettingsHtml() {
    return `<h3>図面設定</h3>
      <div class="field wide"><label>図面名</label><input type="text" data-doc="title" value="${esc(model.title)}"></div>
      <div class="field wide"><label>作成者</label><input type="text" data-doc="author" value="${esc(model.author)}"></div>
      <div class="field"><label>日付</label><input type="date" data-doc="date" value="${esc(model.date)}"></div>
      <div class="field wide"><label>階(上から1行ずつ)</label><textarea data-doc="floors" rows="5">${esc(model.floors.join('\n'))}</textarea></div>
      <div class="field"><label>階の高さ(px)</label><input type="number" step="10" data-doc="laneH" value="${model.laneH}"></div>
      <div class="field wide"><label>識別子の書式</label><input type="text" data-doc="labelFmt" value="${esc(model.labelFmt)}"></div>
      <div class="note">{floor}=収容元の階、{panel}=収容記号、{port}=ポート番号(2桁)。例: <code>{floor}-{panel}-{port}</code> → 3F-B-01(TIA-606 の fs-an に準じた形)</div>
      <h5>使い方</h5>
      <div class="note">
        1. 左のパレットから部品を選んで図面上をクリック(ドラッグでも可)<br>
        2. 部品にマウスを乗せると端子が出ます。<b style="color:#ea580c">橙=出力</b>から<b style="color:#16a34a">緑=入力</b>へドラッグして配線。出力端子からは何本でも引けます<br>
        3. ケーブルをクリックすると種類・本数・長さ・配線方法(線種)・配管を設定できます<br>
        4. 下の「配線表」に、アウトレットごとの識別子・収容ポートが自動で出ます<br>
        <span class="kbd">Del</span> 削除 <span class="kbd">Ctrl+Z</span> 元に戻す <span class="kbd">Ctrl+D</span> 複製 <span class="kbd">矢印</span> 微移動
      </div>
      <div class="note">線種(JIS C 0303): 実線=天井隠ぺい / 破線=床隠ぺい / 点線=露出 / 一点鎖線=地中。太線=光ファイバ。</div>`;
  }
  function bindDocSettings() {
    $('#props').querySelectorAll('[data-doc]').forEach((inp) => inp.addEventListener('change', () => {
      snapshot();
      const k = inp.dataset.doc;
      if (k === 'floors') model.floors = inp.value.split('\n').map((s) => s.trim()).filter(Boolean);
      else if (k === 'laneH') model.laneH = Math.max(80, Number(inp.value) || 200);
      else model[k] = inp.value;
      render();
    }));
  }

  function renderWarnings() {
    const el = $('#warnings');
    const ws = res.warnings;
    const badge = $('#warnBadge');
    if (badge) { badge.textContent = ws.length ? String(ws.length) : ''; badge.classList.toggle('err', ws.some((w) => w.level === 'err')); }
    el.innerHTML = `<h3>チェック結果 <span class="mutedtxt" style="font-weight:400">(${ws.length}件)</span></h3>` +
      (ws.length ? ws.map((w, i) => `<div class="warn-item ${w.level}" data-wi="${i}">${esc(w.msg)}</div>`).join('') : `<div class="note ok">問題は見つかりませんでした。</div>`);
    el.querySelectorAll('[data-wi]').forEach((d) => d.addEventListener('click', () => {
      const w = ws[+d.dataset.wi];
      if (w.edge) sel = { k: 'e', id: w.edge };
      else if (w.node) sel = { k: 'n', id: w.node };
      if (w.node) centerOn(nodeById(w.node));
      render();
    }));
  }
  function centerOn(n) {
    if (!n) return;
    const r = svg.getBoundingClientRect();
    view.x = r.width / 2 - n.x * view.k;
    view.y = r.height / 2 - n.y * view.k;
    applyView();
  }

  /* ---------- 下部パネル ---------- */
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    activeTab = b.dataset.tab;
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tabpane').forEach((x) => x.classList.toggle('on', x.id === 'tab-' + activeTab));
    renderBottom();
  }));
  function renderBottom() {
    if (activeTab === 'table') { $('#tab-table').innerHTML = wiringTableHtml(true); bindRows('#tab-table'); }
    if (activeTab === 'ports') { $('#tab-ports').innerHTML = portsHtml(); bindRows('#tab-ports'); }
    if (activeTab === 'qty') $('#tab-qty').innerHTML = qtyHtml();
    if (activeTab === 'legend') $('#tab-legend').innerHTML = legendHtml();
  }
  function bindRows(pane) {
    $(pane).querySelectorAll('[data-oid]').forEach((tr) => tr.addEventListener('click', () => {
      sel = { k: 'n', id: tr.dataset.oid };
      centerOn(nodeById(sel.id));
      render();
    }));
  }
  // 配線表(パッチ表): コネクタ1口 = 1行
  function wiringRows() {
    const rows = [];
    model.nodes.filter((n) => NZ.isOutlet(n.type)).sort((a, b) => (a.y - b.y) || (a.x - b.x)).forEach((n) => {
      const L = lab[n.id];
      const e = res.inE.get(n.id)[0];
      const src = L ? nodeById(L.src) : null;
      const k = Math.max(1, +n.p.conn || 1);
      const end = res.outE.get(n.id).map((x) => nm(nodeById(x.to.n))).join(', ');
      for (let i = 0; i < k; i++) {
        rows.push({ n, i, id: L ? (n.p.tag ? `${n.p.tag}${k > 1 ? '-' + (i + 1) : ''}` : L.auto[i]) : '(未接続)',
          src: src ? `${nm(src)}(${floorOf(src)})` : '—', port: L ? L.ports[i] : '—',
          cable: e ? (NZ.CABLES[e.p.cable] || {}).name : '—', len: e ? e.p.len : '', method: e ? (NZ.METHODS[e.p.method] || {}).name : '',
          conduit: e ? e.p.conduit : '', end });
      }
    });
    return rows;
  }
  function wiringTableHtml(interactive) {
    const rows = wiringRows();
    if (!rows.length) return `<div class="note">アウトレットがまだありません。</div>`;
    return `<div class="note">アウトレット ${new Set(rows.map((r) => r.n.id)).size} 箇所 / コネクタ ${rows.length} 口。識別子は収容元(パッチパネル、なければスイッチ)ごとに、上の階・左から順に振っています。</div>
      <table class="grid"><tr><th>識別子</th><th>階</th><th>室名</th><th>種別</th><th>口</th><th>収容元</th><th>ポート</th><th>ケーブル</th><th>長さ m</th><th>配線方法</th><th>配管</th><th>接続機器</th></tr>
      ${rows.map((r) => `<tr class="${interactive ? 'clickable' : ''}${sel && sel.id === r.n.id ? ' selrow' : ''}" data-oid="${r.n.id}">
        <td class="l"><b>${esc(r.id)}</b></td><td class="c">${esc(floorOf(r.n))}</td><td class="l">${esc(r.n.p.room)}</td>
        <td class="l">${esc(nm(r.n))}</td><td class="c">${r.i + 1}/${r.n.p.conn}</td><td class="l">${esc(r.src)}</td><td class="c">${r.port}</td>
        <td class="l">${esc(r.cable)}</td><td class="${+r.len > NZ.UTP_MAX ? 'ng' : ''}">${esc(r.len)}</td><td class="c">${esc(r.method)}</td><td class="l">${esc(r.conduit)}</td><td class="l">${esc(r.end)}</td></tr>`).join('')}
      </table>`;
  }
  const hasPoe = (n) => (n.type === 'sw' || n.type === 'hub') && n.p.poe;
  function portData() {
    return model.nodes.filter((n) => res.usage[n.id]).sort((a, b) => (a.y - b.y) || (a.x - b.x)).map((n) => {
      const u = res.usage[n.id];
      return { n, u, floor: floorOf(n), ports: +n.p.ports, sfp: n.type === 'sw' ? +n.p.sfp : null,
        poeCap: hasPoe(n) ? +n.p.poeBudget : null, poeDev: u.poeDev.map((id) => nm(nodeById(id))).join(', ') };
    });
  }
  function portsHtml() {
    const ds = portData();
    if (!ds.length) return `<div class="note">スイッチ・パッチパネルがまだありません。</div>`;
    const cell = (used, cap, unit = '') => `<td class="${used > cap ? 'ng' : ''}">${used}${unit} / ${cap}${unit} <span class="mutedtxt">(空き ${Math.max(0, cap - used)})</span></td>`;
    const dash = '<td class="c mutedtxt">—</td>';
    return `<table class="grid"><tr><th>機器</th><th>階</th><th>ポート(RJ45)</th><th>SFP</th><th>PoE 給電</th><th>PoE 機器</th></tr>
      ${ds.map((d) => `<tr class="clickable" data-oid="${d.n.id}"><td class="l">${esc(nm(d.n))}</td><td class="c">${esc(d.floor)}</td>${cell(d.u.utp, d.ports)}
          ${d.sfp != null ? cell(d.u.sfp, d.sfp) : dash}
          ${d.poeCap != null ? `<td class="${d.u.poe > d.poeCap ? 'ng' : ''}">${d.u.poe.toFixed(1)} / ${d.poeCap} W</td>` : dash}
          <td class="l">${esc(d.poeDev)}</td></tr>`).join('')}</table>
      <div class="note">ポート数は、その機器につながるケーブルの本数(光は1リンク=SFP 1ポート、ハブのアップリンクは除く)で数えています。PoE はアウトレット・パッチパネルを通り越して、最初の能動機器から給電するとして集計します。</div>`;
  }
  function qtyData() {
    const cab = {};
    model.edges.forEach((e) => {
      const c = NZ.CABLES[e.p.cable] || {};
      if (c.kind === 'cord') return;
      const key = c.name + (c.kind === 'fiber' ? ` ${e.p.qty}C` : '');
      cab[key] = cab[key] || { runs: 0, len: 0 };
      const mult = c.kind === 'fiber' ? 1 : Math.max(1, +e.p.qty || 1);
      cab[key].runs += mult;
      cab[key].len += mult * (+e.p.len || 0);
    });
    const dev = {};
    model.nodes.forEach((n) => {
      if (NZ.TYPES[n.type].cat === 'deco') return;
      let k = NZ.TYPES[n.type].name;
      if (n.type === 'outlet' || n.type === 'tel_outlet') k = nm(n) + `(${n.p.conn}口)`;
      if (n.type === 'sw') k = `${n.p.l3 ? 'L3' : ''}${n.p.poe ? 'PoE' : ''}スイッチ ${n.p.ports}P`;
      if (n.type === 'hub') k = `${n.p.poe ? 'PoE' : ''}ハブ ${n.p.ports}P`;
      dev[k] = (dev[k] || 0) + 1;
    });
    return { cab: Object.entries(cab), dev: Object.entries(dev).sort() };
  }
  function qtyHtml() {
    const { cab, dev } = qtyData();
    return `<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">
      <table class="grid"><tr><th>ケーブル</th><th>条数</th><th>延長 m</th></tr>
      ${cab.map(([k, v]) => `<tr><td class="l">${esc(k)}</td><td>${v.runs}</td><td>${v.len.toFixed(0)}</td></tr>`).join('') || '<tr><td colspan="3" class="c mutedtxt">なし</td></tr>'}</table>
      <table class="grid"><tr><th>機器</th><th>数量</th></tr>
      ${dev.map(([k, v]) => `<tr><td class="l">${esc(k)}</td><td>${v}</td></tr>`).join('')}</table></div>
      <div class="note">延長は図面に入れた長さ×本数の合計です(余長・パッチコードは含みません)。</div>`;
  }
  function legendHtml() {
    const items = NZ.LEGEND.map((l) => `<div class="legend-item">${iconSvg(l.type, l.p, 44)}<div>${l.name}<small>${l.note}</small></div></div>`).join('');
    const line = (m) => `<div class="legend-item"><svg width="60" height="20"><line x1="2" y1="10" x2="58" y2="10" stroke="#111827" stroke-width="1.3" ${m.dash ? `stroke-dasharray="${m.dash}"` : ''}/></svg><div>${m.name}配線</div></div>`;
    return `<div class="note">図記号は 国土交通省「公共建築設備工事標準図(電気設備工事編)」p.11 と JIS C 0303 に従っています。JIS に記号がない機器(ONU・FW・AP など)は、四角に略号で表しています。</div>
      <div class="legend-grid">${items}</div>
      <div class="legend-grid">${Object.values(NZ.METHODS).map(line).join('')}
      <div class="legend-item"><svg width="60" height="20"><line x1="2" y1="10" x2="58" y2="10" stroke="#111827" stroke-width="2.4"/></svg><div>光ファイバ(太線)</div></div></div>
      <div class="note">チェック内容: UTP 水平配線 90m 超(JIS X 5150)/100m 超、MM 光 300m 超、ポート数・SFP 数の不足、PoE 給電容量の超過・非対応 SW からの給電、アウトレットのコネクタ数とケーブル本数の不一致、未接続。</div>`;
  }

  /* ---------- 出力 ---------- */
  function exportSvgString() {
    const b = bounds();
    const pad = 20, tbH = 70;
    const W = b.w + pad * 2, Hh = b.h + pad * 2 + tbH;
    const saveSel = sel; sel = null;
    const body = drawing(false);
    sel = saveSel;
    const tbW = 420, tx = b.x + b.w - tbW, ty = b.h + 12;
    const tb = `<g font-size="12" fill="#111827">
      <rect x="${tx}" y="${ty}" width="${tbW}" height="${tbH - 16}" fill="#fff" stroke="#111827" stroke-width="1"/>
      <line x1="${tx}" y1="${ty + 27}" x2="${tx + tbW}" y2="${ty + 27}" stroke="#111827" stroke-width="0.8"/>
      <line x1="${tx + 280}" y1="${ty}" x2="${tx + 280}" y2="${ty + tbH - 16}" stroke="#111827" stroke-width="0.8"/>
      <text x="${tx + 8}" y="${ty + 18}" font-weight="700">${esc(model.title)}</text>
      <text x="${tx + 8}" y="${ty + 45}">構内情報通信網 系統図</text>
      <text x="${tx + 288}" y="${ty + 18}">${esc(model.date)}</text>
      <text x="${tx + 288}" y="${ty + 45}">${esc(model.author)}</text></g>`;
    const lg = Object.values(NZ.METHODS).map((m, i) => `<line x1="${b.x + 10 + i * 110}" y1="${b.h + 30}" x2="${b.x + 50 + i * 110}" y2="${b.h + 30}" stroke="#111827" stroke-width="1.3" ${m.dash ? `stroke-dasharray="${m.dash}"` : ''}/><text x="${b.x + 55 + i * 110}" y="${b.h + 34}" font-size="10.5" fill="#111827">${m.name}</text>`).join('') +
      `<line x1="${b.x + 450}" y1="${b.h + 30}" x2="${b.x + 490}" y2="${b.h + 30}" stroke="#111827" stroke-width="2.4"/><text x="${b.x + 495}" y="${b.h + 34}" font-size="10.5" fill="#111827">光ファイバ</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="${b.x - pad} ${-pad} ${W} ${Hh}" font-family="Yu Gothic UI, Meiryo, sans-serif">` +
      `<rect x="${b.x - pad}" y="${-pad}" width="${W}" height="${Hh}" fill="#fff"/>${body}${lg}${tb}</svg>`;
  }
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const fname = (ext) => `${(model.title || 'LAN配線系統図').replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;
  function exportPng() {
    const s = exportSvgString();
    const img = new Image();
    const m = s.match(/width="([\d.]+)" height="([\d.]+)"/);
    const W = +m[1], Hh = +m[2], scale = 2;
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = W * scale; c.height = Hh * scale;
      const ctx = c.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      c.toBlob((bl) => download(fname('png'), bl), 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  }
  function exportCsv() {
    const rows = wiringRows();
    const head = ['識別子', '階', '室名', '種別', '口', '収容元', 'ポート', 'ケーブル', '長さm', '配線方法', '配管', '接続機器'];
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const body = rows.map((r) => [r.id, floorOf(r.n), r.n.p.room, nm(r.n), `${r.i + 1}/${r.n.p.conn}`, r.src, r.port, r.cable, r.len, r.method, r.conduit, r.end].map(q).join(','));
    download(fname('csv').replace(/\.csv$/, '_配線表.csv'), new Blob(['﻿' + [head.map(q).join(','), ...body].join('\r\n')], { type: 'text/csv' }));
  }
  function exportXlsx() {
    const t = model.title || 'LAN配線系統図';
    const w = wiringRows().map((r) => {
      const row = [r.id, floorOf(r.n), r.n.p.room, nm(r.n), `${r.i + 1}/${r.n.p.conn}`, r.src, typeof r.port === 'number' ? r.port : r.port, r.cable,
        r.len === '' ? '' : +r.len, r.method, r.conduit, r.end];
      if (+r.len > NZ.UTP_MAX) row._red = [8];
      return row;
    });
    const p = portData().map((d) => {
      const row = [nm(d.n), d.floor, d.u.utp, d.ports, Math.max(0, d.ports - d.u.utp), d.sfp == null ? '' : d.u.sfp, d.sfp == null ? '' : d.sfp,
        d.poeCap == null ? '' : +d.u.poe.toFixed(1), d.poeCap == null ? '' : d.poeCap, d.poeDev];
      row._red = [d.u.utp > d.ports ? 2 : -1, d.sfp != null && d.u.sfp > d.sfp ? 5 : -1, d.poeCap != null && d.u.poe > d.poeCap ? 7 : -1];
      return row;
    });
    const q = qtyData();
    const sheets = [
      { name: '配線表', title: `${t} 配線表(${model.date})`, widths: [16, 6, 12, 26, 6, 24, 7, 16, 8, 11, 14, 20],
        header: ['識別子', '階', '室名', '種別', '口', '収容元', 'ポート', 'ケーブル', '長さ m', '配線方法', '配管', '接続機器'], rows: w },
      { name: 'ポート・PoE集計', title: `${t} ポート・PoE集計`, widths: [26, 6, 8, 8, 8, 8, 8, 10, 10, 40],
        header: ['機器', '階', '使用ポート', 'ポート数', '空き', '使用SFP', 'SFP数', 'PoE 使用 W', 'PoE 容量 W', 'PoE 機器'], rows: p },
      { name: 'ケーブル数量', title: `${t} ケーブル数量`, widths: [28, 10, 12],
        header: ['ケーブル', '条数', '延長 m'], rows: q.cab.map(([k, v]) => [k, v.runs, Math.round(v.len)]) },
      { name: '機器数量', title: `${t} 機器数量`, widths: [34, 10], header: ['機器', '数量'], rows: q.dev.map(([k, v]) => [k, v]) },
      { name: 'チェック結果', title: `${t} チェック結果`, widths: [8, 90], header: ['区分', '内容'],
        rows: res.warnings.map((x) => [x.level === 'err' ? 'エラー' : '注意', x.msg]) },
    ];
    download(fname('xlsx'), window.NZX.build(sheets));
  }
  function doPrint() {
    $('#print').innerHTML = exportSvgString() + `<h2>配線表</h2>` + wiringTableHtml(false);
    window.print();
  }

  /* ---------- ツールバー ---------- */
  const ACTIONS = {
    new: () => { if (!confirm('現在の図面を破棄して新規作成しますか?(保存していない変更は失われます)')) return; snapshot(); model = blank(); sel = null; render(); fit(); },
    open: () => $('#fileInput').click(),
    save: () => download(fname('json'), new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' })),
    sample: () => { if (!confirm('サンプルを読み込みますか?(現在の図面は置き換わります。元に戻すで戻せます)')) return; snapshot(); model = normalize(NZ.sample()); sel = null; render(); fit(); },
    undo, redo, fit,
    zoomin: () => { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.2); },
    zoomout: () => { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.2); },
    svg: () => download(fname('svg'), new Blob([exportSvgString()], { type: 'image/svg+xml' })),
    png: exportPng,
    csv: exportCsv,
    xlsx: exportXlsx,
    side: () => document.body.classList.toggle('show-side'),
    bottom: () => { document.body.classList.toggle('show-bottom'); renderBottom(); },
    print: doPrint,
  };
  document.querySelectorAll('#toolbar [data-act]').forEach((b) => b.addEventListener('click', () => ACTIONS[b.dataset.act]()));
  $('#fileInput').addEventListener('change', (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    f.text().then((t) => {
      try { snapshot(); model = normalize(JSON.parse(t)); sel = null; render(); fit(); }
      catch (e) { alert('ファイルを読み込めませんでした: ' + e.message); }
    });
    ev.target.value = '';
  });
  $('#docTitle').addEventListener('change', (ev) => { snapshot(); model.title = ev.target.value; render(); });
  [['showLabel', 'label'], ['showCable', 'cable'], ['showRoom', 'room']].forEach(([id, k]) => {
    $('#' + id).addEventListener('change', (ev) => { show[k] = ev.target.checked; renderCanvasOnly(); });
  });
  window.addEventListener('resize', () => applyView());
  $('#sideClose').addEventListener('click', () => document.body.classList.remove('show-side'));

  buildPalette();
  setHint();
  render();
  requestAnimationFrame(fit);

  window.NZApp = { get model() { return model; }, get res() { return res; }, get labels() { return lab; },
    select: (id) => { sel = { k: 'n', id }; render(); }, exportSvg: () => exportSvgString() };
})();
