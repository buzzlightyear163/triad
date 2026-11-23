const TAG = { 'read': 'READ', 'read·held': 'HELD', 'cold': 'COLD', 'ordinary': 'LOG', 'hot': 'HOT', 'xfer': 'XFER', 'faucet': 'MINT' };
function glyph(m, s) {
  const c = s / 2, r = s * 0.3, INK = '#18402D', FAINT = 'rgba(24,64,45,0.3)';
  if (!m) return `<svg width="${s}" height="${s}"><circle cx="${c}" cy="${c}" r="${s * 0.09}" fill="${FAINT}"/></svg>`;
  const filled = m.role === 'a' || m.role === 'c' || m.role === 'h';
  const st = filled ? `fill="${INK}"` : `fill="none" stroke="${INK}" stroke-width="${s * 0.1}"`;
  let shape = m.lead ? `<rect x="${c - r}" y="${c - r}" width="${2 * r}" height="${2 * r}" ${st}/>`
    : m.co ? `<path d="M${c} ${c - r * 1.3}L${c + r * 1.3} ${c}L${c} ${c + r * 1.3}L${c - r * 1.3} ${c}Z" ${st}/>`
      : `<circle cx="${c}" cy="${c}" r="${r}" ${st}/>`;
  if (m.role === 'c') shape += `<circle cx="${c}" cy="${c}" r="${r + s * 0.17}" fill="none" stroke="${INK}" stroke-width="${s * 0.06}"/>`;
  return `<svg width="${s}" height="${s}" style="overflow:visible">${shape}</svg>`;
}
export function rowsHTML(rows, o) {
  return rows.map((op, k) => {
    const dots = Math.max(1, Math.round(Math.sqrt(op.ms / 900) * o.barDots));
    const band = Math.floor((rows.length - k) / 3) % 2 === 0 ? 'background:var(--band)' : '';
    return `<div class="row" style="grid-template-columns:${o.cols};height:${o.rh}px;font-size:${o.fs}px;${band};opacity:${o.fade ? Math.min(1, 0.25 + (k / rows.length) * 1.1) : 1}">
      <span class="ms">${op.ms.toFixed(1)}</span><span class="tag">${TAG[op.path] || op.path}</span>
      <span class="lanes" style="grid-template-columns:repeat(5,${o.lane}px)">${(op.marks || [null, null, null, null, null]).map(m => glyph(m, o.g)).join('')}</span>
      <span class="bar">${Array.from({ length: dots }, () => `<i style="width:${o.dot}px;height:${o.dot}px"></i>`).join('')}</span></div>`;
  }).join('');
}
