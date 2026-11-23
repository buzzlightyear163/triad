import { REGIONS, N, COLD_Q, LEASE_LOCAL } from './net.js';

export const INK = '#18402D';
export const RED = '#C23B22';
const PAPER = '#F2F0E6';
const BAND = 'rgba(122,168,118,0.14)';
const FAINT = 'rgba(24,64,45,0.22)';
const SOFT = 'rgba(24,64,45,0.55)';
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const SANS = '"IBM Plex Sans", system-ui, sans-serif';

export const TAG = {
  'read': 'READ', 'read·held': 'HELD', 'read·retry': 'RETRY', 'cold': 'COLD', 'cold·fixed': 'FIXED',
  'cold→log': 'C→LOG', 'ordinary': 'LOG', 'hot': 'HOT', 'xfer': 'XFER', 'faucet': 'MINT',
};
export const PATHNAME = {
  'read': 'local read', 'read·held': 'read held behind a write', 'read·retry': 'read, retried elsewhere',
  'cold': 'cold write, one round trip', 'cold·fixed': 'cold write, fixed by the leader', 'cold→log': 'cold write moved to the log',
  'ordinary': 'leader-ordered write', 'hot': 'hot write, owner completes', 'xfer': 'transfer, through the log', 'faucet': 'test coins, through the log',
};
export function isBad(op) {
  return op.path === 'read·retry' || op.path === 'cold→log' || op.path === 'cold·fixed' || op.leaseWait || op.ms > 800;
}
export function fmtMs(ms) { return ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : ms.toFixed(1); }

// small inline SVG glyph row for tables
export function glyphSVG(op, size = 14) {
  const parts = [];
  for (let i = 0; i < N; i++) {
    const m = op.marks ? op.marks[i] : null;
    parts.push(glyph1(m, size));
  }
  return `<span class="glyphs" title="fra lon nyc gru tyo">${parts.join('')}</span>`;
}
function glyph1(m, s) {
  const c = s / 2; const r = s * 0.3;
  let inner;
  if (!m) inner = `<circle cx="${c}" cy="${c}" r="1.3" fill="${FAINT}"/>`;
  else if (m.role === 'x') inner = `<path d="M${c - r} ${c - r}L${c + r} ${c + r}M${c + r} ${c - r}L${c - r} ${c + r}" stroke="${RED}" stroke-width="1.8"/>`;
  else if (m.role === 'l') inner = `<rect x="${c - r}" y="${c - r}" width="${2 * r}" height="${2 * r}" fill="none" stroke="${INK}" stroke-width="1.4"/>`;
  else {
    const filled = m.role === 'a' || m.role === 'c' || m.role === 'h';
    const shape = m.lead ? `<rect x="${c - r}" y="${c - r}" width="${2 * r}" height="${2 * r}" ${filled ? `fill="${INK}"` : `fill="none" stroke="${INK}" stroke-width="1.4"`}/>`
      : m.co ? `<path d="M${c} ${c - r * 1.25}L${c + r * 1.25} ${c}L${c} ${c + r * 1.25}L${c - r * 1.25} ${c}Z" ${filled ? `fill="${INK}"` : `fill="none" stroke="${INK}" stroke-width="1.4"`}/>`
        : `<circle cx="${c}" cy="${c}" r="${r}" ${filled ? `fill="${INK}"` : `fill="none" stroke="${INK}" stroke-width="1.4"`}/>`;
    inner = shape + (m.role === 'c' ? `<circle cx="${c}" cy="${c}" r="${r + 2.6}" fill="none" stroke="${INK}" stroke-width="1"/>` : '')
      + (m.role === 'h' ? `<path d="M0 ${c}H${c - r}" stroke="${INK}" stroke-width="1.4"/>` : '');
  }
  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${inner}</svg>`;
}

function ease(x) { x = Math.max(0, Math.min(1, x)); return 1 - Math.pow(1 - x, 3); }

export class Stage {
  constructor(canvas, net, opts = {}) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.net = net;
    this.mode = opts.mode || 'printout'; this.prev = null; this.modeAt = 0;
    this.sheet = opts.sheet !== false;   // draw its own paper and feed holes
    this.bottomPad = opts.bottomPad || 0;
    this.rows = []; this.seq = 0; this.lastAdd = 0;
    this.latest = {}; this.anim = {};
    this.onRow = opts.onRow || null;
    this.alive = true;
    this.off = net.on((type, op) => {
      if (type !== 'op') return;
      this.rows.push({ op, at: performance.now(), seq: this.seq++ });
      if (this.rows.length > 160) this.rows.shift();
      this.lastAdd = performance.now();
      if (op.trace && ['cold', 'ordinary', 'hot'].includes(op.path) && op.trace.length) this.latest[op.path] = op;
      if (this.onRow) this.onRow(op);
    });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    const loop = (now) => { if (!this.alive) return; this.draw(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  destroy() { this.alive = false; this.off(); this.ro.disconnect(); }
  setMode(m) { if (m === this.mode) return; this.prev = this.mode; this.mode = m; this.modeAt = performance.now(); if (m === 'receipt') this.receiptAt = performance.now(); }
  resize() {
    const r = this.c.getBoundingClientRect(); const d = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.max(10, r.width); this.H = Math.max(10, r.height); this.d = d;
    this.c.width = Math.round(this.W * d); this.c.height = Math.round(this.H * d);
  }
  draw(now) {
    const { ctx, W, H, d } = this;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const k = ease((now - this.modeAt) / 260);
    if (this.prev && k < 1) {
      ctx.globalAlpha = 1 - k; this.render(this.prev, now);
      ctx.globalAlpha = k; this.render(this.mode, now);
      ctx.globalAlpha = 1;
    } else { this.prev = null; this.render(this.mode, now); }
  }
  render(mode, now) {
    if (mode === 'printout' || mode === 'fault') this.printout(now, mode === 'fault');
    else if (mode === 'reads') this.reads(now);
    else if (mode === 'writes') this.writes(now);
    else if (mode === 'receipt') this.receipt(now);
    else if (mode === 'measured') this.measured(now);
  }

  geom() {
    const W = this.W, narrow = W < 560;
    const nowY = this.H - (narrow ? 64 : 96) - this.bottomPad;
    const x0 = this.sheet ? 34 : 14;
    const opR = x0 + 62, msR = narrow ? x0 + 50 : opR + 70, tagX = msR + 14;
    const lanes0 = tagX + (narrow ? 50 : 66);
    const sp = Math.max(26, Math.min(70, (W - lanes0 - (narrow ? 70 : 170)) / 4));
    const lanes = Array.from({ length: N }, (_, i) => lanes0 + i * sp);
    const bar0 = lanes[4] + (narrow ? 26 : 40);
    return { narrow, nowY, x0, opR, msR, tagX, lanes, sp, bar0, barW: Math.max(20, W - (this.sheet ? 34 : 14) - bar0) };
  }

  sheetBg(feed, rh, topSeq) {
    const { ctx, W, H } = this;
    if (!this.sheet) return;
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    // greenbar bands, moving with the paper
    const g = this.geom();
    for (let k = -2; k < Math.ceil(H / rh) + 3; k++) {
      const s = topSeq - k;
      const y = g.nowY - 14 - k * rh + feed - rh / 2;
      if (Math.floor(s / 3) % 2 === 0) { ctx.fillStyle = BAND; ctx.fillRect(0, y, W, rh); }
    }
    // feed holes on both edges
    ctx.fillStyle = 'rgba(24,64,45,0.09)';
    const pos = topSeq * rh - feed;
    const off = ((-pos % 24) + 24) % 24;
    for (let y = off - 24; y < H + 24; y += 24) {
      ctx.beginPath(); ctx.arc(13, y, 4.4, 0, Math.PI * 2); ctx.arc(W - 13, y, 4.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = FAINT; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(26.5, 0); ctx.lineTo(26.5, H); ctx.moveTo(W - 26.5, 0); ctx.lineTo(W - 26.5, H); ctx.stroke();
    ctx.setLineDash([]);
  }

  edges() {
    if (!this.sheet) return;
    const { ctx, W, H } = this;
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(24,64,45,0.09)';
    for (let y = 12; y < H + 24; y += 24) { ctx.beginPath(); ctx.arc(13, y, 4.4, 0, Math.PI * 2); ctx.arc(W - 13, y, 4.4, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = FAINT; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(26.5, 0); ctx.lineTo(26.5, H); ctx.moveTo(W - 26.5, 0); ctx.lineTo(W - 26.5, H); ctx.stroke();
    ctx.setLineDash([]);
  }

  laneFooter(g, opts = {}) {
    const { ctx } = this; const net = this.net; const t = net.t;
    ctx.strokeStyle = INK; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(this.sheet ? 30 : 0, g.nowY + 0.5); ctx.lineTo(this.W - (this.sheet ? 30 : 0), g.nowY + 0.5); ctx.stroke();
    ctx.font = `400 12px ${MONO}`; ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if (!g.narrow) ctx.fillText('now', g.x0, g.nowY - 6);
    const L = net.leaderTruth;
    for (let i = 0; i < N; i++) {
      const x = g.lanes[i]; const r = net.replicas[i];
      const y = g.nowY + 22;
      const down = !r.up;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
      if (down) { ctx.strokeStyle = RED; ctx.lineWidth = 1.4; ctx.stroke(); }
      else if (i === L) { ctx.fillStyle = INK; ctx.fill(); }
      else { ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke(); }
      ctx.font = `600 10px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = down ? RED : i === L ? PAPER : INK;
      ctx.fillText(down ? '×' : i === L ? 'L' : COLD_Q.includes(i) ? 'q' : '·', x, y + 0.5);
      ctx.font = `500 11.5px ${MONO}`; ctx.fillStyle = down ? RED : INK; ctx.textBaseline = 'alphabetic';
      ctx.fillText(REGIONS[i].code, x, y + 26);
      if (opts.lease !== false && !g.narrow) {
        const f = r.up ? Math.max(0, Math.min(1, (r.leaseUntil - t) / LEASE_LOCAL)) : 0;
        const w = Math.min(40, g.sp - 8);
        ctx.strokeStyle = r.up && f > 0 ? INK : RED; ctx.lineWidth = 1;
        ctx.strokeRect(x - w / 2 + 0.5, y + 34.5, w, 4);
        ctx.fillStyle = INK; ctx.fillRect(x - w / 2 + 0.5, y + 34.5, w * f, 4);
      }
    }
    ctx.textAlign = 'left';
    if (!g.narrow && opts.lease !== false) { ctx.font = `400 11px ${MONO}`; ctx.fillStyle = SOFT; ctx.fillText('lease', g.lanes[0] - g.sp * 0.5 - 44, g.nowY + 62); }
  }

  drawMark(x, y, m, bad) {
    const { ctx } = this;
    if (!m) { ctx.fillStyle = FAINT; ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill(); return; }
    if (m.role === 'x') {
      ctx.strokeStyle = RED; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke(); return;
    }
    const col = INK; const r = 4.4;
    const filled = m.role === 'a' || m.role === 'c' || m.role === 'h';
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (m.role === 'l' || m.lead) ctx.rect(x - r, y - r, 2 * r, 2 * r);
    else if (m.co) { ctx.moveTo(x, y - r * 1.3); ctx.lineTo(x + r * 1.3, y); ctx.lineTo(x, y + r * 1.3); ctx.lineTo(x - r * 1.3, y); ctx.closePath(); }
    else ctx.arc(x, y, r, 0, Math.PI * 2);
    if (filled && m.role !== 'l') ctx.fill(); else ctx.stroke();
    if (m.role === 'c') { ctx.beginPath(); ctx.lineWidth = 1; ctx.arc(x, y, r + 3.4, 0, Math.PI * 2); ctx.stroke(); }
    if (m.role === 'h') { ctx.beginPath(); ctx.lineWidth = 1.5; ctx.moveTo(x - 14, y); ctx.lineTo(x - r, y); ctx.stroke(); }
  }

  printout(now, fault) {
    const { ctx, W, H } = this; const g = this.geom();
    const rh = g.narrow ? 17 : 19;
    const newest = this.rows[this.rows.length - 1];
    const age = newest ? now - newest.at : 1e9;
    const feed = rh * (1 - ease(age / 130));
    const topSeq = newest ? newest.seq : 0;
    this.sheetBg(feed, rh, topSeq);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, g.nowY - 1); ctx.clip();
    const n = this.rows.length;
    for (let k = 0; k < n; k++) {
      const row = this.rows[n - 1 - k]; const op = row.op;
      const y = g.nowY - 14 - k * rh + feed;
      if (y < -rh) break;
      const fade = Math.max(0.12, 1 - Math.max(0, (g.nowY - y) - H * 0.35) / (H * 0.65));
      ctx.globalAlpha = fade;
      const bad = isBad(op);
      if (op.mine) { ctx.fillStyle = 'rgba(24,64,45,0.10)'; ctx.fillRect(this.sheet ? 30 : 0, y - rh / 2 + 1, W - (this.sheet ? 60 : 0), rh - 2); }
      // reveal for the newest row
      let reveal = W;
      if (k === 0 && age < 170) reveal = g.x0 + (W - g.x0) * ease(age / 170);
      ctx.save(); ctx.beginPath(); ctx.rect(0, y - rh, reveal, rh * 2); ctx.clip();
      ctx.textBaseline = 'middle';
      ctx.font = `400 12px ${MONO}`; ctx.fillStyle = INK; ctx.textAlign = 'right';
      if (!g.narrow) ctx.fillText(op.id.toLocaleString('en-US'), g.opR, y);
      ctx.font = `500 12.5px ${MONO}`; ctx.fillStyle = bad ? RED : INK;
      ctx.fillText(fmtMs(op.ms), g.msR, y);
      ctx.textAlign = 'left'; ctx.font = `600 11px ${MONO}`;
      ctx.fillText(op.mine ? 'YOU' : (TAG[op.path] || op.path), g.tagX, y);
      for (let i = 0; i < N; i++) this.drawMark(g.lanes[i], y, op.marks ? op.marks[i] : null, bad);
      // latency bar, dot matrix
      const frac = Math.min(1, Math.sqrt(op.ms / 900));
      const dots = Math.max(1, Math.floor(frac * g.barW / 5));
      ctx.fillStyle = bad ? RED : INK;
      for (let j = 0; j < dots; j++) ctx.fillRect(g.bar0 + j * 5, y - 1.5, 3, 3);
      ctx.restore();
      if (k === 0 && age < 170) { ctx.fillStyle = INK; ctx.fillRect(reveal, y - 8, 7, 16); }
    }
    ctx.restore(); ctx.globalAlpha = 1;
    // bar scale
    if (!g.narrow) {
      ctx.font = `400 11px ${MONO}`; ctx.fillStyle = SOFT; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      for (const ms of [10, 100, 300, 900]) { const x = g.bar0 + Math.sqrt(ms / 900) * g.barW; if (x < W - 30) { ctx.fillText(ms + (ms === 900 ? ' ms' : ''), x, g.nowY + 16); ctx.fillRect(x, g.nowY, 1, 5); } }
      ctx.textAlign = 'left';
    }
    this.laneFooter(g);
    if (fault) {
      const L = this.net.leader();
      ctx.font = `500 12px ${MONO}`; ctx.fillStyle = L ? INK : RED; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      const txt = L ? `leader ${REGIONS[L.id].code} · term ${this.net.term}` : 'no leader · electing';
      ctx.fillText(txt, W - (this.sheet ? 40 : 10), g.nowY + 84);
      ctx.textAlign = 'left';
    }
  }

  reads(now) {
    const { ctx, W, H } = this; const net = this.net; const t = net.t;
    const g0 = this.geom();
    const lx0 = W * (g0.narrow ? 0.16 : 0.2), lx1 = W * (g0.narrow ? 0.88 : 0.86);
    const g = { ...g0, lanes: Array.from({ length: N }, (_, i) => lx0 + (i * (lx1 - lx0)) / (N - 1)), sp: (lx1 - lx0) / (N - 1) };
    this.edges();
    const span = 6000, top = 70; const ky = (g.nowY - top) / span;
    const Y = (tt) => g.nowY - (t - tt) * ky;
    // time grid
    ctx.font = `400 11px ${MONO}`; ctx.fillStyle = SOFT; ctx.textBaseline = 'middle';
    for (let s = 0; s <= 6; s++) {
      const y = g.nowY - s * 1000 * ky;
      ctx.fillStyle = 'rgba(24,64,45,0.10)'; ctx.fillRect(g.lanes[0] - 40, y, g.lanes[4] - g.lanes[0] + 80, 1);
      if (s && !g.narrow) { ctx.fillStyle = SOFT; ctx.textAlign = 'right'; ctx.fillText(`−${s} s`, g.lanes[0] - 48, y); }
    }
    ctx.textAlign = 'left';
    for (let i = 0; i < N; i++) { ctx.fillStyle = 'rgba(24,64,45,0.16)'; ctx.fillRect(g.lanes[i], top - 20, 1, g.nowY - top + 20); }
    // writes passing by
    const ops = net.ops;
    for (let j = ops.length - 1; j >= 0; j--) {
      const op = ops[j]; if (op.end < t - span) break;
      if (op.kind === 'read') continue;
      const y = Y(op.end);
      ctx.fillStyle = 'rgba(24,64,45,0.07)'; ctx.fillRect(g.lanes[0] - 20, y, g.lanes[4] - g.lanes[0] + 40, 1);
    }
    for (let j = ops.length - 1; j >= 0; j--) {
      const op = ops[j]; if (op.end < t - span) break;
      if (op.kind !== 'read' || op.answeredBy == null) continue;
      const x = g.lanes[op.answeredBy] + ((op.id * 37) % 17 - 8);
      const y = Y(op.end);
      const bad = op.path === 'read·retry';
      ctx.fillStyle = bad ? RED : INK; ctx.strokeStyle = bad ? RED : INK;
      if (op.held) {
        const y0 = Y(op.end - op.heldMs);
        ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillRect(x - 4, y0 - 0.75, 8, 1.5);
        ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillRect(x - 6, y - 1, 12, 2);
      }
    }
    // gradient fade at top
    if (this.sheet) {
      const gr = ctx.createLinearGradient(0, 0, 0, top + 40); gr.addColorStop(0, PAPER); gr.addColorStop(1, 'rgba(242,240,230,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, top + 40);
    }
    this.laneFooter(g);
  }

  panelFor(path) {
    const a = this.anim[path] ||= { op: null, at: 0 };
    const now = performance.now();
    const cand = this.latest[path];
    if (!a.op || (cand && cand !== a.op && now - a.at > a.op.ms / 0.32 + 1500)) { if (cand) { a.op = cand; a.at = now; } }
    return a;
  }

  writes(now) {
    const { ctx, W, H } = this;
    this.edges();
    const paths = [['cold', 'COLD', '1 round trip to the cold quorum'], ['ordinary', 'LOG', 'leader orders, votes come back to you'], ['hot', 'HOT', 'leader orders, a nearby owner replies']];
    const narrow = W < 640;
    const padX = this.sheet ? (narrow ? 36 : 84) : 16;
    const gap = narrow ? 10 : 26;
    const cols = narrow ? 1 : 3;
    const pw = (W - padX * 2 - gap * (cols - 1)) / cols;
    const top = narrow ? 92 : 128, bottom = H - (narrow ? 40 : 70) - this.bottomPad;
    const tMax = 400;
    const show = narrow ? [paths[Math.floor(now / 4200) % 3]] : paths;
    show.forEach(([path, title, sub], pi) => {
      const px = padX + pi * (pw + gap);
      this.diagram(px, top, pw, bottom - top, this.panelFor(path), { title: narrow ? `${title} · ${sub}` : title, sub, tMax, narrow, now });
    });
    // scale
    ctx.font = `400 11px ${MONO}`; ctx.fillStyle = SOFT; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    if (!narrow) for (const ms of [0, 100, 200, 300, 400]) { const y = top + (ms / tMax) * (bottom - top); ctx.fillText(ms + ' ms', padX - 6, y); }
    ctx.textAlign = 'left';
  }

  diagram(px, top, pw, ph, a, o) {
    const { ctx } = this; const op = a.op;
    const lanes = 6; const lx = (i) => px + 10 + i * ((pw - 20) / (lanes - 1));
    const laneOf = (id) => (id >= 10 ? 0 : id + 1);
    const y = (ms) => top + (Math.min(ms, o.tMax) / o.tMax) * ph;
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${o.narrow ? 13 : 15}px ${MONO}`; ctx.fillStyle = INK; ctx.textAlign = 'left';
    ctx.fillText(o.title, px, top - (o.narrow ? 48 : 70));
    if (!o.narrow) { ctx.font = `400 12.5px ${SANS}`; ctx.fillStyle = SOFT; ctx.fillText(o.sub, px, top - 52); }
    const L = this.net.leaderTruth;
    for (let i = 0; i < lanes; i++) {
      const x = lx(i);
      ctx.fillStyle = i === 0 ? 'rgba(24,64,45,0.35)' : 'rgba(24,64,45,0.16)'; ctx.fillRect(x, top - 6, 1, ph + 12);
      ctx.font = `${i - 1 === L ? 600 : 400} ${o.narrow ? 9.5 : 11}px ${MONO}`; ctx.fillStyle = INK; ctx.textAlign = 'center';
      const label = i === 0 ? 'you' : REGIONS[i - 1].code;
      ctx.fillText(label, x, top - 14);
      if (i === 0 && op && !o.narrow) { ctx.font = `400 10px ${MONO}`; ctx.fillStyle = SOFT; ctx.fillText('in ' + REGIONS[op.region].code, x, top - 28); }
      if (i - 1 === L) { ctx.fillStyle = INK; ctx.fillRect(x - 3, top - 34 - (o.narrow ? 0 : 8), 6, 6); }
    }
    ctx.textAlign = 'left';
    if (!op) { ctx.font = `400 12px ${MONO}`; ctx.fillStyle = SOFT; ctx.fillText('waiting for one…', px, top + 20); return; }
    const sim = (o.now - a.at) * 0.32;
    const keepT = { CWRITE: 1, CVOTE: 1, CRESOLVE: 1, CQUERY: 1, CSTATE: 1, CFIX: 1, WRITE: 1, ACCEPT: 1, VOTE: 1, COACC: 1, DONE: 1, LCOMMIT: 1, READ: 1, READ_OK: 1 };
    for (const m of op.trace) {
      if (m.s > sim || !keepT[m.type] || m.s > op.ms + 0.01) continue;
      if (m.f === m.to) continue;
      const x1 = lx(laneOf(m.f)), x2 = lx(laneOf(m.to));
      const y1 = y(m.s), y2 = y(m.r);
      const f = Math.min(1, (sim - m.s) / Math.max(0.01, m.r - m.s));
      const xe = x1 + (x2 - x1) * f, ye = y1 + (y2 - y1) * f;
      const client = m.f >= 10 || m.to >= 10;
      ctx.strokeStyle = client ? INK : 'rgba(24,64,45,0.55)'; ctx.lineWidth = client ? 1.6 : 1;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(xe, ye); ctx.stroke();
      if (f >= 1 && Math.abs(x2 - x1) > 2) {
        const ang = Math.atan2(y2 - y1, x2 - x1);
        ctx.fillStyle = ctx.strokeStyle; ctx.beginPath();
        ctx.moveTo(x2, y2); ctx.lineTo(x2 - 6 * Math.cos(ang - 0.4), y2 - 6 * Math.sin(ang - 0.4)); ctx.lineTo(x2 - 6 * Math.cos(ang + 0.4), y2 - 6 * Math.sin(ang + 0.4)); ctx.fill();
      }
    }
    if (sim >= op.ms) {
      const yy = y(op.ms); const x = lx(0);
      ctx.fillStyle = INK; ctx.fillRect(x - 8, yy - 1, pw - 4, 2);
      ctx.font = `600 ${o.narrow ? 12 : 15}px ${MONO}`; ctx.textBaseline = 'top'; ctx.textAlign = 'right';
      ctx.fillText(`${fmtMs(op.ms)} ms`, px + pw - 4, yy + 7);
      ctx.font = `400 ${o.narrow ? 9.5 : 11}px ${MONO}`; ctx.fillStyle = SOFT;
      ctx.fillText('agreed', px + pw - 4, yy + (o.narrow ? 22 : 26)); ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    } else {
      ctx.fillStyle = 'rgba(24,64,45,0.3)'; ctx.fillRect(lx(0) - 8, y(sim), pw - 4, 1);
    }
  }

  receipt(now) {
    const { ctx, W, H } = this;
    this.edges();
    const lines = RECEIPT;
    const sw = Math.min(430, W - 60); const x0 = (W - sw) / 2; const lh = W < 560 ? 19 : 23;
    const total = lines.length * lh + 70;
    const y0 = Math.max(70, (H - total) / 2);
    const el = now - (this.receiptAt || now);
    const shown = Math.min(lines.length, Math.floor(el / 150) + 1);
    const slipH = Math.min(total, 40 + shown * lh + 30);
    ctx.fillStyle = '#FBFAF4'; ctx.strokeStyle = FAINT; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + sw, y0); ctx.lineTo(x0 + sw, y0 + slipH);
    for (let x = x0 + sw; x > x0; x -= 10) ctx.lineTo(x - 5, y0 + slipH + (((x - x0) / 10) % 2 ? 5 : 0));
    ctx.lineTo(x0, y0 + slipH); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.textBaseline = 'middle';
    for (let i = 0; i < shown; i++) {
      const [a, b, kind] = lines[i]; const yy = y0 + 30 + i * lh;
      const fs = W < 560 ? 11.5 : 13;
      ctx.font = `${kind === 'h' || kind === 'tot' ? 600 : 400} ${kind === 'tot' ? fs + 3 : fs}px ${MONO}`; ctx.fillStyle = INK;
      if (kind === 'rule') { ctx.fillRect(x0 + 18, yy, sw - 36, kind === 'rule' ? 1 : 2); continue; }
      ctx.textAlign = 'left'; ctx.fillText(a, x0 + 18, yy);
      if (b) {
        ctx.textAlign = 'right'; ctx.fillText(b, x0 + sw - 18, yy);
        const wa = ctx.measureText(a).width; ctx.textAlign = 'left';
        const wb = ctx.measureText(b).width;
        ctx.fillStyle = 'rgba(24,64,45,0.35)';
        for (let x = x0 + 24 + wa; x < x0 + sw - 24 - wb; x += 5) ctx.fillRect(x, yy + 4, 1.4, 1.4);
      }
      if (kind === 'tot') { ctx.fillStyle = INK; ctx.fillRect(x0 + 18, yy - lh / 2 - 2, sw - 36, 2); }
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if (shown < lines.length) { ctx.fillStyle = INK; ctx.fillRect(x0 + 18 + ((el % 150) / 150) * (sw - 50), y0 + 30 + shown * lh - 8, 7, 16); }
    if (el > lines.length * 150 + 9000) this.receiptAt = now;
  }

  measured(now) {
    const { ctx, W, H } = this; const net = this.net;
    this.edges();
    if (!this.mcache || now - this.mcache.at > 600) {
      const paths = ['read', 'read·held', 'cold', 'ordinary', 'hot', 'xfer'];
      this.mcache = { at: now, rows: paths.map(p => ({ p, s: net.summary(p) })).filter(r => r.s) };
    }
    const rows = this.mcache.rows; const narrow = W < 560;
    const padL = (this.sheet ? 44 : 12) + (narrow ? 64 : 110), padR = this.sheet ? 50 : 16;
    const top = 90, bottom = H - 80 - this.bottomPad; const rh = (bottom - top) / Math.max(rows.length, 1);
    const lo = Math.log10(1), hi = Math.log10(3000);
    const X = (ms) => padL + (Math.log10(Math.max(1, ms)) - lo) / (hi - lo) * (W - padL - padR);
    const bins = narrow ? 44 : 72;
    rows.forEach((r, i) => {
      const y0 = top + i * rh; const base = y0 + rh - 14;
      const counts = new Array(bins).fill(0);
      for (const v of r.s.sorted) { const b = Math.min(bins - 1, Math.max(0, Math.floor((Math.log10(Math.max(1, v)) - lo) / (hi - lo) * bins))); counts[b]++; }
      const mx = Math.max(...counts);
      const bw = (W - padL - padR) / bins;
      ctx.fillStyle = INK;
      for (let b = 0; b < bins; b++) {
        if (!counts[b]) continue;
        const h = Math.max(2, (counts[b] / mx) * (rh - 34));
        const dots = Math.max(1, Math.floor(h / 4));
        for (let d = 0; d < dots; d++) ctx.fillRect(padL + b * bw + 1, base - d * 4 - 3, Math.max(1.5, bw - 2.5), 2.6);
      }
      ctx.fillStyle = 'rgba(24,64,45,0.25)'; ctx.fillRect(padL, base + 1, W - padL - padR, 1);
      for (const [q, lab] of [[r.s.p50, 'p50'], [r.s.p90, 'p90']]) {
        const x = X(q); ctx.fillStyle = INK; ctx.fillRect(x, y0 + 14, 1.4, rh - 26);
        ctx.font = `400 11px ${MONO}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = lab === 'p50' ? 'right' : 'left';
        ctx.fillText(`${lab} ${fmtMs(q)}`, lab === 'p50' ? x - 5 : x + 5, y0 + 24);
      }
      ctx.font = `600 12px ${MONO}`; ctx.fillStyle = INK; ctx.textAlign = 'right';
      ctx.fillText(TAG[r.p] || r.p, padL - 14, base - 8);
      ctx.font = `400 11px ${MONO}`; ctx.fillStyle = SOFT; ctx.fillText(`n ${r.s.n}`, padL - 14, base + 6);
    });
    ctx.textAlign = 'center'; ctx.font = `400 11px ${MONO}`; ctx.fillStyle = SOFT;
    for (const ms of [1, 3, 10, 30, 100, 300, 1000, 3000]) { const x = X(ms); ctx.fillText(ms >= 1000 ? ms / 1000 + ' s' : ms + (ms === 1 ? ' ms' : ''), x, bottom + 22); ctx.fillRect(x, bottom + 4, 1, 6); }
    ctx.textAlign = 'left';
  }
}

export const RECEIPT = [
  ['AI-GREEMENT', 'discovery run', 'h'],
  ['', '', 'rule'],
  ['papers read', '22'],
  ['knowledge base', '97 notes'],
  ['search rounds', '20'],
  ['baselines in the arena', '7'],
  ['tokens, searching', '68.14 M'],
  ['tokens, verifying', '710.31 M'],
  ['tokens, total', '778.45 M'],
  ['lines of Lean', '~135,000'],
  ['wall clock', '~24 h'],
  ['', '', 'rule'],
  ['result', 'A-GREEMENT'],
  ['safety', 'proved in Lean'],
  ['', '', 'rule'],
  ['TOTAL, API-equivalent', '$198.69', 'tot'],
];

// one-op diagram for the explorer
export function drawOpDiagram(canvas, net, op) {
  const fake = Object.create(Stage.prototype);
  const r = canvas.getBoundingClientRect(); const d = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = r.width * d; canvas.height = r.height * d;
  fake.c = canvas; fake.ctx = canvas.getContext('2d'); fake.net = net; fake.W = r.width; fake.H = r.height; fake.d = d; fake.sheet = false;
  fake.ctx.setTransform(d, 0, 0, d, 0, 0);
  const tMax = Math.max(60, Math.ceil(op.ms / 50) * 50 + 20);
  fake.diagram(70, 90, r.width - 100, r.height - 120, { op, at: performance.now() - 1e7 }, { title: (TAG[op.path] || op.path), sub: PATHNAME[op.path] || '', tMax, narrow: r.width < 500, now: performance.now() });
  const ctx = fake.ctx; ctx.font = `400 11px ${MONO}`; ctx.fillStyle = SOFT; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) { const ms = (tMax / 4) * i; ctx.fillText(ms.toFixed(0) + ' ms', 62, 90 + (ms / tMax) * (r.height - 120) + 4); }
}
