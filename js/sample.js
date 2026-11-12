/* サンプル: 3階建て事務所の LAN 配線系統図 */
'use strict';
(function () {
  const NZ = window.NZ;
  NZ.sample = function () {
    const nodes = [], edges = [];
    let seq = 1;
    const N = (type, x, y, p = {}) => {
      const n = { id: 'n' + seq++, type, x, y, p: Object.assign({}, NZ.TYPES[type].defaults, p) };
      nodes.push(n);
      return n.id;
    };
    const E = (a, ap, b, bp, p) => { edges.push({ id: 'e' + seq++, from: { n: a, p: ap }, to: { n: b, p: bp }, p: Object.assign({ cable: 'cat6a', qty: 1, len: 10, method: 'ceil', conduit: '' }, p) }); };

    // 1F MDF室
    N('rack', 40, 425, { label: '1F MDF室 ラック', w: 300, h: 120 });
    const onu = N('onu', 90, 470);
    const rt = N('rt', 170, 470, { name: 'RT' });
    const core = N('sw', 260, 470, { name: 'SW-C', l3: true, ports: 24, sfp: 8 });
    const pp1 = N('pp', 260, 520, { name: 'PP-1F', panel: 'A', ports: 24 });
    E(onu, 'outR', rt, 'inL', { cable: 'cord', len: 0 });
    E(rt, 'outR', core, 'inL', { cable: 'cord', len: 0 });
    E(core, 'out', pp1, 'in', { cable: 'cord', qty: 6, len: 0 });
    [[420, '受付'], [490, '事務室'], [560, '事務室']].forEach(([x, room], i) => {
      const o = N('outlet', x, 570, { conn: 2, room });
      E(pp1, 'outR', o, 'in', { qty: 2, len: 15 + i * 7, method: 'floor', conduit: '' });
    });
    const mfpO = N('outlet', 630, 570, { conn: 1, room: '事務室' });
    E(pp1, 'outR', mfpO, 'in', { qty: 1, len: 34, method: 'floor' });
    const mfp = N('prn', 700, 570);
    E(mfpO, 'out', mfp, 'inL', { cable: 'cord', len: 0 });

    // 2F・3F EPS
    [[2, 230, '2F'], [0, 30, '3F']].forEach(([, top, fl], k) => {
      N('rack', 330, top, { label: `${fl} EPS`, w: 170, h: 70 });
      const sw = N('sw', 400, top + 35, { name: `SW-${fl}`, poe: true, ports: 24, sfp: 4, panel: 'B' });
      E(core, 'outR', sw, 'in', { cable: 'sm', qty: 4, len: k ? 22 : 12, method: 'ceil', conduit: 'ケーブルラック' });
      const y = top + 130;
      [[560, '会議室'], [630, '執務室'], [700, '執務室'], [770, '執務室']].forEach(([x, room], i) => {
        const o = N('outlet', x, y, { conn: 2, room, mount: i ? 'raised' : 'wall' });
        E(sw, 'outR', o, 'in', { qty: 2, len: 18 + i * 9, method: i ? 'floor' : 'ceil' });
      });
      const ap = N('ap', 400, y, { name: `AP-${fl}` });
      E(sw, 'out', ap, 'in', { len: 25, method: 'ceil' });
      if (fl === '3F') {
        const cam = N('cam', 470, y, { name: 'CAM-1' });
        E(sw, 'out', cam, 'in', { len: 30, method: 'exp', conduit: 'PF16' });
      }
    });

    return {
      version: 1, title: 'サンプル 3階建て事務所 LAN配線系統図', author: '', date: new Date().toISOString().slice(0, 10),
      floors: ['3F', '2F', '1F'], laneH: 200, nodes, edges, seq, labelFmt: '{floor}-{panel}-{port}',
    };
  };
})();
