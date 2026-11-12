/* LAN配線系統図ツール: 図記号・ケーブル定義・チェック/集計エンジン
 * 出典: 国交省 公共建築設備工事標準図(電気設備工事編)令和4年版 p.11(構内情報通信網装置/構内交換装置)、
 *       JIS C 0303(配線用図記号・線種)、JIS X 5150(水平配線 90m)、TIA-606-C(識別子)
 */
'use strict';

const NZ = {};

/* ---------- ケーブル ---------- */
NZ.CABLES = {
  cat6a: { name: 'UTP Cat6A', short: 'Cat6A', kind: 'utp' },
  cat6: { name: 'UTP Cat6', short: 'Cat6', kind: 'utp' },
  cat5e: { name: 'UTP Cat5e', short: 'Cat5e', kind: 'utp' },
  sm: { name: '光ファイバ SM', short: '光SM', kind: 'fiber' },
  mm: { name: '光ファイバ MM(OM3)', short: '光MM', kind: 'fiber', max: 300 },
  tel: { name: '構内ケーブル(電話)', short: '電話', kind: 'tel' },
  cord: { name: 'パッチコード/盤内', short: 'コード', kind: 'cord' },
};
NZ.METHODS = {
  ceil: { name: '天井隠ぺい', dash: '' },
  floor: { name: '床隠ぺい', dash: '9 4' },
  exp: { name: '露出', dash: '1.5 3' },
  ug: { name: '地中', dash: '12 3 2 3' },
};
NZ.UTP_MAX = 90;       // JIS X 5150 水平配線(パーマネントリンク)
NZ.UTP_ABS = 100;      // チャネル(パッチコード込み)

/* ---------- 機器 ---------- */
// cat: active=能動機器(ポート集計の対象), passive=中継(アウトレット・パッチパネル), end=末端機器, deco=装飾
NZ.TYPES = {
  onu: { name: 'ONU(回線終端装置)', cat: 'active', box: 'ONU', w: 40, defaults: { name: 'ONU', label: '' } },
  rt: { name: 'ルータ', cat: 'active', box: 'RT', w: 36, defaults: { name: 'RT', label: '', ports: 4 } },
  fw: { name: 'ファイアウォール', cat: 'active', box: 'FW', w: 36, defaults: { name: 'FW', label: '', ports: 8 } },
  sw: { name: 'スイッチ', cat: 'active', box: 'SW', w: 36,
    defaults: { name: 'SW', label: '', ports: 24, sfp: 4, poe: false, poeBudget: 370, l3: false, panel: '' } },
  hub: { name: 'ハブ', cat: 'active', box: 'HUB', w: 40,
    defaults: { name: 'HUB', label: '', ports: 8, poe: false, poeBudget: 60, panel: '' } },
  pp: { name: 'パッチパネル', cat: 'passive', box: 'PP', w: 36, defaults: { name: 'PP', label: '', ports: 24, panel: 'A' } },
  mdf: { name: '本配線盤', cat: 'passive', box: 'MDF', w: 42, defaults: { name: 'MDF', label: '' } },
  pbx: { name: '交換装置', cat: 'active', box: 'PBX', w: 42, defaults: { name: 'PBX', label: '' } },
  sv: { name: 'サーバー', cat: 'end', box: 'SV', w: 36, defaults: { name: 'SV', label: '', poeW: 0 } },
  outlet: { name: '情報用アウトレット', cat: 'passive', defaults: { mount: 'wall', conn: 1, cat: '', label: '', room: '', tag: '' } },
  tel_outlet: { name: '電話用アウトレット', cat: 'passive', defaults: { mount: 'wall', conn: 1, label: '', room: '', tag: '' } },
  ap: { name: '無線AP', cat: 'end', box: 'AP', w: 30, defaults: { name: 'AP', label: '', poeW: 25.5 } },
  cam: { name: 'ネットワークカメラ', cat: 'end', box: 'CAM', w: 38, defaults: { name: 'CAM', label: '', poeW: 12.95 } },
  pc: { name: 'PC・端末', cat: 'end', box: 'PC', w: 30, defaults: { name: 'PC', label: '', poeW: 0 } },
  prn: { name: '複合機', cat: 'end', box: 'MFP', w: 38, defaults: { name: 'MFP', label: '', poeW: 0 } },
  tv: { name: 'テレビ', cat: 'end', box: 'TV', w: 30, defaults: { name: 'TV', label: '', poeW: 0 } },
  stb: { name: 'STB', cat: 'end', box: 'STB', w: 38, defaults: { name: 'STB', label: '', poeW: 0 } },
  tel: { name: '内線電話機', cat: 'end', defaults: { name: '', label: '', bt: false, poeW: 0 } },
  rack: { name: 'ラック・盤', cat: 'deco', defaults: { label: 'ラック', w: 240, h: 90 } },
  text: { name: 'テキスト', cat: 'deco', defaults: { text: 'テキスト', size: 13 } },
};
NZ.isBox = (t) => !!(NZ.TYPES[t] && NZ.TYPES[t].box);
NZ.isOutlet = (t) => t === 'outlet' || t === 'tel_outlet';

NZ.displayName = function (n) {
  const T = NZ.TYPES[n.type];
  if (n.type === 'outlet') return { wall: '壁付', floor: '床付', raised: '二重床' }[n.p.mount] + '情報用アウトレット';
  if (n.type === 'tel_outlet') return { wall: '壁付', floor: '床付', raised: '二重床' }[n.p.mount] + '電話用アウトレット';
  if (n.type === 'hub') return (n.p.poe ? 'PoE' : '') + 'ハブ ' + (n.p.name || '');
  if (n.type === 'sw') return (n.p.l3 ? 'L3' : '') + (n.p.poe ? 'PoE' : '') + 'スイッチ ' + (n.p.name || '');
  if (T.box) return T.name + ' ' + (n.p.name || '');
  return T.name;
};

/* 傍記 (JIS: 通信コネクタ1個以外及び種類は傍記) */
NZ.annotation = function (n) {
  const p = n.p;
  if (p.label) return p.label;
  switch (n.type) {
    case 'sw': return [p.name, `${p.ports}P`, p.sfp ? `SFP${p.sfp}` : '', p.l3 ? 'L3' : '', p.poe ? 'PoE' : ''].filter(Boolean).join(' ');
    case 'pp': return `${p.name} ${p.ports}P`;
    case 'hub': return [p.name, `${p.ports}P`, p.poe ? 'PoE' : ''].filter(Boolean).join(' ');
    case 'outlet': return [+p.conn !== 1 ? String(p.conn) : '', p.cat].filter(Boolean).join(' ');
    case 'tel_outlet': return +p.conn !== 1 ? String(p.conn) : '';
    case 'tel': return p.bt ? 'BT' : '';
    case 'rack': case 'text': return '';
    default: return p.name && p.name !== NZ.TYPES[n.type].box ? p.name : '';
  }
};

/* ---------- 端子 ---------- */
NZ.DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
NZ.ports = function (n) {
  const P = (id, x, y, dir, kind) => ({ id, x, y, dir, kind });
  const T = NZ.TYPES[n.type];
  if (!T || T.cat === 'deco') return [];
  if (T.box) {
    const hw = T.w / 2;
    if (T.cat === 'end') return [P('in', 0, -10, 'up', 'in'), P('inL', -hw, 0, 'left', 'in')];
    return [P('in', 0, -10, 'up', 'in'), P('inL', -hw, 0, 'left', 'in'), P('out', 0, 10, 'down', 'out'), P('outR', hw, 0, 'right', 'out')];
  }
  if (n.type === 'tel') return [P('in', 0, -9, 'up', 'in'), P('inL', -9, 0, 'left', 'in')];
  // アウトレット
  const bottom = n.p.mount === 'floor' ? 13 : n.p.mount === 'raised' ? 13 : 8;
  return [P('in', 0, n.p.mount === 'raised' ? -10 : -8, 'up', 'in'), P('inL', n.p.mount === 'raised' ? -10 : -8, 0, 'left', 'in'),
    P('out', 0, bottom, 'down', 'out')];
};
NZ.port = (n, id) => NZ.ports(n).find((q) => q.id === id);

/* ---------- 図記号 (中心 0,0) ---------- */
NZ.symbol = function (n) {
  const T = NZ.TYPES[n.type];
  const st = 'fill="none" stroke="#111827" stroke-width="1.4"';
  if (T.box) {
    const w = T.w, h = 20;
    return `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="#fff" stroke="#111827" stroke-width="1.4"/>` +
      `<text x="0" y="4" font-size="10" text-anchor="middle" fill="#111827" stroke="none" font-family="Times New Roman, serif">${T.box}</text>`;
  }
  const mount = n.p.mount;
  const base = mount === 'raised'
    ? `<rect x="-10" y="-10" width="20" height="23" ${st}/><line x1="-10" y1="10" x2="10" y2="10" ${st}/>`
    : mount === 'floor' ? `<polygon points="0,8 -7,13 7,13" fill="#111827" stroke="none"/>` : '';
  const wall = mount === 'wall' ? `<path d="M0,-8 A8,8 0 0,0 0,8 A4.5,8 0 0,1 0,-8Z" fill="#111827" stroke="none"/>` : '';
  if (n.type === 'outlet') return base + `<circle r="8" ${st}/>` + wall + `<rect x="-2.6" y="-5" width="5.2" height="10" fill="#111827" stroke="none"/>`;
  if (n.type === 'tel_outlet') return base + `<circle r="8" ${st}/>` + wall + `<circle r="3.6" fill="#111827" stroke="none"/>`;
  if (n.type === 'tel') return `<circle r="9" ${st}/><line x1="-5" y1="-4" x2="5" y2="-4" ${st}/><line x1="0" y1="-4" x2="0" y2="6" ${st}/>`;
  return '';
};

NZ.LEGEND = [
  { type: 'rt', p: {}, name: 'ルータ', note: 'JIS/国交省 RT', jis: true },
  { type: 'sw', p: {}, name: 'スイッチ', note: 'JIS/国交省 SW。ポート数・PoE は傍記', jis: true },
  { type: 'outlet', p: { mount: 'wall' }, name: '情報用アウトレット(壁付)', note: '壁付の形は JIS 本文で要確認', jis: true },
  { type: 'outlet', p: { mount: 'floor' }, name: '情報用アウトレット(床付)', note: '国交省標準図 p.11', jis: true },
  { type: 'outlet', p: { mount: 'raised' }, name: '二重床情報アウトレット', note: '国交省標準図 p.11', jis: true },
  { type: 'tel_outlet', p: { mount: 'wall' }, name: '壁付電話用アウトレット', note: '国交省標準図 p.11', jis: true },
  { type: 'tel', p: {}, name: '内線電話機', note: '傍記 BT=ボタン電話機', jis: true },
  { type: 'mdf', p: {}, name: '本配線盤', note: 'JIS/国交省 MDF', jis: true },
  { type: 'pbx', p: {}, name: '交換装置', note: 'JIS/国交省 PBX', jis: true },
  { type: 'onu', p: {}, name: 'ONU', note: '略号表記(JIS外)' },
  { type: 'fw', p: {}, name: 'ファイアウォール', note: '略号表記(JIS外)' },
  { type: 'pp', p: {}, name: 'パッチパネル', note: '略号表記(JIS外)' },
  { type: 'ap', p: {}, name: '無線AP', note: '略号表記(JIS外)' },
  { type: 'cam', p: {}, name: 'ネットワークカメラ', note: '略号表記(JIS外)' },
  { type: 'hub', p: {}, name: 'ハブ', note: '略号表記(JIS外)。ポート数は傍記' },
  { type: 'tv', p: {}, name: 'テレビ', note: '略号表記(JIS外)' },
  { type: 'stb', p: {}, name: 'STB(セットトップボックス)', note: '略号表記(JIS外)' },
  { type: 'sv', p: {}, name: 'サーバー', note: '略号表記(JIS外)' },
  { type: 'pc', p: {}, name: 'PC・端末', note: '略号表記(JIS外)' },
  { type: 'prn', p: {}, name: '複合機', note: '略号表記(JIS外)' },
];

/* ---------- ケーブル傍記 ---------- */
NZ.cableText = function (e, withLen = true) {
  const c = NZ.CABLES[e.p.cable] || NZ.CABLES.cat6a;
  if (c.kind === 'cord') return '';
  const q = +e.p.qty || 1;
  let s = c.kind === 'fiber' ? `${c.short} ${q}C` : c.kind === 'tel' ? `${c.short}${e.p.pairs ? ` ${e.p.pairs}P` : ''}${q > 1 ? `×${q}` : ''}` : `${c.short}${q > 1 ? `×${q}` : ''}`;
  if (e.p.conduit) s += ` (${e.p.conduit})`;
  if (withLen && +e.p.len) s += ` ${e.p.len}m`;
  return s;
};
// そのケーブルで使うポート数 (UTP/電話は本数、光は1リンク)
NZ.linkCount = (e) => {
  const k = (NZ.CABLES[e.p.cable] || {}).kind;
  return k === 'fiber' ? 1 : Math.max(1, +e.p.qty || 1);
};

/* ---------- 計算・チェック ---------- */
NZ.compute = function (model) {
  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const inE = new Map(), outE = new Map();
  model.nodes.forEach((n) => { inE.set(n.id, []); outE.set(n.id, []); });
  model.edges.forEach((e) => {
    if (!nodes.has(e.from.n) || !nodes.has(e.to.n)) return;
    outE.get(e.from.n).push(e); inE.get(e.to.n).push(e);
  });
  const warnings = [];
  const W = (level, node, msg, edge) => warnings.push({ level, node, edge, msg });
  const nm = (n) => NZ.displayName(n).trim();
  const floorOf = (n) => model.floors[Math.floor(n.y / model.laneH)] || '-';

  // 上流をたどって最初の能動機器/パッチパネルを探す
  const upstream = (id, pred) => {
    const seen = new Set();
    let cur = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const e = inE.get(cur)[0];
      if (!e) return null;
      const u = nodes.get(e.from.n);
      if (pred(u)) return { node: u, edge: e };
      cur = u.id;
    }
    return null;
  };

  // ポート集計
  const usage = {};
  model.nodes.forEach((n) => {
    if (!['sw', 'hub', 'pp', 'rt', 'fw'].includes(n.type)) return;
    const u = { utp: 0, sfp: 0, poe: 0, poeDev: [] };
    // パッチパネルは前面(アウトレット側)のポートだけ数える。背面からの SW 接続は同じポートの裏側
    const es = n.type === 'pp' ? outE.get(n.id) : [...outE.get(n.id), ...inE.get(n.id)];
    es.forEach((e) => {
      const k = (NZ.CABLES[e.p.cable] || {}).kind;
      if (k === 'fiber' && n.type === 'sw') u.sfp += 1;
      else if (n.type === 'hub' && e.to.n === n.id) return; // ハブのアップリンクはポート数に含めない(専用ポートの機種が多い)
      else u.utp += NZ.linkCount(e);
    });
    usage[n.id] = u;
  });

  // PoE 給電元
  const poeSrc = {};
  model.nodes.forEach((n) => {
    if (!(+n.p.poeW > 0)) return;
    const s = upstream(n.id, (u) => NZ.TYPES[u.type].cat === 'active');
    if (!s) return;
    poeSrc[n.id] = s.node.id;
    if ((s.node.type === 'sw' || s.node.type === 'hub') && s.node.p.poe) {
      usage[s.node.id].poe += +n.p.poeW;
      usage[s.node.id].poeDev.push(n.id);
    } else W('err', n.id, `${nm(n)}(${floorOf(n)}): PoE 給電が必要(${n.p.poeW}W)ですが、上流の ${nm(s.node)} は PoE 非対応です`);
  });

  model.nodes.forEach((n) => {
    const T = NZ.TYPES[n.type];
    if (T.cat === 'deco') return;
    const u = usage[n.id];
    if (u) {
      if (u.utp > +n.p.ports) W('err', n.id, `${nm(n)}: ポート不足(使用 ${u.utp} / ${n.p.ports})`);
      if (n.type === 'sw' && u.sfp > +n.p.sfp) W('err', n.id, `${nm(n)}: SFP ポート不足(使用 ${u.sfp} / ${n.p.sfp})`);
      if ((n.type === 'sw' || n.type === 'hub') && n.p.poe && u.poe > +n.p.poeBudget) W('err', n.id, `${nm(n)}: PoE 給電容量オーバー(${u.poe.toFixed(1)}W / ${n.p.poeBudget}W)`);
    }
    if (NZ.isOutlet(n.type)) {
      const inc = inE.get(n.id).reduce((s, e) => s + NZ.linkCount(e), 0);
      if (!inc) W('warn', n.id, `${nm(n)}(${floorOf(n)}): 配線がつながっていません`);
      else if (inc !== +n.p.conn) W('warn', n.id, `${nm(n)}(${floorOf(n)}): コネクタ ${n.p.conn} 個に対し、ケーブル ${inc} 本`);
    } else if (T.cat !== 'deco' && n.type !== 'onu' && !inE.get(n.id).length && !outE.get(n.id).length) {
      W('warn', n.id, `${nm(n)}(${floorOf(n)}): どこにも接続されていません`);
    }
  });

  model.edges.forEach((e) => {
    const c = NZ.CABLES[e.p.cable] || {};
    const a = nodes.get(e.from.n), b = nodes.get(e.to.n);
    if (!a || !b) return;
    const len = +e.p.len || 0;
    const where = `${nm(a)} → ${nm(b)}`;
    if (c.kind === 'utp') {
      if (len > NZ.UTP_ABS) W('err', b.id, `${where}: UTP ${len}m は 100m を超えています`, e.id);
      else if (len > NZ.UTP_MAX) W('warn', b.id, `${where}: UTP ${len}m は水平配線の上限 90m(JIS X 5150)を超えています`, e.id);
    }
    if (c.max && len > c.max) W('warn', b.id, `${where}: ${c.name} ${len}m は 10GBASE-SR の目安 ${c.max}m を超えています`, e.id);
    if (c.kind === 'fiber' && (NZ.isOutlet(b.type) || NZ.TYPES[b.type].cat === 'end')) {
      W('warn', b.id, `${where}: 光ファイバで端末側に接続しています(UTP の誤りではないか確認)`, e.id);
    }
  });

  return { inE, outE, usage, poeSrc, warnings };
};

/* ---------- 識別子(ラベル)自動採番: TIA-606 の fs-an に準じる ---------- */
// 収容元 = 上流で最初に見つかるパッチパネル(なければスイッチ)。収容元ごとに、階(上→下)・X 順でポートを振る
NZ.labels = function (model, res) {
  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const floorOf = (n) => model.floors[Math.floor(n.y / model.laneH)] || '-';
  const fmt = model.labelFmt || '{floor}-{panel}-{port}';
  const out = {};
  const groups = new Map();
  const ordered = model.nodes.filter((n) => NZ.isOutlet(n.type)).sort((a, b) => (a.y - b.y) || (a.x - b.x));
  ordered.forEach((n) => {
    const seen = new Set();
    let cur = n.id, src = null;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const e = res.inE.get(cur)[0];
      if (!e) break;
      const u = nodes.get(e.from.n);
      if (['pp', 'sw', 'hub', 'mdf'].includes(u.type)) { src = u; break; }
      cur = u.id;
    }
    if (!src) return;
    if (!groups.has(src.id)) groups.set(src.id, { next: 1 });
    const g = groups.get(src.id);
    const nConn = Math.max(1, +n.p.conn || 1);
    const panel = src.p.panel || src.p.name || '';
    const ports = [];
    for (let i = 0; i < nConn; i++) ports.push(g.next++);
    const one = (p) => fmt.replace('{floor}', floorOf(src)).replace('{panel}', panel).replace('{port}', String(p).padStart(2, '0'));
    out[n.id] = {
      src: src.id, panel, ports, auto: ports.map(one),
      text: n.p.tag ? n.p.tag : (ports.length > 1 ? `${one(ports[0])}〜${String(ports[ports.length - 1]).padStart(2, '0')}` : one(ports[0])),
    };
  });
  return out;
};

window.NZ = NZ;
