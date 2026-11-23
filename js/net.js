// AGREE net: A-GREEMENT (Burgelin, Guerraoui, Hong, Hu, Kermarrec, Pires, Veski, de Vos,
// "The End of Consensus Research?", arXiv 2610.30114) running inside this browser tab.
// Five replicas, crash faults only, n = 2f+1 = 5, majority m = f+1 = 3.
// Regions are emulated: every replica runs here, with inter-region delays inserted between them.

export const REGIONS = [
  { id: 0, code: 'fra', name: 'Frankfurt' },
  { id: 1, code: 'lon', name: 'London' },
  { id: 2, code: 'nyc', name: 'New York' },
  { id: 3, code: 'gru', name: 'São Paulo' },
  { id: 4, code: 'tyo', name: 'Tokyo' },
];
export const N = 5;
export const MAJ = 3;
// one-way delay between regions, ms
export const OW = [
  [0, 7.5, 42, 98, 112],
  [7.5, 0, 36, 93, 108],
  [42, 36, 0, 57, 78],
  [98, 93, 57, 0, 128],
  [112, 108, 78, 128, 0],
];
export const METRO = 2.4;            // client to a replica in the same metro, one-way
export const PREF = [1, 0, 2, 3, 4]; // leader order: lon has the fastest majority (36 ms one-way)
export const COLD_Q = [0, 1, 2];     // the fixed cold quorum: fra, lon, nyc
export const LEASE_TICK = 400;
export const LEASE_LOCAL = 1400;     // how long a replica trusts its own lease
export const LEASE_BOUND = 2000;     // how long the leader assumes a lease may still be held
export const SUSPECT = 900;          // silence before a replica suspects the leader
export const KEYS = 1000;
export const HOT = 8, ORD = 120;     // by access rank: 1-8 hot, 9-120 ordinary, rest cold

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function randAddr(len = 44, rnd = Math.random) {
  let s = '';
  for (let i = 0; i < len; i++) s += B58[(rnd() * 58) | 0];
  return s;
}
export function keyName(rank) { return 'k' + String(rank).padStart(4, '0'); }

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  peek() { return this.a[0]; }
  push(x) {
    const a = this.a; a.push(x); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (lt(a[i], a[p])) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && lt(a[l], a[m])) m = l;
        if (r < a.length && lt(a[r], a[m])) m = r;
        if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}
function lt(x, y) { return x.t < y.t || (x.t === y.t && x.s < y.s); }

function pct(sorted, p) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

export class Net {
  constructor(opts = {}) {
    this.t = 0; this.seq = 0; this.q = new Heap();
    this.wall0 = Date.now();
    this.rate = opts.rate ?? 14;           // synthetic ops per second
    this.mix = opts.mix ?? 'A';            // A: 50% writes, B: 5% writes, C: read-only
    this.listeners = new Set();
    this.ops = []; this.opById = new Map(); this.opSeq = 0;
    this.stats = {}; this.counters = { ops: 0, ballots: 1, failovers: 0, leaseWaits: 0, moved: 0, fixed: 0, retries: 0, held: 0 };
    this.events = [];
    this.classOverride = new Map();
    this.leaderHint = PREF[0];
    this.leaderTruth = PREF[0];
    this.ballotTruth = 1; this.term = 1;
    // zipf over keys
    const s = 0.99; let z = 0; this.cdf = [];
    for (let k = 1; k <= KEYS; k++) { z += 1 / Math.pow(k, s); this.cdf.push(z); }
    this.cdf = this.cdf.map(x => x / z);
    // synthetic accounts
    const seedRnd = mulberry(7);
    this.accounts = Array.from({ length: 40 }, () => randAddr(44, seedRnd));
    const genesis = new Map();
    for (let k = 1; k <= KEYS; k++) genesis.set(keyName(k), { v: '0x' + (k * 2654435761 >>> 0).toString(16).slice(0, 6), ver: 1 });
    for (const a of this.accounts) genesis.set('acct:' + a, { v: 5000, ver: 1 });
    this.replicas = REGIONS.map(r => new Replica(this, r.id, genesis));
    this.clients = REGIONS.map(r => new Client(this, r.id));
    // ballot 1, leader lon, established at genesis
    for (const r of this.replicas) { r.ballot = 1; r.leaderView = PREF[0]; r.lastLeader = 0; r.leaseUntil = LEASE_LOCAL; }
    this.replicas[PREF[0]].becomeLeader(1, [], true);
    this.log('Genesis. Leader lon, ballot 1. Cold quorum fra, lon, nyc.', 'info');
    this.scheduleArrival();
    this.every(100, () => { for (const r of this.replicas) if (r.up) r.tick(); });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }
  now() { return this.t; }
  wall(t = this.t) { return this.wall0 + t; }

  at(t, fn) { this.q.push({ t, s: this.seq++, fn }); }
  after(dt, fn) { this.at(this.t + dt, fn); }
  every(dt, fn) { const go = () => { fn(); this.after(dt, go); }; this.after(dt, go); }

  advance(dtReal) {
    const target = this.t + Math.min(Math.max(dtReal, 0), 120);
    while (this.q.size && this.q.peek().t <= target) {
      const e = this.q.pop(); this.t = e.t; e.fn();
    }
    this.t = target;
  }

  log(text, kind = 'info') {
    this.events.push({ t: this.t, text, kind });
    if (this.events.length > 300) this.events.shift();
    this.emit('event', { t: this.t, text, kind });
  }

  delay(a, b) {
    // a, b are regions; client endpoints sit in a region's metro
    const base = a === b ? METRO : OW[a][b];
    return base * (1 + Math.random() * 0.018) + 0.05 + (Math.random() < 0.02 ? Math.random() * 3 : 0);
  }

  // node ids: 0..4 replicas, 10..14 clients (region = id - 10)
  node(id) { return id >= 10 ? this.clients[id - 10] : this.replicas[id]; }
  send(from, to, msg) {
    const fr = from >= 10 ? from - 10 : from, tr = to >= 10 ? to - 10 : to;
    let d;
    if (from >= 10 || to >= 10) d = (fr === tr ? METRO : OW[fr][tr] + METRO) * (1 + Math.random() * 0.018) + 0.05;
    else d = from === to ? 0.03 : this.delay(fr, tr);
    msg.from = from;
    const ts = this.t;
    if (msg.op != null) {
      const op = this.opById.get(msg.op);
      if (op && op.trace && op.trace.length < 60) op.trace.push({ f: from, to, s: ts - op.start, r: ts + d - op.start, type: msg.type });
    }
    if (from < 10 && !this.replicas[from].up) return;
    this.after(d, () => { const n = this.node(to); if (n.up !== false) n.recv(msg); });
  }

  baseCls(key) {
    if (key.startsWith('note:')) return 'cold';
    if (key.startsWith('acct:')) return 'log';
    const rank = +key.slice(1);
    return rank <= HOT ? 'hot' : rank <= ORD ? 'ordinary' : 'cold';
  }
  cls(key) {
    if (this.classOverride.has(key)) return this.classOverride.get(key);
    if (key.startsWith('note:')) return 'cold';
    if (key.startsWith('acct:')) return 'log';
    const rank = +key.slice(1);
    return rank <= HOT ? 'hot' : rank <= ORD ? 'ordinary' : 'cold';
  }

  scheduleArrival() {
    if (this.rate <= 0) { this.after(500, () => this.scheduleArrival()); return; }
    const gap = -Math.log(1 - Math.random()) * 1000 / this.rate;
    this.after(gap, () => { this.synthetic(); this.scheduleArrival(); });
  }

  pickRegion() {
    const r = Math.random(); return r < 0.28 ? 0 : r < 0.52 ? 1 : r < 0.76 ? 2 : r < 0.88 ? 3 : 4;
  }
  pickKey() {
    const u = Math.random(); let lo = 0, hi = this.cdf.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.cdf[m] < u) lo = m + 1; else hi = m; }
    return keyName(lo + 1);
  }

  synthetic() {
    const region = this.pickRegion();
    const wf = this.mix === 'A' ? 0.5 : this.mix === 'B' ? 0.05 : 0;
    const u = Math.random();
    if (u < wf * 0.12) {
      const a = this.accounts[(Math.random() * this.accounts.length) | 0];
      let b = this.accounts[(Math.random() * this.accounts.length) | 0];
      if (b === a) b = this.accounts[(this.accounts.indexOf(a) + 1) % this.accounts.length];
      this.submit({ kind: 'xfer', region, from: a, to: b, amt: 1 + ((Math.random() * 120) | 0) });
    } else if (u < wf) {
      this.submit({ kind: 'write', region, key: this.pickKey(), value: '0x' + ((Math.random() * 0xffffff) | 0).toString(16).padStart(6, '0') });
    } else {
      this.submit({ kind: 'read', region, key: this.pickKey() });
    }
  }

  submit(spec) {
    const op = {
      id: ++this.opSeq, kind: spec.kind, region: spec.region, key: spec.key, value: spec.value,
      from: spec.from, to: spec.to, amt: spec.amt, mine: !!spec.mine,
      start: this.t, end: null, ms: null, path: null, retries: 0, trace: spec.kind === 'read' ? null : [],
      votes: new Map(), marks: null, critical: null, result: null, done: false, resolve: spec.resolve,
    };
    this.opById.set(op.id, op);
    if (this.opById.size > 6000) { const first = this.opById.keys().next().value; this.opById.delete(first); }
    this.clients[op.region].start(op);
    return op;
  }

  complete(op, info = {}) {
    if (op.done) return;
    op.done = true; op.end = this.t; op.ms = op.end - op.start;
    Object.assign(op, info);
    const path = op.path;
    (this.stats[path] ||= []).push(op.ms);
    if (this.stats[path].length > 3000) this.stats[path].shift();
    this.counters.ops++;
    this.ops.push(op); if (this.ops.length > 1500) this.ops.shift();
    if (op.resolve) op.resolve(op);
    this.emit('op', op);
  }

  summary(path) {
    const a = this.stats[path]; if (!a || !a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const mean = s.reduce((x, y) => x + y, 0) / s.length;
    return { n: s.length, p50: pct(s, 0.5), p90: pct(s, 0.9), p99: pct(s, 0.99), mean, min: s[0], max: s[s.length - 1], sorted: s };
  }
  summaryOf(paths) {
    const a = paths.flatMap(p => this.stats[p] || []); if (!a.length) return null;
    const s = a.sort((x, y) => x - y); const mean = s.reduce((x, y) => x + y, 0) / s.length;
    return { n: s.length, p50: pct(s, 0.5), p90: pct(s, 0.9), p99: pct(s, 0.99), mean, sorted: s };
  }

  leader() { return this.replicas.find(r => r.up && r.lead && r.lead.established) || null; }
  responders() { const L = this.leader(); return L ? L.responderSet() : []; }

  crash(id) {
    const r = this.replicas[id]; if (!r.up) return;
    r.crash();
    this.log(`${REGIONS[id].code} crashed${r.wasLeader ? ' (it was the leader)' : ''}.`, 'fault');
    this.emit('replica', id);
  }
  restart(id) {
    const r = this.replicas[id]; if (r.up) return;
    r.restart();
    this.log(`${REGIONS[id].code} replaced: a fresh replica catches up from the leader before it answers reads.`, 'info');
    this.emit('replica', id);
  }
}

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

class Replica {
  constructor(net, id, genesis) {
    this.net = net; this.id = id; this.up = true;
    this.store = new Map(genesis);
    this.ballot = 1; this.leaderView = PREF[0]; this.lastLeader = 0; this.leaseUntil = 0; this.lastGrantSeen = 0;
    this.accepted = new Map(); this.committed = new Set(); this.applied = 0;
    this.pend = new Map(); this.held = new Map(); this.cold = new Map(); this.coldPend = new Map();
    this.co = new Map(); this.lead = null; this.cand = null; this.served = 0; this.voted = 0; this.wasLeader = false;
    this.seenOps = new Set(); this.catchT = 0;
  }
  get t() { return this.net.t; }
  send(to, msg) { this.net.send(this.id, to, msg); }
  bcast(msg) { for (let i = 0; i < N; i++) this.send(i, { ...msg }); }
  hasLease() { return this.up && this.leaseUntil > this.t; }

  crash() {
    this.wasLeader = !!(this.lead && this.lead.established);
    this.up = false; this.lead = null; this.cand = null; this.leaseUntil = 0;
    this.held.clear(); this.co.clear();
  }
  restart() {
    this.up = true; this.lead = null; this.cand = null; this.leaseUntil = 0; this.lastLeader = this.t; this.catching = true;
    this.accepted.clear(); this.committed.clear(); this.pend.clear(); this.held.clear(); this.cold.clear(); this.coldPend.clear(); this.co.clear();
    this.catchT = this.t;
    this.send(this.net.leaderHint, { type: 'CATCHUP' });
  }

  responderSet() {
    if (!this.lead) return [];
    const out = [];
    for (let i = 0; i < N; i++) if (this.lead.holder[i] > this.t) out.push(i);
    return out;
  }

  becomeLeader(ballot, carry, genesis = false) {
    const L = this.lead = {
      ballot, established: false, nextSlot: 1, pend: new Map(), byOp: new Map(), holder: new Array(N).fill(0),
      proj: new Map(), coldNext: new Map(), resolving: new Map(), queue: [],
    };
    this.ballot = ballot; this.leaderView = this.id;
    let maxSlot = this.applied;
    for (const e of this.accepted.values()) maxSlot = Math.max(maxSlot, e.slot);
    for (const e of carry) maxSlot = Math.max(maxSlot, e.slot);
    L.nextSlot = maxSlot + 1;
    const establish = () => {
      if (!this.up || this.lead !== L) return;
      L.established = true; this.wasLeader = true;
      this.net.leaderTruth = this.id; this.net.ballotTruth = ballot; this.net.term++;
      this.leaseUntil = this.t + LEASE_LOCAL; L.holder[this.id] = this.t + LEASE_BOUND;
      // carry over entries that might have been chosen
      for (const e of carry) {
        if (e.slot <= this.applied || this.committed.has(e.slot)) continue;
        const ne = { ...e, ballot, resp: this.responderSet() };
        L.pend.set(e.slot, { entry: ne, acc: new Set(), t0: this.t, carried: true });
        L.byOp.set(ne.op.id, e.slot);
        this.bcast({ type: 'ACCEPT', entry: ne, ballot });
      }
      this.leaseTick();
      for (let c = 10; c < 15; c++) this.send(c, { type: 'NEWLEADER', id: this.id, ballot });
      for (const m of L.queue) this.recv(m);
      L.queue = [];
      if (!genesis) this.net.log(`${REGIONS[this.id].code} leads ballot ${ballot} (term ${this.net.term}). Old leases ran out; writes resume.`, 'recover');
      this.net.emit('leader', this.id);
    };
    if (genesis) {
      for (let i = 0; i < N; i++) L.holder[i] = LEASE_BOUND;
      L.established = true; this.net.leaderTruth = this.id; this.wasLeader = true;
      this.after(1, () => this.leaseTick());
    } else {
      const waitUntil = Math.max(this.t, this.lastGrantSeen + LEASE_BOUND);
      const hold = () => { if (this.up && this.lead === L && !L.established) { this.bcast({ type: 'HOLD', ballot }); this.after(300, hold); } };
      hold();
      if (waitUntil > this.t + 1) this.net.log(`${REGIONS[this.id].code} won ballot ${ballot}; waiting ${(waitUntil - this.t).toFixed(0)} ms for old leases to run out.`, 'wait');
      this.net.at(waitUntil, establish);
    }
  }
  after(dt, fn) { this.net.after(dt, fn); }

  leaseTick() {
    const L = this.lead; if (!this.up || !L || !L.established) return;
    for (let i = 0; i < N; i++) {
      if (i === this.id) { L.holder[i] = this.t + LEASE_BOUND; this.leaseUntil = this.t + LEASE_LOCAL; continue; }
      this.send(i, { type: 'LEASE', ballot: L.ballot, grant: this.t, active: L.holder[i] > this.t });
    }
    this.after(LEASE_TICK, () => { if (this.lead === L) this.leaseTick(); });
  }

  tick() {
    const t = this.t;
    // drop tentative markers that never completed
    for (const [k, p] of this.pend) { p.items = p.items.filter(x => t - x.t < 3000); if (!p.items.length) { this.pend.delete(k); this.release(k); } }
    for (const [op, c] of this.coldPend) if (t - c.t > 1500) { this.coldPend.delete(op); this.unpend(c.key, op); }
    const L = this.lead;
    if (L && L.established) {
      for (const slot of [...L.pend.keys()]) this.checkCommit(slot);
      return;
    }
    if (this.catching) {
      if (t - this.catchT > 600) { this.catchT = t; this.send(this.net.leaderHint, { type: 'CATCHUP' }); }
      return;
    }
    // election
    if (this.cand || (L && !L.established)) return;
    const rank = PREF.indexOf(this.id);
    if (t - this.lastLeader > SUSPECT + rank * 260) this.campaign();
  }

  campaign() {
    const round = Math.floor(this.ballot / 8) + 1;
    const ballot = round * 8 + this.id;
    this.cand = { ballot, promises: new Map(), t0: this.t };
    this.ballot = ballot;
    this.net.counters.ballots++;
    this.net.log(`${REGIONS[this.id].code} heard nothing from the leader for ${SUSPECT} ms and asks for ballot ${ballot}.`, 'wait');
    this.bcast({ type: 'PREPARE', ballot });
    this.after(800, () => { if (this.cand && this.cand.ballot === ballot && !this.lead) { this.cand = null; this.lastLeader = this.t - SUSPECT + 300; } });
  }

  markPend(key, opId) {
    const p = this.pend.get(key) || { items: [] };
    p.items.push({ op: opId, t: this.t }); this.pend.set(key, p);
  }
  unpend(key, opId) {
    const p = this.pend.get(key); if (!p) return;
    p.items = p.items.filter(x => x.op !== opId);
    if (!p.items.length) { this.pend.delete(key); this.release(key); }
  }
  release(key) {
    const h = this.held.get(key); if (!h) return;
    this.held.delete(key);
    for (const m of h) this.answer(m, true);
  }
  answer(m, held) {
    const cur = this.store.get(m.key) || { v: null, ver: 0 };
    this.served++;
    this.send(m.from, { type: 'READ_OK', op: m.op, key: m.key, value: cur.v, ver: cur.ver, held, heldMs: held ? this.t - m.arrived : 0 });
  }

  entryKeys(e) {
    const op = e.op;
    if (op.kind === 'xfer') return ['acct:' + op.from, 'acct:' + op.to];
    if (op.kind === 'faucet') return ['acct:' + op.to];
    return [op.key];
  }

  apply(e) {
    const op = e.op;
    if (this.seenOps.has(op.id)) { for (const k of this.entryKeys(e)) this.unpend(k, op.id); return; }
    this.seenOps.add(op.id);
    if (this.seenOps.size > 5000) this.seenOps.delete(this.seenOps.values().next().value);
    if (op.kind === 'xfer') {
      if (e.ok) {
        const a = this.store.get('acct:' + op.from) || { v: 0, ver: 0 }, b = this.store.get('acct:' + op.to) || { v: 0, ver: 0 };
        this.store.set('acct:' + op.from, { v: a.v - op.amt, ver: a.ver + 1 });
        this.store.set('acct:' + op.to, { v: b.v + op.amt, ver: b.ver + 1 });
      }
    } else if (op.kind === 'faucet') {
      const b = this.store.get('acct:' + op.to) || { v: 0, ver: 0 };
      this.store.set('acct:' + op.to, { v: b.v + op.amt, ver: b.ver + 1 });
    } else {
      const cur = this.store.get(op.key) || { v: null, ver: 0 };
      this.store.set(op.key, { v: op.value, ver: cur.ver + 1 });
      if (this.cold.has(op.key)) this.cold.get(op.key).maxV = cur.ver + 1;
    }
    for (const k of this.entryKeys(e)) this.unpend(k, op.id);
  }
  applyReady() {
    while (this.committed.has(this.applied + 1) && this.accepted.has(this.applied + 1)) {
      const e = this.accepted.get(this.applied + 1);
      this.apply(e); this.applied++;
      this.accepted.delete(this.applied); this.committed.delete(this.applied);
    }
  }

  checkCommit(slot) {
    const L = this.lead; const p = L.pend.get(slot); if (!p) return;
    const live = this.responderSet();
    const required = p.entry.resp.filter(r => live.includes(r));
    if (p.acc.size >= MAJ && required.every(r => p.acc.has(r))) {
      L.pend.delete(slot);
      const stalled = this.t - p.t0 > 320;
      this.bcast({ type: 'COMMIT', slot, ballot: L.ballot });
      if (stalled) {
        this.net.counters.leaseWaits++;
        this.send(10 + p.entry.op.region, { type: 'LCOMMIT', op: p.entry.op.id, slot, waited: true });
      }
    }
  }

  order(m) {
    const L = this.lead; const op = m.opSpec;
    if (L.byOp.has(op.id)) {
      const slot = L.byOp.get(op.id); const p = L.pend.get(slot);
      if (p) { p.entry.resp = this.responderSet(); p.entry.op.co = op.co; this.bcast({ type: 'ACCEPT', entry: p.entry, ballot: L.ballot, op: op.id }); }
      else this.send(10 + op.region, { type: 'LCOMMIT', op: op.id, slot });
      return;
    }
    if (this.seenOps.has(op.id)) { this.send(10 + op.region, { type: 'LCOMMIT', op: op.id }); return; }
    if (m.moveKey && op.key && !this.net.classOverride.has(op.key)) {
      this.net.classOverride.set(op.key, 'ordinary'); this.net.counters.moved++;
      if (this.t - (this.net.lastMoveLog ?? -1e9) > 8000) {
        this.net.lastMoveLog = this.t;
        this.net.log(`A cold-quorum member is not answering. Cold writes fall back to the shared log, starting with ${op.key}.`, 'wait');
      }
    }
    const slot = L.nextSlot++;
    const entry = { slot, ballot: L.ballot, op: { ...op }, resp: this.responderSet(), moveKey: !!m.moveKey };
    if (op.kind === 'xfer') {
      const bal = L.proj.has(op.from) ? L.proj.get(op.from) : (this.store.get('acct:' + op.from)?.v ?? 0);
      entry.ok = bal >= op.amt;
      if (entry.ok) {
        L.proj.set(op.from, bal - op.amt);
        const tb = L.proj.has(op.to) ? L.proj.get(op.to) : (this.store.get('acct:' + op.to)?.v ?? 0);
        L.proj.set(op.to, tb + op.amt);
      }
    } else if (op.kind === 'faucet') {
      const tb = L.proj.has(op.to) ? L.proj.get(op.to) : (this.store.get('acct:' + op.to)?.v ?? 0);
      L.proj.set(op.to, tb + op.amt); entry.ok = true;
    }
    if (L.proj.size > 400) L.proj.clear();
    L.pend.set(slot, { entry, acc: new Set(), t0: this.t });
    L.byOp.set(op.id, slot);
    if (L.byOp.size > 3000) L.byOp.delete(L.byOp.keys().next().value);
    this.bcast({ type: 'ACCEPT', entry, ballot: L.ballot, op: op.id });
  }

  recv(m) {
    if (!this.up) return;
    const t = this.t; const L = this.lead;
    switch (m.type) {
      case 'LEASE':
        if (m.ballot >= this.ballot) {
          this.ballot = m.ballot; this.leaderView = m.from; this.lastLeader = t; this.lastGrantSeen = Math.max(this.lastGrantSeen, m.grant);
          if (!this.catching) { if (m.active) this.leaseUntil = t + LEASE_LOCAL; this.send(m.from, { type: 'LACK', grant: m.grant, ballot: m.ballot }); }
          if (this.lead && this.lead.ballot < m.ballot) this.lead = null;
        }
        break;
      case 'HOLD':
        if (m.ballot >= this.ballot) { this.lastLeader = t; this.leaderView = m.from; }
        break;
      case 'LACK':
        if (L && L.established && m.ballot === L.ballot) L.holder[m.from] = Math.max(L.holder[m.from], m.grant + LEASE_BOUND);
        break;
      case 'READ': {
        m.arrived = t;
        const c = this.net.baseCls(m.key);
        if (this.catching || !this.hasLease() || (c === 'cold' && !COLD_Q.includes(this.id))) {
          this.send(m.from, { type: 'NACK', op: m.op });
          break;
        }
        if (this.pend.has(m.key)) {
          const h = this.held.get(m.key) || []; h.push(m); this.held.set(m.key, h); this.net.counters.held++;
          this.send(m.from, { type: 'HELD', op: m.op });
        } else this.answer(m, false);
        break;
      }
      case 'WRITE':
        if (L && L.established) this.order(m);
        else if (L && !L.established) L.queue.push(m);
        else if (this.leaderView !== this.id && this.leaderView != null && !this.cand) this.send(this.leaderView, { ...m, type: 'WRITE' });
        break;
      case 'ACCEPT': {
        if (m.ballot < this.ballot || this.catching) break;
        this.ballot = m.ballot; this.leaderView = m.from; this.lastLeader = t;
        const e = m.entry;
        if (e.slot <= this.applied) { this.send(m.from, { type: 'ACCEPTED', slot: e.slot, ballot: m.ballot, op: e.op.id }); break; }
        const fresh = !this.accepted.has(e.slot);
        this.accepted.set(e.slot, e);
        if (fresh) for (const k of this.entryKeys(e)) this.markPend(k, e.op.id);
        if (e.moveKey && e.op.key) { for (const [op, c] of this.coldPend) if (c.key === e.op.key) { this.coldPend.delete(op); this.unpend(c.key, op); } }
        this.voted++;
        this.send(m.from, { type: 'ACCEPTED', slot: e.slot, ballot: m.ballot, op: e.op.id });
        if (e.op.mode === 'hot') {
          const co = e.op.co;
          if (co === this.id) this.coAccepted(e, this.id); else this.send(co, { type: 'COACC', entry: e, op: e.op.id });
        } else {
          this.send(10 + e.op.region, { type: 'VOTE', op: e.op.id, slot: e.slot, resp: e.resp, ok: e.ok });
        }
        this.applyReady();
        break;
      }
      case 'ACCEPTED':
        if (L && L.established && m.ballot === L.ballot) { const p = L.pend.get(m.slot); if (p) { p.acc.add(m.from); this.checkCommit(m.slot); } }
        break;
      case 'COACC': this.coAccepted(m.entry, m.from); break;
      case 'COMMIT':
        if (m.slot > this.applied) { this.committed.add(m.slot); this.applyReady(); }
        break;
      case 'PREPARE':
        if (m.ballot > this.ballot) {
          this.ballot = m.ballot; this.lead = null; this.cand = null;
          const carry = [...this.accepted.values()].filter(e => e.slot > this.applied);
          this.send(m.from, { type: 'PROMISE', ballot: m.ballot, carry, applied: this.applied, grant: this.lastGrantSeen });
          this.lastLeader = t;
        }
        break;
      case 'PROMISE': {
        const c = this.cand; if (!c || m.ballot !== c.ballot) break;
        c.promises.set(m.from, m);
        if (!c.promises.has(this.id)) c.promises.set(this.id, { carry: [...this.accepted.values()].filter(e => e.slot > this.applied), grant: this.lastGrantSeen });
        if (c.promises.size >= MAJ) {
          const bySlot = new Map();
          for (const p of c.promises.values()) {
            this.lastGrantSeen = Math.max(this.lastGrantSeen, p.grant || 0);
            for (const e of p.carry) { const cur = bySlot.get(e.slot); if (!cur || e.ballot > cur.ballot) bySlot.set(e.slot, e); }
          }
          this.cand = null; this.net.counters.failovers++;
          this.becomeLeader(c.ballot, [...bySlot.values()].sort((a, b) => a.slot - b.slot));
        }
        break;
      }
      case 'CWRITE': this.coldWrite(m); break;
      case 'CDONE': {
        const cur = this.store.get(m.key) || { v: null, ver: 0 };
        if (m.v > cur.ver) this.store.set(m.key, { v: m.value, ver: m.v });
        const cs = this.cold.get(m.key); if (cs) cs.maxV = Math.max(cs.maxV, m.v);
        if (this.coldPend.has(m.op)) { this.coldPend.delete(m.op); this.unpend(m.key, m.op); }
        break;
      }
      case 'CQUERY': {
        const cs = this.coldState(m.key);
        this.send(m.from, { type: 'CSTATE', key: m.key, op: m.op, maxV: cs.maxV });
        break;
      }
      case 'CSTATE': {
        if (!L || !L.established) break;
        const r = L.resolving.get(m.op); if (!r || r.sent) break;
        r.got.set(m.from, m.maxV);
        if (r.got.size >= COLD_Q.filter(q => this.net.replicas[q].up).length || r.got.size >= MAJ) this.fixCold(r);
        break;
      }
      case 'CRESOLVE': {
        if (!L || !L.established) { if (this.leaderView != null && this.leaderView !== this.id) this.send(this.leaderView, { ...m }); break; }
        if (L.resolving.has(m.op)) { const r = L.resolving.get(m.op); if (r.sent) this.sendFix(r); break; }
        const r = { op: m.op, key: m.key, value: m.value, region: m.region, got: new Map(), sent: false };
        L.resolving.set(m.op, r);
        for (const q of COLD_Q) this.send(q, { type: 'CQUERY', key: m.key, op: m.op });
        this.after(260, () => { if (!r.sent && r.got.size) this.fixCold(r); });
        break;
      }
      case 'CFIX': {
        const cs = this.coldState(m.key);
        cs.maxV = Math.max(cs.maxV, m.v);
        if (!this.coldPend.has(m.op)) { this.coldPend.set(m.op, { key: m.key, t }); this.markPend(m.key, m.op); }
        this.send(10 + m.region, { type: 'CVOTE', op: m.op, v: m.v, fixed: true });
        break;
      }
      case 'CATCHUP':
        if (L && L.established) {
          const acc = [...this.accepted.values()];
          this.send(m.from, { type: 'SNAP', store: new Map(this.store), applied: this.applied, ballot: L.ballot, acc, committed: [...this.committed], seen: [...this.seenOps] });
        }
        break;
      case 'SNAP':
        if (!this.catching) break;
        this.store = new Map(m.store); this.applied = m.applied; this.ballot = m.ballot; this.leaderView = m.from;
        this.seenOps = new Set(m.seen);
        for (const e of m.acc) this.accepted.set(e.slot, e);
        for (const s of m.committed) this.committed.add(s);
        this.catching = false; this.lastLeader = t; this.applyReady();
        this.net.log(`${REGIONS[this.id].code} caught up at slot ${this.applied} and asks for a lease.`, 'recover');
        break;
    }
  }

  coldState(key) {
    let cs = this.cold.get(key);
    if (!cs) { cs = { maxV: (this.store.get(key)?.ver) || 0 }; this.cold.set(key, cs); }
    return cs;
  }
  coldWrite(m) {
    if (this.net.classOverride.has(m.key) || this.catching) { this.send(m.from, { type: 'CMOVED', op: m.op }); return; }
    const cs = this.coldState(m.key);
    let v;
    if (this.coldPend.has(m.op)) v = this.coldPend.get(m.op).v;
    else { v = cs.maxV + 1; cs.maxV = v; this.coldPend.set(m.op, { key: m.key, t: this.t, v }); this.markPend(m.key, m.op); }
    this.voted++;
    this.send(m.from, { type: 'CVOTE', op: m.op, v });
  }
  fixCold(r) {
    const L = this.lead; if (!L) return;
    let mx = 0; for (const v of r.got.values()) mx = Math.max(mx, v);
    const next = Math.max(mx, L.coldNext.get(r.key) || 0) + 1;
    L.coldNext.set(r.key, next);
    r.v = next; r.sent = true; this.net.counters.fixed++;
    this.sendFix(r);
  }
  sendFix(r) { for (const q of COLD_Q) this.send(q, { type: 'CFIX', key: r.key, op: r.op, v: r.v, value: r.value, region: r.region }); }

  coAccepted(e, from) {
    let c = this.co.get(e.op.id);
    if (!c) { c = { entry: e, acc: new Map(), done: false }; this.co.set(e.op.id, c); }
    c.entry = e;
    if (!c.acc.has(from)) c.acc.set(from, this.t);
    if (c.done) return;
    const live = this.net.leader()?.responderSet() || e.resp;
    const required = e.resp.filter(r => live.includes(r));
    if (c.acc.size >= MAJ && required.every(r => c.acc.has(r))) {
      c.done = true; this.served++;
      this.send(10 + e.op.region, { type: 'DONE', op: e.op.id, slot: e.slot, acc: [...c.acc.entries()], co: this.id });
      this.after(2000, () => this.co.delete(e.op.id));
    }
  }
}

class Client {
  constructor(net, region) { this.net = net; this.region = region; this.id = 10 + region; this.up = true; this.live = new Map(); }
  get t() { return this.net.t; }
  send(to, msg) { this.net.send(this.id, to, msg); }

  nearest(cands) {
    return [...cands].sort((a, b) => (a === this.region ? 0 : OW[this.region][a]) - (b === this.region ? 0 : OW[this.region][b]));
  }

  start(op) {
    this.live.set(op.id, op);
    const net = this.net;
    if (op.kind === 'read') {
      const c = net.baseCls(op.key);
      op.cands = this.nearest(c === 'cold' ? COLD_Q : [0, 1, 2, 3, 4]);
      op.tryIdx = 0; op.path = 'read';
      this.readAt(op);
      return;
    }
    if (op.kind === 'xfer' || op.kind === 'faucet') { op.path = op.kind === 'xfer' ? 'xfer' : 'faucet'; this.toLeader(op, 'ordinary'); return; }
    const c = net.cls(op.key);
    if (c === 'cold') { op.path = 'cold'; this.coldStart(op); return; }
    if (c === 'hot') { op.path = 'hot'; this.toLeader(op, 'hot'); return; }
    op.path = 'ordinary'; this.toLeader(op, 'ordinary');
  }

  readAt(op) {
    const r = op.cands[op.tryIdx % op.cands.length];
    op.target = r;
    this.send(r, { type: 'READ', op: op.id, key: op.key });
    const rtt = 2 * (r === this.region ? METRO : OW[this.region][r] + METRO);
    const my = op.tryIdx;
    const retry = () => {
      if (op.done || op.tryIdx !== my) return;
      if (op.isHeld && this.t - op.start < 3000) { this.net.after(100, retry); return; }
      op.isHeld = false; op.retries++; this.net.counters.retries++; op.tryIdx++; op.retried = true; this.readAt(op);
    };
    this.net.after(rtt * 1.6 + 60, retry);
  }

  spec(op, mode) {
    return { id: op.id, kind: op.kind, key: op.key, value: op.value, from: op.from, to: op.to, amt: op.amt, region: this.region, mode, co: op.co ?? this.region };
  }

  toLeader(op, mode, moveKey = false) {
    op.mode = mode;
    if (mode === 'hot') {
      // the completion owner is the replica in the client's own region, if it answers
      if (op.co == null) op.co = this.net.replicas[this.region].up ? this.region : this.net.leaderHint;
    }
    this.send(this.net.leaderHint, { type: 'WRITE', op: op.id, opSpec: this.spec(op, mode), moveKey });
    const my = (op.sendN = (op.sendN || 0) + 1);
    this.net.after(900, () => {
      if (op.done || op.sendN !== my) return;
      op.retries++; this.net.counters.retries++;
      if (mode === 'hot') op.co = this.net.leaderHint;
      this.toLeader(op, mode, moveKey);
    });
  }

  coldStart(op) {
    op.cvotes = new Map(); op.mode = 'cold';
    for (const q of COLD_Q) this.send(q, { type: 'CWRITE', op: op.id, key: op.key, value: op.value });
    const far = Math.max(...COLD_Q.map(q => q === this.region ? METRO : OW[this.region][q] + METRO));
    op.coldTimeout = 2 * far * 1.25 + 30;
    this.net.after(op.coldTimeout, () => {
      if (op.done || op.resolving || op.moved) return;
      if (op.cvotes.size < COLD_Q.length) this.coldFallback(op);
    });
  }
  coldFallback(op) {
    op.moved = true; op.path = 'cold→log';
    this.toLeader(op, 'ordinary', true);
  }
  coldCheck(op) {
    if (op.done) return;
    if (op.cvotes.size < COLD_Q.length) return;
    const vs = [...op.cvotes.values()];
    const fixedAll = vs.every(x => x.fixed);
    const same = vs.every(x => x.v === vs[0].v);
    if (same && (!op.resolving || fixedAll)) {
      const v = vs[0].v;
      for (const q of COLD_Q) this.send(q, { type: 'CDONE', op: op.id, key: op.key, v, value: op.value });
      this.finish(op, { version: v, marks: this.marksFrom(op.cvotes, COLD_Q) });
    } else if (!op.resolving) {
      op.resolving = true; op.path = 'cold·fixed';
      op.cvotes = new Map();
      this.send(this.net.leaderHint, { type: 'CRESOLVE', op: op.id, key: op.key, value: op.value, region: this.region });
      this.net.after(1200, () => { if (!op.done && !op.moved) this.coldFallback(op); });
    }
  }

  marksFrom(map, required) {
    // map: replica -> { at } ; returns per-lane marks and the critical replica
    const marks = new Array(N).fill(null);
    let crit = null, last = -1;
    for (const [r, x] of map) {
      marks[r] = { role: 'v', at: x.at };
      if (required.includes(r) && x.at > last) { last = x.at; crit = r; }
    }
    if (crit != null) marks[crit].role = 'c';
    for (let i = 0; i < N; i++) if (!this.net.replicas[i].up) marks[i] = { role: 'x' };
    return { marks, critical: crit };
  }

  finish(op, info) {
    this.live.delete(op.id);
    const mk = info.marks || {};
    delete info.marks;
    this.net.complete(op, { ...info, marks: mk.marks || null, critical: mk.critical ?? null, leader: this.net.leaderTruth });
  }

  recv(m) {
    const op = this.net.opById.get(m.op);
    if (m.type === 'NEWLEADER') { this.net.leaderHint = m.id; return; }
    if (!op || op.done) return;
    const at = this.t - op.start;
    switch (m.type) {
      case 'READ_OK': {
        const marks = new Array(N).fill(null);
        marks[m.from] = { role: m.held ? 'h' : 'a', at };
        for (let i = 0; i < N; i++) if (!this.net.replicas[i].up) marks[i] = { role: 'x' };
        if (op.retried) op.path = 'read·retry';
        else if (m.held) op.path = 'read·held';
        this.finish(op, { value: m.value, version: m.ver, held: m.held, heldMs: m.heldMs, marks: { marks, critical: m.from }, answeredBy: m.from });
        break;
      }
      case 'HELD':
        if (op.kind === 'read' && m.from === op.target) op.isHeld = true;
        break;
      case 'NACK':
        if (op.kind === 'read') { op.tryIdx++; op.retried = true; this.net.after(40, () => { if (!op.done) this.readAt(op); }); }
        break;
      case 'VOTE': {
        op.votes.set(m.from, { at, resp: m.resp });
        op.slot = m.slot; op.ok = m.ok;
        const resp = m.resp;
        if (op.votes.size >= MAJ && resp.every(r => op.votes.has(r))) {
          const mk = this.marksFrom(op.votes, resp);
          mk.marks[this.net.leaderTruth] = mk.marks[this.net.leaderTruth] ? { ...mk.marks[this.net.leaderTruth], lead: true } : { role: 'l', lead: true };
          this.finish(op, { slot: m.slot, result: op.kind === 'xfer' ? (m.ok ? 'applied' : 'rejected: balance') : 'ok', marks: mk });
        }
        break;
      }
      case 'LCOMMIT': {
        const mk = this.marksFrom(op.votes, []);
        mk.critical = this.net.leaderTruth;
        if (mk.marks[this.net.leaderTruth]) mk.marks[this.net.leaderTruth].role = 'c'; else mk.marks[this.net.leaderTruth] = { role: 'c', lead: true };
        op.leaseWait = !!m.waited;
        this.finish(op, { slot: m.slot, result: op.kind === 'xfer' ? (op.ok === false ? 'rejected: balance' : 'applied') : 'ok', marks: mk, leaseWait: !!m.waited });
        break;
      }
      case 'DONE': {
        const map = new Map(m.acc.map(([r, a]) => [r, { at: a - op.start }]));
        const mk = this.marksFrom(map, m.acc.map(x => x[0]));
        if (mk.marks[m.co]) mk.marks[m.co].co = true;
        if (mk.marks[this.net.leaderTruth]) mk.marks[this.net.leaderTruth].lead = true;
        this.finish(op, { slot: m.slot, result: 'ok', marks: mk, co: m.co });
        break;
      }
      case 'CVOTE':
        if (op.moved) break;
        if (op.resolving && !m.fixed) break;
        op.cvotes.set(m.from, { at, v: m.v, fixed: !!m.fixed });
        this.coldCheck(op);
        break;
      case 'CMOVED':
        if (!op.moved) this.coldFallback(op);
        break;
    }
  }
}
