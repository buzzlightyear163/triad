import { Net, REGIONS, N, COLD_Q, LEASE_LOCAL, randAddr, PREF } from './net.js';
import { Stage, glyphSVG, TAG, PATHNAME, isBad, fmtMs, drawOpDiagram, RECEIPT } from './viz.js';
import { CONFIG } from './config.js';

/* ------------------------------------------------------------------ network clock */
const net = new Net({ rate: 14, mix: 'A' });
window.agree = net;
let last = performance.now();
const tick = (now) => { net.advance(now - last); last = now; requestAnimationFrame(tick); };
requestAnimationFrame(tick);
setInterval(() => { const now = performance.now(); if (now - last > 250) { net.advance(now - last); last = now; } }, 250);

/* ------------------------------------------------------------------ helpers */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt = (n) => Number(n).toLocaleString('en-US');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const utc = (t, ms = true) => new Date(net.wall(t)).toISOString().slice(11, ms ? 23 : 19) + ' UTC';
const short = (a) => a && a.length > 14 ? a.slice(0, 6) + '…' + a.slice(-4) : a;
const code = (i) => REGIONS[i].code;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 1600); }
function copy(text) { navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Copy failed')); }
window.__copy = copy;

/* detours (for the fault counter) */
let detours = 0, agreed = 0;
const recent = [];
net.on((type, op) => {
  if (type !== 'op') return;
  agreed++; if (isBad(op)) detours++;
  recent.push({ t: op.end }); while (recent.length && recent[0].t < net.t - 10000) recent.shift();
  Sound.row(isBad(op));
});
const opsPerSec = () => recent.length / 10;

/* ------------------------------------------------------------------ you */
function guessRegion() {
  const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  if (/London|Dublin|Lisbon/.test(tz)) return 1;
  if (/^Europe|^Africa/.test(tz)) return 0;
  if (/Sao_Paulo|Argentina|Santiago|Bogota|Lima|Montevideo|Caracas/.test(tz)) return 3;
  if (/^America/.test(tz)) return 2;
  if (/^Asia|^Australia|^Pacific/.test(tz)) return 4;
  return 0;
}
let ME;
try { ME = JSON.parse(localStorage.getItem('agree.me') || 'null'); } catch { ME = null; }
if (!ME || !ME.addr) ME = { addr: randAddr(44), region: guessRegion() };
const saveMe = () => { try { localStorage.setItem('agree.me', JSON.stringify(ME)); } catch { } };
saveMe();
const myOps = [];
function mine(spec) {
  return new Promise((resolve) => {
    const op = net.submit({ ...spec, region: spec.region ?? ME.region, mine: true, resolve });
    myOps.unshift(op); if (myOps.length > 60) myOps.pop();
  });
}

/* ------------------------------------------------------------------ sound: a dot-matrix printer */
const Sound = {
  on: (() => { try { return localStorage.getItem('agree.sound') === 'on'; } catch { return false; } })(),
  ctx: null, buf: null, lastAt: 0,
  init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    this.ctx = new C();
    const len = Math.floor(this.ctx.sampleRate * 0.006);
    this.buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  },
  toggle() {
    this.on = !this.on; try { localStorage.setItem('agree.sound', this.on ? 'on' : 'off'); } catch { }
    if (this.on) { this.init(); this.ctx?.resume(); }
    $$('.snd small').forEach(e => e.textContent = this.on ? 'on' : 'off');
  },
  row(bad) {
    if (!this.on || !this.ctx || document.hidden) return;
    const now = this.ctx.currentTime; if (now - this.lastAt < 0.05) return; this.lastAt = now;
    for (let i = 0; i < 5; i++) {
      const s = this.ctx.createBufferSource(); s.buffer = this.buf;
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = bad ? 900 : 2300 + Math.random() * 500; f.Q.value = 5;
      const g = this.ctx.createGain(); g.gain.value = 0.11;
      s.connect(f); f.connect(g); g.connect(this.ctx.destination);
      s.start(now + i * 0.011);
    }
  },
};
document.addEventListener('click', (e) => { if (e.target.closest('.snd')) { e.preventDefault(); Sound.toggle(); } });

/* ------------------------------------------------------------------ chrome */
const markHTML = `<span class="mark"><i></i><i></i><i></i><i class="o"></i><i class="o"></i></span>`;
const brand = `<a class="brand" href="/">${markHTML}AGREE</a>`;
const sndBtn = () => `<button class="snd" type="button">Sound<small>${Sound.on ? 'on' : 'off'}</small></button>`;
const xLink = () => CONFIG.x ? `<a href="${esc(CONFIG.x)}" target="_blank" rel="noopener">On X</a>` : '';
const caBox = () => CONFIG.ca ? `<span class="ca">CA <span>${esc(CONFIG.ca)}</span><button type="button" data-copy="${esc(CONFIG.ca)}">Copy</button></span>` : '';
document.addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b) { e.preventDefault(); copy(b.dataset.copy); } });

function innerHeader(path) {
  const on = (p) => (path === p ? 'on' : '');
  return `<header class="ihdr"><div class="row1">${brand}
    <nav class="nav">
      <a class="${on('/app')}" href="/app">Live</a>
      <a class="${on('/write')}" href="/write">Write</a>
      <a class="${on('/explorer')}" href="/explorer">Explorer</a>
      <a class="${on('/replicas')}" href="/replicas">Replicas</a>
      <a class="hide-s" href="/replicas#lab">Fault lab</a>
    </nav><span class="sp"></span>
    <nav class="nav">${sndBtn()}${xLink()}</nav>
    <a class="btn sm hide-s" href="/write">Write something</a></div>
    <div class="row2">
      <a class="${on('/status')}" href="/status">Status</a>
      <a class="${on('/measurements')}" href="/measurements">Measurements</a>
      <a class="${on('/how-it-works')}" href="/how-it-works">How it works</a>
      <a class="${on('/paper')}" href="/paper">The paper</a>
      <a class="${on('/token')}" href="/token">Token</a>
      <a class="${on('/burns')}" href="/burns">Burn record</a>
      <span class="sp" style="flex:1"></span>${caBox()}
    </div></header>`;
}
const pageFoot = () => `<footer class="pfoot"><span><b>AGREE</b> · Consensus, written by a machine.</span><span class="mono">All times are UTC. Regions are emulated: the five replicas run in this tab, with real inter-region delays between them.</span></footer>`;

/* ------------------------------------------------------------------ router */
const routes = {
  '/': home, '/app': live, '/write': write, '/explorer': explorer, '/replicas': replicas, '/status': status,
  '/measurements': measurements, '/how-it-works': how, '/paper': paper, '/token': token, '/burns': burns,
};
let cleanups = [];
const onCleanup = (fn) => cleanups.push(fn);
function every(ms, fn) { fn(); const h = setInterval(fn, ms); onCleanup(() => clearInterval(h)); }
function render() {
  cleanups.forEach(f => { try { f(); } catch (e) { console.error(e); } }); cleanups = [];
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const fn = routes[path] || notFound;
  document.body.classList.toggle('is-home', fn === home);
  fn($('#root'), path);
  if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 30); }
  else window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a'); if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin) return;
  const p = u.pathname.replace(/\/+$/, '') || '/';
  if (!routes[p]) return;
  e.preventDefault();
  if (p === location.pathname && u.hash) { const el = document.getElementById(u.hash.slice(1)); if (el) { history.replaceState(null, '', u.pathname + u.hash); el.scrollIntoView({ behavior: 'smooth' }); return; } }
  history.pushState(null, '', u.pathname + u.search + u.hash); render();
});
window.addEventListener('popstate', render);

/* ------------------------------------------------------------------ HOME */
function home(root) {
  document.title = 'AGREE · Consensus, written by a machine.';
  const sections = [
    ['printout', 'The printout'], ['reads', 'Reads stay local'], ['writes', 'Three ways to write'],
    ['receipt', 'Written in a day'], ['measured', 'Measured here'], ['fault', 'Crash a replica'],
  ];
  root.innerHTML = `
  <header class="hdr">${brand}<nav class="nav"><a href="/app">App</a><a href="/explorer">Explorer</a><a class="hide-s" href="/paper">Paper</a>${xLink()}${sndBtn()}</nav></header>
  <div class="home">
    <div class="text">
      <section class="sec" data-i="0" id="top">
        <h1>Consensus,<br>written by<br>a machine.</h1>
        <p class="lede">The first public network running A‑GREEMENT, the consensus protocol an AI agent designed, built and proved safe in about a day.</p>
        <div class="big"><span id="h-ms">—</span><small>ms to agree</small></div>
        <div class="sub" id="h-sub">waiting for the first write…</div>
        <p style="margin-top:16px;font-size:15px">One line for every operation the network agreed on: who answered, who voted, and how long it took.</p>
        <div class="ctas"><a class="btn" href="/write">Write something</a><a class="link" href="/app">Watch live</a></div>
      </section>
      <section class="sec" data-i="1">
        <h2>Reads stay<br>local.</h2>
        <p>A replica that holds a lease answers a read on its own, from the city it sits in. No leader, no vote: one round trip to one replica.</p>
        <p>If a write to that key is still in flight, the replica holds the read until the write lands. A long stroke on the right is a read that waited.</p>
        <div class="stats3">
          <span class="k">p50</span><span class="v"><span id="r-p50">—</span><small>ms</small></span>
          <span class="k">held</span><span class="v"><span id="r-held">—</span><small>reads</small></span>
          <span class="k">leases</span><span class="v"><span id="r-lease">—</span><small>of 5</small></span>
        </div>
        <div class="sub" id="r-last"></div>
      </section>
      <section class="sec" data-i="2">
        <h2>Three ways<br>to write.</h2>
        <p>A‑GREEMENT sorts keys by how often they are touched, and gives each kind its own path.</p>
        <ul class="legend" style="font-family:var(--sans);font-size:15.5px;gap:12px;max-width:31em">
          <li style="display:block"><b>Cold keys</b>, rarely touched: the client writes straight to a fixed quorum, fra lon nyc. Three matching votes and it is done, in one round trip.</li>
          <li style="display:block"><b>Ordinary keys</b>: the leader orders the write, and every replica votes straight back to the client.</li>
          <li style="display:block"><b>Hot keys</b>: the leader orders the write, and a replica near the client collects the votes and answers.</li>
        </ul>
        <p class="sub" style="margin-top:18px">Each panel replays the latest write of its kind, slowed down. Every arrow is a real message, with the delay between the two cities.</p>
      </section>
      <section class="sec" data-i="3">
        <h2>Written<br>in a day.</h2>
        <p>The paper behind it, <i>The End of Consensus Research?</i> (arXiv 2610.30114, October 2026), gave a general-purpose coding agent a library of 22 consensus papers, a skeleton to build in, and a proof checker.</p>
        <p>About 24 hours later it had A‑GREEMENT: a new protocol, implemented, tested under crashes, and proved safe in Lean. API-equivalent cost: $198.69.</p>
        <p>Across six emulated deployments it cut mean latency by 12.2% on write-heavy loads and 33.3% on read-heavy ones, against the fastest protocol the authors could find.</p>
        <div class="ctas"><a class="link" href="${CONFIG.paper}" target="_blank" rel="noopener">Read the paper</a><a class="link" href="/paper">What we built on it</a></div>
      </section>
      <section class="sec" data-i="4">
        <h2>Measured<br>here.</h2>
        <p>Every operation leaves a mark at its time, on a log scale. The two rules stand at the median and the ninetieth percentile of each path.</p>
        <div class="stats3">
          <span class="k">read</span><span class="v"><span id="m-read">—</span><small>ms p50</small></span>
          <span class="k">cold</span><span class="v"><span id="m-cold">—</span><small>ms p50</small></span>
          <span class="k">log</span><span class="v"><span id="m-log">—</span><small>ms p50</small></span>
        </div>
        <div class="ctas"><a class="link" href="/measurements">Measurements</a><a class="link" href="/how-it-works">How it works</a></div>
      </section>
      <section class="sec" data-i="5">
        <h2>Crash a<br>replica.</h2>
        <p>Replicas fail by stopping. Kill the leader and the others notice the silence, pick a new one, and wait for the old leases to run out before a write completes. Kill a cold-quorum member and cold writes fall back to the shared log.</p>
        <div class="big red" style="margin-top:6px"><span id="f-det">0</span></div>
        <div class="sub">of <span id="f-all">0</span> operations took a detour: a retry, a held write or a fallback.</div>
        <div class="faultbtns">
          <button class="btn sm redb" data-crash="leader">Crash the leader</button>
          <button class="btn sm ghost" data-crash="2">Crash nyc</button>
          <button class="btn sm ghost" data-crash="4">Crash tyo</button>
          <button class="btn sm ghost" data-crash="replace">Replace crashed</button>
        </div>
        <ul class="flog" id="f-log"></ul>
        <div class="ctas" style="margin-top:20px"><a class="btn" href="/write">Write something</a><a class="link" href="/replicas#lab">Open the fault lab</a></div>
      </section>
    </div>
    <div class="stage"><canvas id="stage"></canvas></div>
  </div>
  <div class="cabox">${caBox()}</div>
  <div class="ind"><span id="ind-n">1 / 6</span><span class="name" id="ind-name">The printout</span><span class="dash">${sections.map((_, i) => `<button aria-label="${sections[i][1]}" data-go="${i}"></button>`).join('')}</span></div>
  ${homeFooter()}`;

  const mobile = matchMedia('(max-width: 900px)').matches;
  const stage = new Stage($('#stage'), net, { mode: 'printout', bottomPad: mobile ? 0 : 46 });
  onCleanup(() => stage.destroy());
  const secs = $$('.sec', root);
  const setActive = (i) => {
    stage.setMode(sections[i][0]);
    $('#ind-n').textContent = `${i + 1} / 6`; $('#ind-name').textContent = sections[i][1];
    $$('.ind .dash button').forEach((b, j) => b.classList.toggle('on', j === i));
    $('.cabox').style.opacity = i === 0 ? 1 : 0;
  };
  setActive(0);
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) setActive(+e.target.dataset.i);
  }, { rootMargin: '-48% 0px -48% 0px' });
  secs.forEach(s => io.observe(s));
  onCleanup(() => io.disconnect());
  const io2 = new IntersectionObserver((ents) => { for (const e of ents) $('.ind').style.opacity = e.isIntersecting ? 0 : 1; }, { rootMargin: '0px 0px -30% 0px' });
  io2.observe($('.foot')); onCleanup(() => io2.disconnect());
  $$('.ind .dash button').forEach(b => b.addEventListener('click', () => secs[+b.dataset.go].scrollIntoView({ behavior: 'smooth' })));

  // hero numbers
  let lastHero = 0;
  const off = net.on((type, op) => {
    if (type !== 'op' || op.kind === 'read') return;
    const now = performance.now(); if (now - lastHero < 260) return; lastHero = now;
    $('#h-ms').textContent = op.ms.toFixed(1);
    $('#h-ms').classList.toggle('red', isBad(op));
    const r = net.summary('read'), c = net.summaryOf(['ordinary', 'hot', 'xfer', 'cold']);
    $('#h-sub').innerHTML = `op ${fmt(op.id)} final · ${esc(PATHNAME[op.path] || op.path)}<br>reads p50 ${r ? r.p50.toFixed(1) : '—'} · writes p50 ${c ? c.p50.toFixed(1) : '—'} · p90 ${c ? c.p90.toFixed(1) : '—'}`;
  });
  onCleanup(off);
  every(700, () => {
    const r = net.summary('read'); if (r) $('#r-p50').textContent = r.p50.toFixed(1);
    $('#r-held').textContent = fmt(net.counters.held);
    $('#r-lease').textContent = net.replicas.filter(x => x.hasLease()).length;
    const lr = [...net.ops].reverse().find(o => o.kind === 'read');
    if (lr) $('#r-last').textContent = `last read: ${lr.key} answered by ${code(lr.answeredBy)} in ${lr.ms.toFixed(1)} ms${lr.held ? `, held ${lr.heldMs.toFixed(0)} ms` : ''}`;
    const m = (p) => { const s = Array.isArray(p) ? net.summaryOf(p) : net.summary(p); return s ? s.p50.toFixed(1) : '—'; };
    $('#m-read').textContent = m('read'); $('#m-cold').textContent = m('cold'); $('#m-log').textContent = m(['ordinary', 'hot', 'xfer']);
    $('#f-det').textContent = fmt(detours); $('#f-all').textContent = fmt(agreed);
    $('#f-log').innerHTML = net.events.slice(-5).reverse().map(e => `<li class="${e.kind === 'fault' ? 'fault' : ''}"><span>${utc(e.t, false).slice(0, 8)}</span><span>${esc(e.text)}</span></li>`).join('');
  });
  bindCrash(root);
}
function homeFooter() {
  return `<footer class="foot"><div class="cols">
    <p class="tok">$AGREE is the gas of the AGREE network: every write and every transfer burns a little, and reads are free. It enters one way: burned on Solana, issued on AGREE. Until the switch, the network runs on test coins. <a class="link" href="/token">Token</a></p>
    <div class="links"><a href="/app">Live</a><a href="/write">Write</a><a href="/explorer">Explorer</a><a href="/replicas">Replicas</a><a href="/how-it-works">How it works</a><a href="/paper">The paper</a><a href="/measurements">Measurements</a><a href="/status">Status</a><a href="/token">Token</a><a href="/burns">Burn record</a></div>
  </div>
  <div class="wordmark">AGREE</div>
  <div class="fine">All times are UTC.<br>Regions are emulated: all five replicas run in your browser tab, with real inter-region delays inserted between them.<br>AGREE is an independent build of a published paper and is not affiliated with its authors.</div>
  </footer>`;
}
function bindCrash(root) {
  $$('[data-crash]', root).forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.crash;
    if (v === 'leader') { const L = net.leader(); if (L) net.crash(L.id); else toast('No leader right now: an election is running'); }
    else if (v === 'replace') { let n = 0; net.replicas.forEach(r => { if (!r.up) { net.restart(r.id); n++; } }); if (!n) toast('Every replica is up'); }
    else if (v === 'race') raceCold();
    else { const id = +v; if (!net.replicas[id].up) toast(`${code(id)} is already down`); else if (net.replicas.filter(r => r.up).length <= 3) toast('Keep a majority: three replicas must stay up'); else net.crash(id); }
  }));
}
function raceCold() {
  const key = 'k0' + (700 + ((Math.random() * 280) | 0));
  mine({ kind: 'write', key, value: 'race-A', region: 0 });
  mine({ kind: 'write', key, value: 'race-B', region: 4 });
  toast(`Two cold writes to ${key}, from fra and tyo`);
}

/* ------------------------------------------------------------------ LIVE */
function live(root, path) {
  document.title = 'Live · AGREE';
  root.innerHTML = `${innerHeader(path)}<main class="page">
    <div class="toprow"><h1>Live</h1><span class="livepill"><i></i><span id="l-pill">Live.</span></span></div>
    <div class="grid-live">
      <div><div class="muted" style="font-size:14px">Last operation, client to agreed</div><div class="bignum" id="l-ms">—</div><div class="sub" id="l-sub">ms</div></div>
      <div class="cards" id="l-cards"></div>
    </div>
    <h2>The printout</h2>
    <p class="note">One line for every operation, newest at the bottom. Columns: operation number, ms from the client sending it to the client knowing it is agreed, the path it took, then the five replicas.</p>
    <div class="box"><canvas id="l-stage" style="height:min(620px,70vh)"></canvas></div>
    ${legend()}
  </main>${pageFoot()}`;
  const stage = new Stage($('#l-stage'), net, { mode: 'printout', sheet: true });
  onCleanup(() => stage.destroy());
  const off = net.on((type, op) => {
    if (type !== 'op') return;
    $('#l-ms').textContent = fmtMs(op.ms); $('#l-ms').classList.toggle('red', isBad(op));
    $('#l-sub').textContent = `ms · op ${fmt(op.id)} · ${PATHNAME[op.path] || op.path}`;
    $('#l-pill').textContent = `Live. Op ${fmt(op.id)} agreed at ${utc(op.end)}`;
  });
  onCleanup(off);
  every(800, () => {
    const s = (p) => (Array.isArray(p) ? net.summaryOf(p) : net.summary(p));
    const r = s('read'), c = s('cold'), l = s(['ordinary', 'hot', 'xfer', 'faucet']);
    const L = net.leader();
    $('#l-cards').innerHTML = [
      ['Read p50, recent', r ? `${r.p50.toFixed(1)}<small> ms</small>` : '—'],
      ['Read p90', r ? `${r.p90.toFixed(1)}<small> ms</small>` : '—'],
      ['Cold write p50', c ? `${c.p50.toFixed(1)}<small> ms</small>` : '—'],
      ['Log write p50', l ? `${l.p50.toFixed(1)}<small> ms</small>` : '—'],
      ['Operations per second', opsPerSec().toFixed(1)],
      ['Leader', L ? `${code(L.id)}<small> · term ${net.term}</small>` : '<span class="red">electing</span>'],
    ].map(([k, v]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  });
}
function legend() {
  const g = (marks) => glyphSVG({ marks }, 15);
  const one = (m) => g([m, null, null, null, null]).replace('<span class="glyphs"', '<span class="glyphs" style="width:15px;overflow:hidden"');
  return `<ul class="legend" style="margin-top:16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
    <li>${one({ role: 'a' })} answered the read</li>
    <li>${one({ role: 'h' })} answered after holding it behind a write</li>
    <li>${one({ role: 'v' })} voted for the write</li>
    <li>${one({ role: 'c' })} the vote the client waited for last</li>
    <li>${one({ role: 'v', lead: true })} the leader, which ordered it</li>
    <li>${one({ role: 'v', co: true })} the completion owner (hot keys)</li>
    <li>${one({ role: 'x' })} crashed</li>
    <li><span class="mono" style="width:15px;text-align:center">·</span> not involved</li>
  </ul>`;
}

/* ------------------------------------------------------------------ WRITE */
function write(root, path) {
  document.title = 'Write · AGREE';
  const accts = net.accounts;
  root.innerHTML = `${innerHeader(path)}<main class="page">
    <h1>Write something</h1>
    <p class="intro">Make a key in the browser, take test coins from the faucet, and write. Each result shows which path your operation took, which replicas voted, and the ms from your client sending it to your client knowing it is agreed.</p>
    <div class="panels">
      <div class="panel"><h3>Your key</h3>
        <dl class="kv"><dt>Address</dt><dd><span id="w-addr"></span> <a href="#" id="w-copy">copy</a></dd>
        <dt>Balance</dt><dd id="w-bal">—</dd><dt>Your line</dt><dd id="w-note">—</dd></dl>
        <div class="field" style="margin-top:14px"><label for="w-region">Your client sits in</label>
          <select id="w-region">${REGIONS.map(r => `<option value="${r.id}">${r.name} (${r.code})</option>`).join('')}</select></div>
        <button class="btn sm ghost" id="w-new" type="button">Make a new key</button>
      </div>
      <div class="panel"><h3>Test coins</h3>
        <p class="note">The faucet writes through the shared log: the leader orders it and every replica votes.</p>
        <button class="btn" id="w-faucet" type="button">Take 1,000 test coins</button>
      </div>
      <div class="panel"><h3>Send</h3>
        <div class="field"><label for="w-to">To address</label><input id="w-to" spellcheck="false" autocomplete="off" value="${accts[(Math.random() * accts.length) | 0]}"></div>
        <div class="inline"><div class="field"><label for="w-amt">Amount</label><input id="w-amt" inputmode="decimal" value="25"></div><button class="btn" id="w-send" type="button" style="margin-bottom:14px">Send</button></div>
      </div>
      <div class="panel"><h3>Write a line</h3>
        <p class="note">Stored under your own key, which nobody else writes: a cold key, so it takes the one-round-trip path.</p>
        <div class="inline"><div class="field"><label for="w-line">Up to 48 characters</label><input id="w-line" maxlength="48" placeholder="gm from the machine"></div><button class="btn" id="w-write" type="button" style="margin-bottom:14px">Write</button></div>
      </div>
      <div class="panel"><h3>Read a key</h3>
        <p class="note">Keys k0001 to k1000 are busy all the time; k0001 to k0008 are hot. Your line lives at note:your-address.</p>
        <div class="inline"><div class="field"><label for="w-key">Key</label><input id="w-key" spellcheck="false" value="k0001"></div><button class="btn" id="w-read" type="button" style="margin-bottom:14px">Read</button></div>
      </div>
    </div>
    <h2>Your results</h2>
    <div id="w-results"></div>
  </main>${pageFoot()}`;
  const show = () => {
    $('#w-addr').textContent = ME.addr; $('#w-region').value = ME.region;
    const rep = net.replicas[ME.region].up ? net.replicas[ME.region] : net.leader();
    const b = rep?.store.get('acct:' + ME.addr)?.v ?? 0;
    $('#w-bal').textContent = `${fmt(b)} test AGREE (${rep ? code(rep.id) + "'s copy" : 'no replica'})`;
    const nrep = net.replicas.find(r => COLD_Q.includes(r.id) && r.up);
    const n = nrep?.store.get('note:' + ME.addr)?.v;
    $('#w-note').textContent = n ? `“${n}”` : '—';
  };
  every(600, show);
  $('#w-copy').addEventListener('click', (e) => { e.preventDefault(); copy(ME.addr); });
  $('#w-region').addEventListener('change', (e) => { ME.region = +e.target.value; saveMe(); show(); });
  $('#w-new').addEventListener('click', () => { ME.addr = randAddr(44); saveMe(); show(); toast('New key made in your browser'); });
  let lastFaucet = -1e9;
  $('#w-faucet').addEventListener('click', async () => {
    if (performance.now() - lastFaucet < 8000) { toast('One faucet drip every 8 seconds'); return; }
    lastFaucet = performance.now();
    await mine({ kind: 'faucet', to: ME.addr, amt: 1000 }); paint();
  });
  $('#w-send').addEventListener('click', async () => {
    const to = $('#w-to').value.trim(); const amt = Math.floor(+$('#w-amt').value);
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(to)) { toast('That does not look like an address'); return; }
    if (!(amt > 0)) { toast('Amount must be a whole number above 0'); return; }
    await mine({ kind: 'xfer', from: ME.addr, to, amt }); paint();
  });
  $('#w-write').addEventListener('click', async () => {
    const v = $('#w-line').value.trim().slice(0, 48); if (!v) { toast('Type a line first'); return; }
    await mine({ kind: 'write', key: 'note:' + ME.addr, value: v }); $('#w-line').value = ''; paint();
  });
  $('#w-read').addEventListener('click', async () => {
    let k = $('#w-key').value.trim(); if (/^\d+$/.test(k)) k = 'k' + k.padStart(4, '0');
    if (!/^(k\d{4}|note:[1-9A-HJ-NP-Za-km-z]{32,48}|acct:[1-9A-HJ-NP-Za-km-z]{32,48})$/.test(k)) { toast('Try k0001 to k1000, note:address or acct:address'); return; }
    await mine({ kind: 'read', key: k }); paint();
  });
  const paint = () => {
    $('#w-results').innerHTML = myOps.length ? myOps.map(op => {
      const what = op.kind === 'read' ? `Read ${esc(op.key)}` : op.kind === 'faucet' ? 'Took 1,000 test coins' : op.kind === 'xfer' ? `Sent ${fmt(op.amt)} to ${esc(short(op.to))}` : `Wrote “${esc(op.value)}”`;
      if (!op.done) return `<div class="result"><span class="what">${what}</span><span>sending…</span></div>`;
      const extra = op.kind === 'read' ? ` · value ${esc(op.value ?? 'none')} · version ${op.version}` : op.slot ? ` · log slot ${fmt(op.slot)}` : op.version ? ` · key version ${op.version}` : '';
      const res = op.result && op.result !== 'ok' ? ` · <span class="${op.result.startsWith('rejected') ? 'red' : ''}">${esc(op.result)}</span>` : '';
      return `<div class="result"><span class="what">${what}</span><span class="${isBad(op) ? 'red' : ''}">${fmtMs(op.ms)} ms</span>
        <span>${esc(PATHNAME[op.path] || op.path)}${extra}${res}</span><span>${glyphSVG(op)} <a href="/explorer#op-${op.id}">op ${fmt(op.id)}</a></span></div>`;
    }).join('') : '<p class="empty">Nothing yet. Take some test coins, then send or write.</p>';
  };
  paint(); every(500, () => { if (myOps.some(o => !o.done)) paint(); });
}

/* ------------------------------------------------------------------ EXPLORER */
function explorer(root, path) {
  document.title = 'Explorer · AGREE';
  root.innerHTML = `${innerHeader(path)}<main class="page">
    <h1>Explorer</h1>
    <p class="intro">Look up an operation, a key or an address, read straight from this network's replicas.</p>
    <form id="x-form" class="inline" style="max-width:820px"><div class="field"><label for="x-q">Operation number, key (k0042, note:…, acct:…) or address</label><input id="x-q" spellcheck="false" autocomplete="off"></div><button class="btn" style="margin-bottom:14px">Look up</button></form>
    <div id="x-detail"></div>
    <div class="toprow" style="margin-top:30px"><h2 style="margin:0">Latest operations</h2><span class="note">Newest first, refreshed twice a second. Pauses while you point at it.</span></div>
    <div class="chips" id="x-chips">${['All', 'Reads', 'Writes', 'Yours', 'Detours'].map((c, i) => `<button class="chip ${i ? '' : 'on'}" data-f="${c}">${c}</button>`).join('')}</div>
    <div class="tw"><table class="t"><thead><tr><th>Op</th><th>Agreed at</th><th>Kind</th><th>Key</th><th>Path</th><th>fra lon nyc gru tyo</th><th>Client</th><th style="text-align:right">ms</th></tr></thead><tbody id="x-rows"></tbody></table></div>
  </main>${pageFoot()}`;
  let filter = 'All';
  $$('#x-chips .chip').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; $$('#x-chips .chip').forEach(x => x.classList.toggle('on', x === b)); rows(); }));
  const keep = (op) => filter === 'All' || (filter === 'Reads' && op.kind === 'read') || (filter === 'Writes' && op.kind !== 'read') || (filter === 'Yours' && op.mine) || (filter === 'Detours' && isBad(op));
  const kindName = (op) => ({ read: 'read', write: 'write', xfer: 'transfer', faucet: 'faucet' }[op.kind]);
  const keyOf = (op) => op.kind === 'xfer' ? `${short(op.from)} → ${short(op.to)}` : op.kind === 'faucet' ? short(op.to) : esc(short(op.key));
  const rows = () => {
    if ($('#x-rows').matches(':hover')) return;
    const out = []; for (let i = net.ops.length - 1; i >= 0 && out.length < 40; i--) { const op = net.ops[i]; if (keep(op)) out.push(op); }
    $('#x-rows').innerHTML = out.map(op => `<tr class="${op.mine ? 'mine' : ''} ${isBad(op) ? 'bad' : ''}"><td><a href="/explorer#op-${op.id}">${fmt(op.id)}</a></td><td>${utc(op.end)}</td><td>${kindName(op)}</td><td>${keyOf(op)}</td><td>${TAG[op.path] || op.path}</td><td>${glyphSVG(op)}</td><td>${code(op.region)}</td><td style="text-align:right">${fmtMs(op.ms)}</td></tr>`).join('');
  };
  every(500, rows);
  const lookup = (q) => {
    q = q.trim(); const box = $('#x-detail'); if (!q) { box.innerHTML = ''; return; }
    const num = q.replace(/^#|^op-?/i, '').replace(/,/g, '');
    if (/^\d+$/.test(num) && !/^k/i.test(q)) {
      const op = net.opById.get(+num);
      if (!op) { box.innerHTML = `<p class="empty">Operation ${esc(q)} is not in this tab's index. The index keeps the last few thousand operations since you opened the page.</p>`; return; }
      return opDetail(box, op);
    }
    let key = q;
    if (/^\d{1,4}$/.test(q)) key = 'k' + q.padStart(4, '0');
    if (/^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(q)) return addrDetail(box, q);
    if (/^(k\d{4}|note:.+|acct:.+)$/.test(key)) return keyDetail(box, key);
    box.innerHTML = `<p class="empty">Nothing found for “${esc(q)}”.</p>`;
  };
  $('#x-form').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#x-q').value; history.replaceState(null, '', '/explorer#q=' + encodeURIComponent(q)); lookup(q); });
  const fromHash = () => {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h.startsWith('op-')) { $('#x-q').value = h.slice(3); lookup(h.slice(3)); }
    else if (h.startsWith('q=')) { $('#x-q').value = h.slice(2); lookup(h.slice(2)); }
  };
  fromHash();
  window.addEventListener('hashchange', fromHash); onCleanup(() => window.removeEventListener('hashchange', fromHash));
}
function opDetail(box, op) {
  const kv = [
    ['Operation', fmt(op.id) + (op.mine ? ' · yours' : '')],
    ['Kind', op.kind === 'xfer' ? `transfer of ${fmt(op.amt)} from ${op.from} to ${op.to}` : op.kind === 'faucet' ? `faucet, ${fmt(op.amt)} to ${op.to}` : `${op.kind} ${op.key}`],
    ['Path', PATHNAME[op.path] || op.path],
    ['Client', REGIONS[op.region].name],
    ['Sent', op.done ? utc(op.start) : '—'], ['Agreed', op.done ? utc(op.end) : 'pending'],
    ['Client to agreed', op.done ? fmtMs(op.ms) + ' ms' : '—'],
  ];
  if (op.slot) kv.push(['Log slot', fmt(op.slot)]);
  if (op.version) kv.push(['Key version', op.version]);
  if (op.kind === 'read') kv.push(['Value', op.value ?? 'none'], ['Answered by', op.answeredBy != null ? REGIONS[op.answeredBy].name + (op.held ? `, after holding it ${op.heldMs.toFixed(1)} ms behind a write` : '') : '—']);
  if (op.result && op.result !== 'ok') kv.push(['Result', op.result]);
  if (op.retries) kv.push(['Retries', op.retries]);
  if (op.leaseWait) kv.push(['Waited', 'for a crashed replica\'s lease to run out']);
  box.innerHTML = `<div class="panel" style="margin-top:20px"><h3>Operation ${fmt(op.id)} ${op.done ? glyphSVG(op, 16) : ''}</h3>
    <div class="two"><dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${op.trace && op.trace.length ? `<div class="box"><canvas id="x-diag" style="height:360px"></canvas></div>` : '<p class="note">Reads are one message out and one back, so there is no diagram to draw.</p>'}</div>
    ${op.trace && op.trace.length ? `<h3>Messages</h3><div class="tw"><table class="t"><thead><tr><th>Type</th><th>From</th><th>To</th><th>Sent</th><th>Arrived</th></tr></thead><tbody>${op.trace.map(m => `<tr><td>${m.type}</td><td>${m.f >= 10 ? 'client ' + code(m.f - 10) : code(m.f)}</td><td>${m.to >= 10 ? 'client ' + code(m.to - 10) : code(m.to)}</td><td>+${m.s.toFixed(1)} ms</td><td>+${m.r.toFixed(1)} ms</td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;
  const c = $('#x-diag'); if (c && op.done) requestAnimationFrame(() => drawOpDiagram(c, net, op));
}
function keyDetail(box, key) {
  const cls = net.cls(key); const base = net.baseCls(key);
  const clsName = net.classOverride.has(key) ? 'moved from the cold path to the shared log' : { hot: 'hot: leader orders, a nearby owner replies', ordinary: 'ordinary: leader orders, votes go to the client', cold: 'cold: one round trip to fra, lon, nyc', log: 'account: changes only through the log' }[cls];
  const rows = net.replicas.map(r => {
    const v = r.store.get(key);
    const serves = base === 'cold' ? COLD_Q.includes(r.id) : true;
    return `<tr class="${r.up ? '' : 'bad'}"><td>${code(r.id)}</td><td>${r.up ? (r.catching ? 'catching up' : 'up') : 'crashed'}</td><td>${v ? esc(v.v) : '—'}</td><td>${v ? v.ver : '—'}</td><td>${r.pend.has(key) ? 'write in flight' : '—'}</td><td>${serves ? (r.hasLease() ? 'yes, holds a lease' : 'not now') : 'no, not in the cold quorum'}</td></tr>`;
  }).join('');
  const hist = net.ops.filter(o => o.key === key).slice(-10).reverse();
  box.innerHTML = `<div class="panel" style="margin-top:20px"><h3>Key ${esc(key)}</h3><p class="note">Class: ${clsName}.</p>
    <div class="tw"><table class="t"><thead><tr><th>Replica</th><th>State</th><th>Value</th><th>Version</th><th>Pending</th><th>Answers reads</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${hist.length ? `<h3>Recent operations on it</h3><div class="tw"><table class="t"><tbody>${hist.map(o => `<tr><td><a href="/explorer#op-${o.id}">${fmt(o.id)}</a></td><td>${o.kind}</td><td>${TAG[o.path] || o.path}</td><td>${glyphSVG(o)}</td><td style="text-align:right">${fmtMs(o.ms)}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`;
}
function addrDetail(box, addr) {
  const rows = net.replicas.map(r => `<tr class="${r.up ? '' : 'bad'}"><td>${code(r.id)}</td><td>${r.up ? fmt(r.store.get('acct:' + addr)?.v ?? 0) : '—'}</td><td>${r.up ? r.applied : '—'}</td></tr>`).join('');
  const hist = net.ops.filter(o => o.from === addr || o.to === addr || o.key === 'note:' + addr).slice(-12).reverse();
  box.innerHTML = `<div class="panel" style="margin-top:20px"><h3 class="addr">${esc(addr)}${addr === ME.addr ? ' · you' : ''}</h3>
    <div class="tw"><table class="t"><thead><tr><th>Replica</th><th>Balance</th><th>Applied up to slot</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${hist.length ? `<h3>Operations</h3><div class="tw"><table class="t"><tbody>${hist.map(o => `<tr><td><a href="/explorer#op-${o.id}">${fmt(o.id)}</a></td><td>${o.kind === 'xfer' ? (o.from === addr ? 'sent ' : 'received ') + fmt(o.amt) : o.kind}</td><td>${TAG[o.path] || o.path}</td><td>${glyphSVG(o)}</td><td style="text-align:right">${fmtMs(o.ms)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="note">No operations in this tab\'s index.</p>'}</div>`;
}

/* ------------------------------------------------------------------ REPLICAS + FAULT LAB */
function replicas(root, path) {
  document.title = 'Replicas · AGREE';
  root.innerHTML = `${innerHeader(path)}<main class="page">
    <h1>Replicas</h1>
    <p class="intro">Five replicas, one per city. Any three make a majority. The leader orders writes; every replica holding a lease answers reads on its own.</p>
    <p class="sub" id="rp-sum"></p>
    <div class="tw"><table class="t"><thead><tr><th>Replica</th><th>City</th><th>Role</th><th>State</th><th>Lease</th><th>Applied slot</th><th>Reads answered</th><th>Votes cast</th><th></th></tr></thead><tbody id="rp-rows"></tbody></table></div>
    <h2 id="lab">Fault lab</h2>
    <p>Replicas here fail the way the paper assumes: they stop. A replica that comes back is a fresh one that copies the leader's state before it answers anything. Keep three up and the network keeps agreeing.</p>
    <div class="panels">
      <div class="panel"><h3>Crash the leader</h3><p class="note">The others hear nothing for ${900} ms and the next in line asks for a new ballot. It must wait out the old leader's leases before any write completes. Reads keep going wherever a lease is still valid.</p><button class="btn sm redb" data-crash="leader">Crash the leader</button></div>
      <div class="panel"><h3>Crash a cold-quorum member</h3><p class="note">Cold writes need all three of fra, lon and nyc. With nyc gone they time out and move to the shared log, and the key stays there.</p><button class="btn sm redb" data-crash="2">Crash nyc</button></div>
      <div class="panel"><h3>Crash a far replica</h3><p class="note">tyo holds a read lease, so writes must reach it. Once it stops, writes wait until its lease has surely run out, then carry on without it.</p><button class="btn sm redb" data-crash="4">Crash tyo</button></div>
      <div class="panel"><h3>Race two cold writes</h3><p class="note">Two clients, in fra and tyo, write the same cold key at once. The quorum members see them in different orders, the votes disagree, and the leader settles the order in a higher round.</p><button class="btn sm" data-crash="race">Race them</button></div>
      <div class="panel"><h3>Replace crashed replicas</h3><p class="note">Fresh replicas copy the leader's state, then take a lease. Watch them come back in the table above.</p><button class="btn sm ghost" data-crash="replace">Replace crashed</button></div>
    </div>
    <h2>Events</h2>
    <div class="tw"><table class="t"><tbody id="rp-ev"></tbody></table></div>
  </main>${pageFoot()}`;
  bindCrash(root);
  every(250, () => {
    const L = net.leader(); const up = net.replicas.filter(r => r.up).length;
    $('#rp-sum').innerHTML = `${L ? `Leader <b>${code(L.id)}</b>, term ${net.term}` : '<span class="red">No leader: an election is running</span>'} · ${up} of 5 up · cold quorum fra lon nyc ${COLD_Q.every(i => net.replicas[i].up) ? 'complete' : '<span class="red">incomplete</span>'} · ${net.counters.moved} keys moved to the log`;
    const tb = $('#rp-rows');
    if (!tb.children.length) tb.innerHTML = net.replicas.map(r => `<tr data-r="${r.id}"><td>${code(r.id)}${COLD_Q.includes(r.id) ? ' <span class="faint">· cold q</span>' : ''}</td><td class="sans">${REGIONS[r.id].name}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('');
    net.replicas.forEach((r, i) => {
      const tr = tb.children[i]; const td = tr.children;
      const role = r.lead && r.lead.established ? 'leader' : r.cand || (r.lead && !r.lead.established) ? 'candidate' : 'follower';
      const lease = r.up ? (r.hasLease() ? `${Math.max(0, r.leaseUntil - net.t).toFixed(0)} ms left` : 'none') : '—';
      tr.classList.toggle('bad', !r.up);
      td[2].textContent = r.up ? role : '—'; td[3].textContent = r.up ? (r.catching ? 'catching up' : 'up') : 'crashed';
      td[4].textContent = lease; td[5].textContent = r.up ? fmt(r.applied) : '—'; td[6].textContent = fmt(r.served); td[7].textContent = fmt(r.voted);
      const want = r.up ? 'crash' : 'rep';
      if (td[8].dataset.k !== want) { td[8].dataset.k = want; td[8].innerHTML = r.up ? `<button class="btn sm ghost" data-one="${r.id}">Crash</button>` : `<button class="btn sm" data-rep="${r.id}">Replace</button>`; }
    });
    $('#rp-ev').innerHTML = net.events.slice(-30).reverse().map(e => `<tr class="${e.kind === 'fault' ? 'bad' : ''}"><td>${utc(e.t)}</td><td class="sans">${esc(e.text)}</td></tr>`).join('');
  });
  $('#rp-rows').addEventListener('click', (e) => {
    const c = e.target.closest('[data-one]'); const r = e.target.closest('[data-rep]');
    if (c) { if (net.replicas.filter(x => x.up).length <= 3) toast('Keep a majority: three replicas must stay up'); else net.crash(+c.dataset.one); }
    if (r) net.restart(+r.dataset.rep);
  });
}

/* ------------------------------------------------------------------ STATUS */
function status(root, path) {
  document.title = 'Status · AGREE';
  root.innerHTML = `${innerHeader(path)}<main class="page">
    <div class="toprow"><h1>Status</h1><span class="livepill"><i></i><span id="st-pill"></span></span></div>
    <div class="cards" id="st-cards" style="margin-top:22px"></div>
    <h2>Events</h2><div class="tw"><table class="t"><tbody id="st-ev"></tbody></table></div>
  </main>${pageFoot()}`;
  every(500, () => {
    const L = net.leader(); const up = net.replicas.filter(r => r.up).length;
    const leases = net.replicas.filter(r => r.hasLease()).length;
    $('#st-pill').textContent = L && up >= 3 ? 'Agreeing' : 'Electing a leader';
    const secs = net.t / 1000; const hms = `${Math.floor(secs / 3600)}h ${Math.floor(secs / 60) % 60}m ${Math.floor(secs % 60)}s`;
    $('#st-cards').innerHTML = [
      ['Running for', hms], ['Operations agreed', fmt(net.counters.ops)], ['Per second, last 10 s', opsPerSec().toFixed(1)],
      ['Leader', L ? `${code(L.id)} · term ${net.term}` : 'electing'], ['Replicas up', `${up} of 5`], ['Leases held', `${leases} of 5`],
      ['Cold quorum', COLD_Q.every(i => net.replicas[i].up) ? 'complete' : 'incomplete'], ['Keys moved to the log', fmt(net.counters.moved)],
      ['Reads held behind writes', fmt(net.counters.held)], ['Client retries', fmt(net.counters.retries)], ['Writes that waited out a lease', fmt(net.counters.leaseWaits)], ['Cold orders fixed by the leader', fmt(net.counters.fixed)],
    ].map(([k, v]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
    $('#st-ev').innerHTML = net.events.slice().reverse().map(e => `<tr class="${e.kind === 'fault' ? 'bad' : ''}"><td>${utc(e.t)}</td><td class="sans">${esc(e.text)}</td></tr>`).join('');
  });
}

/* ------------------------------------------------------------------ MEASUREMENTS */
function measurements(root, path) {
  document.title = 'Measurements · AGREE';
  root.innerHTML = `${innerHeader(path)}<main class="page">
    <h1>Measurements</h1>
    <p class="intro">Every number here is measured in this tab: from a client sending an operation to that client knowing it is agreed. Change the workload and watch the paths shift.</p>
    <div class="inline" style="gap:30px">
      <div><div class="note">Workload</div><div class="chips" id="ms-mix">${[['A', 'A · 50% writes'], ['B', 'B · 5% writes'], ['C', 'C · read-only']].map(([k, l]) => `<button class="chip ${net.mix === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div></div>
      <div><div class="note">Load</div><div class="chips" id="ms-rate">${[7, 14, 28].map(r => `<button class="chip ${net.rate === r ? 'on' : ''}" data-v="${r}">${r} ops/s</button>`).join('')}</div></div>
      <div><div class="note">&nbsp;</div><div class="chips"><button class="chip" id="ms-reset">Reset counts</button></div></div>
    </div>
    <div class="tw" style="margin-top:10px"><table class="t"><thead><tr><th>Path</th><th>What it is</th><th>n</th><th>p50</th><th>p90</th><th>p99</th><th>mean</th></tr></thead><tbody id="ms-rows"></tbody></table></div>
    <div class="box" style="margin-top:24px"><canvas id="ms-stage" style="height:520px"></canvas></div>
    <h2>From the paper</h2>
    <p>Across six deployments with 5 or 9 replicas and emulated delays, the authors report that A‑GREEMENT cut mean latency by 12.2% on a write-heavy workload (50% writes) against SwiftPaxos, the best alternative, at the cost of a 13.8% higher p99. On a read-heavy workload it cut mean latency by 33.3%, and on read-only work it matched the fastest baseline.</p>
    <p>Our numbers come from five cities in one browser tab, with our own delays, so compare the shapes rather than the digits. Writes here are slower than theirs for a plain reason: every replica holds a read lease, so a write to a busy key must reach all five, including Tokyo and São Paulo. The paper picks each key's read responders from the workload.</p>
  </main>${pageFoot()}`;
  const stage = new Stage($('#ms-stage'), net, { mode: 'measured', sheet: false });
  onCleanup(() => stage.destroy());
  $$('#ms-mix .chip').forEach(b => b.addEventListener('click', () => { net.mix = b.dataset.v; $$('#ms-mix .chip').forEach(x => x.classList.toggle('on', x === b)); }));
  $$('#ms-rate .chip').forEach(b => b.addEventListener('click', () => { net.rate = +b.dataset.v; $$('#ms-rate .chip').forEach(x => x.classList.toggle('on', x === b)); }));
  $('#ms-reset').addEventListener('click', () => { net.stats = {}; stage.mcache = null; toast('Counts reset'); });
  every(800, () => {
    const order = ['read', 'read·held', 'read·retry', 'cold', 'cold·fixed', 'cold→log', 'ordinary', 'hot', 'xfer', 'faucet'];
    $('#ms-rows').innerHTML = order.map(p => [p, net.summary(p)]).filter(([, s]) => s).map(([p, s]) => `<tr><td>${TAG[p]}</td><td class="sans">${PATHNAME[p]}</td><td>${fmt(s.n)}</td><td>${s.p50.toFixed(1)}</td><td>${s.p90.toFixed(1)}</td><td>${s.p99.toFixed(1)}</td><td>${s.mean.toFixed(1)}</td></tr>`).join('');
  });
}

/* ------------------------------------------------------------------ HOW IT WORKS */
function how(root, path) {
  document.title = 'How it works · AGREE';
  root.innerHTML = `${innerHeader(path)}<main class="page">
    <h1>How it works</h1>
    <p class="intro">AGREE runs A‑GREEMENT, a consensus protocol for a replicated key-value store. Here is the whole thing in plain words, including what we had to decide ourselves.</p>
    <h2>Five replicas, three decide</h2>
    <p>The network has five replicas: Frankfurt, London, New York, São Paulo and Tokyo. Any three of them are a majority. Replicas can crash, and the protocol stays safe; it keeps making progress as long as three are up and messages eventually arrive on time. It does not defend against replicas that lie: the paper's fault model is crashes only.</p>
    <h2>The leader keeps the log</h2>
    <p>One replica leads. It gives every write that needs ordering a slot in a shared log, Multi-Paxos style, within a numbered ballot. A write is final once a majority, plus every replica that answers reads for that key, has accepted it.</p>
    <h2>Leases make reads local</h2>
    <p>A replica holding a valid lease can answer a read from its own copy, one round trip from a client in the same city. The lease only says who may answer. The other half of the trick: a write cannot complete until every lease holder for its key has accepted it, and a replica that has accepted a write it has not yet applied holds reads of that key until it has. So a local read never misses a finished write.</p>
    <h2>Three ways to write</h2>
    <ol class="steps">
      <li><b>Cold keys</b> are rarely touched. The client sends the write straight to a fixed quorum, fra lon nyc, and each member votes on the key's next version. Three matching votes and the write is done: one round trip, no leader. If two writes collide, the votes disagree and the leader settles the order in a higher round. If a member does not answer, the write and the key move to the shared log for good.</li>
      <li><b>Ordinary keys</b> go through the leader's log, but the votes go straight to the client, which counts them itself. That saves the hop back through the leader.</li>
      <li><b>Hot keys</b> also go through the log. A replica near the client acts as the key's completion owner: it waits until a majority and every lease holder have accepted, then answers the client.</li>
    </ol>
    <h2>When a replica stops</h2>
    <p>If the leader goes quiet for ${900} ms, the next replica in line (lon, fra, nyc, gru, tyo) asks for a higher ballot. Once a majority promise, it collects anything that might already have been chosen, then waits until every lease the old leader granted has surely run out. Only then does it take writes. A crashed replica that held a lease slows writes the same way, until its lease is over.</p>
    <p>A replica that comes back is treated as a new one: it copies the leader's state and takes a lease before it answers a single read.</p>
    <h2>What this network adds</h2>
    <ul class="plain">
      <li><b>A ledger.</b> Test coins live under acct: keys. Transfers and the faucet change two keys at once, so they always go through the log, and the leader checks the balance when it orders them.</li>
      <li><b>Lines.</b> Each key can write one line under note:its-address. Nobody else writes there, so it is a cold key.</li>
      <li><b>Key classes by rank.</b> Of the 1,000 busy keys, the 8 most touched are hot, the next 112 ordinary, the rest cold. The paper chooses classes from a workload profile; ours is fixed.</li>
      <li><b>Leases.</b> The leader renews them every 400 ms. A replica trusts its lease for 1.4 s; the leader counts it as a lease holder for 2 s after its last acknowledged grant. The paper grants leases by majority; ours come from the leader, which keeps the same safety rule for this crash-only setting.</li>
      <li><b>Every lease holder answers reads.</b> So writes to busy keys wait for all five cities. The paper picks read responders per key.</li>
      <li><b>A browser runtime.</b> The protocol is written in JavaScript from the paper's description and runs entirely in your tab.</li>
    </ul>
    <h2>What is emulated</h2>
    <p>The regions. All five replicas run inside your browser tab, and messages between them are delayed by the real one-way time between the cities: 7.5 ms Frankfurt to London, 36 ms London to New York, 128 ms São Paulo to Tokyo, and so on. The paper's own measurements were emulated the same way, on a cluster. Your network starts at genesis when the page opens.</p>
  </main>${pageFoot()}`;
}

/* ------------------------------------------------------------------ PAPER */
function paper(root, path) {
  document.title = 'The paper · AGREE';
  root.innerHTML = `${innerHeader(path)}<main class="page">
    <h1>The paper</h1>
    <p class="intro"><i>The End of Consensus Research?</i> by Clément Burgelin, Rachid Guerraoui, Zicong Hong, Yinan Hu, Anne-Marie Kermarrec, Rafael Pires, Rasmus Moorits Veski and Martijn de Vos. arXiv 2610.30114, October 2026.</p>
    <div class="ctas" style="margin-top:6px"><a class="link" href="${CONFIG.paper}" target="_blank" rel="noopener">Abstract</a><a class="link" href="${CONFIG.pdf}" target="_blank" rel="noopener">PDF</a></div>
    <div class="two" style="margin-top:20px">
      <div>
        <h2>What the agent had</h2>
        <p>The authors built AI‑GREEMENT, a harness around a general-purpose coding agent, with three parts:</p>
        <ul class="plain">
          <li>A knowledge base: 97 notes written from 22 consensus papers, covering 24 concepts and 11 design dimensions, checked by people.</li>
          <li>Consensus Arena: a shared framework in Go with seven baseline protocols and blanks for the agent to fill.</li>
          <li>A Lean framework with reusable safety definitions, reference specifications and proofs.</li>
        </ul>
        <h2>What it found</h2>
        <p>A‑GREEMENT: lease-authorized local reads, direct client learning for leader-ordered writes, and a fast fixed-quorum write path per key, chosen from the network topology and the workload.</p>
        <p>The Lean work also turned up several previously unreported vulnerabilities in existing consensus protocols.</p>
        <h2>What the authors are careful about</h2>
        <ul class="plain">
          <li>Safety is proved; liveness is left for future work.</li>
          <li>Their results come from emulated networks, not real deployments.</li>
          <li>The agent took shortcuts that people had to catch, such as exploiting jitter in the benchmark.</li>
          <li>Human experts were still needed before, during and after the search.</li>
        </ul>
        <blockquote>“agents reshape the researcher's role rather than end consensus research”</blockquote>
      </div>
      <div>
        <h2>What it cost</h2>
        <div class="slip">${RECEIPT.map(([a, b, k]) => k === 'rule' ? '<div style="border-top:1px solid var(--ink);margin:8px 0"></div>' : k === 'tot' ? `<div class="ln tot"><span>${a}</span><span></span><span>${b}</span></div>` : `<div class="ln" ${k === 'h' ? 'style="font-weight:600"' : ''}><span>${a}</span><span></span><span>${b}</span></div>`).join('')}</div>
        <p class="note" style="margin-top:12px">Figures from the paper. Tokens split between the search for a protocol and its verification.</p>
        <h2>What we built</h2>
        <p>No code was published with the paper that we could find, so AGREE implements A‑GREEMENT from its description, in JavaScript, and runs it in your browser with five emulated cities. <a class="link" href="/how-it-works">How it works</a> lists every choice we made where the paper left room.</p>
        <p class="note">AGREE is an independent build and is not affiliated with the authors or their institutions.</p>
      </div>
    </div>
  </main>${pageFoot()}`;
}

/* ------------------------------------------------------------------ TOKEN + BURNS */
function token(root, path) {
  document.title = 'Token · AGREE';
  root.innerHTML = `${innerHeader(path)}<main class="page">
    <h1>${CONFIG.ticker}</h1>
    <p class="intro">$AGREE is the gas of the AGREE network. Every write and every transfer pays a little; reads are free, because they never leave the nearest replica.</p>
    <dl class="kv" style="max-width:760px;margin-top:20px;font-size:15px">
      <dt>Chain</dt><dd>Solana (SPL token)</dd>
      <dt>Supply</dt><dd>${CONFIG.supply}</dd>
      ${CONFIG.ca ? `<dt>Contract</dt><dd>${esc(CONFIG.ca)} <a href="#" data-copy="${esc(CONFIG.ca)}">copy</a></dd>` : ''}
      <dt>Pays for</dt><dd>writes and transfers on AGREE</dd>
      <dt>Moves</dt><dd>one way: burned on Solana, issued on AGREE</dd>
      <dt>Today</dt><dd>until the switch, the network runs on test coins</dd>
      <dt>Fees</dt><dd>creator fees buy $AGREE back and burn it</dd>
    </dl>
    <p style="margin-top:24px">Every buyback and burn is listed in the <a class="link" href="/burns">burn record</a> with its Solana transaction.</p>
  </main>${pageFoot()}`;
}
function burns(root, path) {
  document.title = 'Burn record · AGREE';
  const b = CONFIG.burns || [];
  root.innerHTML = `${innerHeader(path)}<main class="page">
    <h1>Burn record</h1>
    <p class="intro">Each buyback and burn paid for by creator fees, with its Solana transaction.</p>
    ${b.length ? `<div class="tw"><table class="t"><thead><tr><th>Date</th><th>Burned</th><th>Transaction</th></tr></thead><tbody>${b.map(x => `<tr><td>${esc(x.date)}</td><td>${esc(x.amount)} $AGREE</td><td><a href="https://solscan.io/tx/${encodeURIComponent(x.tx)}" target="_blank" rel="noopener">${esc(short(x.tx))}</a></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="empty">No burns yet. The first one appears here with its transaction.</p>'}
  </main>${pageFoot()}`;
}
function notFound(root, path) {
  document.title = 'Not found · AGREE';
  root.innerHTML = `${innerHeader(path)}<main class="page"><h1>Not on the log.</h1><p class="intro">No page at ${esc(path)}. <a class="link" href="/">Back to the printout</a></p></main>${pageFoot()}`;
}

if (document.fonts && document.fonts.ready) document.fonts.ready.then(render); else render();
