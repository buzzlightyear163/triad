import { Net, REGIONS } from '/js/net.js';
import { Stage } from '/js/viz.js';
const $ = (s) => document.querySelector(s);
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const win = (t, a, b, f = 0.3) => Math.min(clamp((t - a) / f), clamp((b - t) / f));
window.SND = [];
const snd = (t, kind) => window.SND.push({ t: +t.toFixed(3), kind });

// receipt
const LINES = [['AI‑GREEMENT', 'discovery run', 'h'], ['', '', 'rule'], ['papers read', '22'], ['search rounds', '20'], ['tokens, total', '778.45 M'], ['lines of Lean', '~135,000'], ['wall clock', '~24 h'], ['', '', 'rule'], ['result', 'A‑GREEMENT'], ['safety', 'proved in Lean'], ['TOTAL', '$198.69', 'tot']];
$('#slip').innerHTML = LINES.map(([a, b, k]) => k === 'rule' ? '<div class="rule"></div>' : `<div class="ln ${k || ''}"><span>${a}</span><span></span><span>${b}</span></div>`).join('');
const slipItems = [...$('#slip').children];
// end mark
for (let b = 0; b < 5; b++) {
  const bar = document.createElement('div'); bar.className = 'b';
  for (let y = 0; y < 9; y++) for (let x = 0; x < 3; x++) { const i = document.createElement('i'); i.style.background = (b < 3 || x === 0 || x === 2 || y === 0 || y === 8) ? '#18402D' : 'transparent'; bar.appendChild(i); }
  $('#mk').appendChild(bar);
}
// print heads
for (const pl of document.querySelectorAll('.pl')) { const h = document.createElement('i'); h.className = 'hd'; pl.appendChild(h); }

const net = new Net({ rate: 10, mix: 'A' });
const stage = new Stage($('#cv'), net, { mode: 'printout', sheet: true, bottomPad: 16 });
stage.ro.disconnect();
stage.resize = () => { const c = $('#cv'); stage.W = 636; stage.H = 648; stage.d = 1060 / 636; c.width = 1060; c.height = 1080; };
stage.resize();
const STEP = 1000 / 30;
for (let i = 0; i < 240; i++) { window.VT += STEP; net.advance(STEP); }
const T0 = window.VT;
let lastT = 0, crashed = false, crashAt = 18.2;
const events = [];
net.on((type, d) => {
  const t = (window.VT - T0) / 1000;
  if (type === 'event') events.push({ t, text: d.text, kind: d.kind });
  if (type === 'op' && t > 10.4 && t < 23.6) snd(t, d.leaseWait || d.ms > 800 || /retry|log/.test(d.path) && d.path !== 'ordinary' ? 'rowbad' : 'row');
});
const printed = new Set();

window.frame = (t) => {
  // advance the network in step with video time
  const dt = (t - lastT) * 1000; lastT = t;
  if (dt > 0) { window.VT += dt; net.advance(dt); }
  if (!crashed && t >= crashAt) { const L = net.leader(); if (L) net.crash(L.id); crashed = true; snd(t, 'crash'); }
  // scene windows
  $('#s1').style.opacity = win(t, -1, 5.15);
  $('#s2').style.opacity = win(t, 5.0, 10.75);
  $('#s3').style.opacity = win(t, 10.5, 17.7);
  $('#s4').style.opacity = win(t, 17.5, 23.75);
  $('#s5').style.opacity = clamp((t - 23.55) / 0.4);
  $('#cv').style.opacity = win(t, 10.5, 23.75);
  stage.setMode(t >= 17.5 ? 'fault' : 'printout');
  if (t > 10.2 && t < 24) stage.draw(window.VT);
  // s1 printing
  for (const pl of document.querySelectorAll('.pl')) {
    const a = +pl.dataset.a, d = +pl.dataset.d; const k = clamp((t - a) / d);
    const tx = pl.querySelector('.tx'); const w = tx.offsetWidth;
    tx.style.clipPath = `inset(0 ${(1 - k) * 100}% 0 0)`;
    const hd = pl.querySelector('.hd'); hd.style.left = (k * w + 4) + 'px'; hd.style.opacity = k > 0 && k < 1 ? 1 : 0;
    if (k > 0 && !printed.has(pl)) { printed.add(pl); snd(a, 'print:' + d); }
  }
  // s2 receipt
  const s2a = 5.55, step = 0.3;
  slipItems.forEach((el, i) => {
    const at = s2a + i * step + (el.classList.contains('tot') ? 0.35 : 0);
    el.style.opacity = clamp((t - at) / 0.12);
    if (t >= at && !printed.has(el)) { printed.add(el); snd(at, el.classList.contains('tot') ? 'total' : el.classList.contains('rule') ? 'rule' : 'line'); }
  });
  const stAt = s2a + slipItems.length * step + 0.9;
  const sk = clamp((t - stAt) / 0.18);
  $('#stamp').style.opacity = sk;
  $('#stamp').style.transform = `rotate(-7deg) scale(${1.6 - 0.6 * ease(sk)})`;
  if (t >= stAt && !printed.has('stamp')) { printed.add('stamp'); snd(stAt, 'stamp'); }
  // s4 events
  const evs = events.filter(e => e.t >= crashAt - 0.05).slice(0, 4);
  const ul = $('#ev');
  if (ul.children.length !== evs.length) ul.innerHTML = evs.map(e => `<li class="${e.kind === 'fault' ? 'f' : ''}" data-t="${e.t}">${fmt(e.text)}</li>`).join('');
  for (const li of ul.children) li.style.opacity = clamp((t - +li.dataset.t) / 0.25);
  if (t >= 23.55 && !printed.has('end')) { printed.add('end'); snd(23.55, 'end'); }
  return true;
};
function fmt(s) {
  return s.replace(/ \(term \d+\)/, '').replace('Old leases ran out; writes resume.', 'Old leases ran out. Writes resume.');
}
window.ready = true;
