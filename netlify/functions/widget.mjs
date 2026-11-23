// Kleine prijswidget om op andere sites in te bouwen (iframe). Laat de stroomprijs van nu zien en linkt naar Stroomwekker.
import { getPrices } from '../lib/data.mjs';
import { price, nlDayBounds, inRange, cheapestBlock, levels, levelOf, nlTime, current, DEFAULT_SETTINGS } from '../../public/js/engine.js';

const ct = v => (v * 100).toFixed(1).replace('.', ',');

export default async (req) => {
  const u = new URL(req.url);
  const donker = u.searchParams.get('stijl') === 'donker';
  const now = Date.now();
  let regel1 = 'Prijs even niet beschikbaar', regel2 = '', label = '', kleur = '#5B6677';
  try {
    const data = await getPrices(now);
    const dag = nlDayBounds(now), qs = inRange(data.quarters, dag.start, dag.end);
    const nu = current(qs, now);
    if (nu) {
      const lv = levels(qs), niveau = levelOf(nu.spot, lv);
      label = { goedkoop: 'Goedkoop', normaal: 'Normaal', duur: 'Duur' }[niveau] || '';
      kleur = { goedkoop: '#13703A', normaal: '#8A5A00', duur: '#B42318' }[niveau] || kleur;
      regel1 = `${ct(price(nu.spot, DEFAULT_SETTINGS))} cent per kWh`;
      const blok = cheapestBlock(qs, now, dag.end, 8);
      regel2 = blok ? `Goedkoopst nog vandaag: ${nlTime(blok.start)} tot ${nlTime(blok.end)}` : 'Vandaag geen goedkoper moment meer';
    }
  } catch { /* melding hierboven */ }
  const bg = donker ? '#0F2340' : '#fff', ink = donker ? '#fff' : '#14213A', muted = donker ? '#C9D4E5' : '#5B6677', line = donker ? '#22385C' : '#DCE2EA';
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Stroomprijs nu</title><style>
html,body{margin:0;background:${bg};color:${ink};font:15px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit;text-decoration:none}.w{display:block;border:1px solid ${line};border-radius:8px;padding:12px 14px;height:calc(100vh - 26px);box-sizing:border-box}
.k{font-size:12.5px;color:${muted};display:flex;justify-content:space-between;gap:8px}.p{font-size:22px;white-space:nowrap;font-weight:700;margin:4px 0 2px;letter-spacing:-.01em}
.l{display:inline-block;font-size:12.5px;font-weight:700;color:#fff;background:${kleur};border-radius:4px;padding:1px 7px;margin-left:6px;vertical-align:4px}
.r{font-size:13.5px;color:${muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.m{margin-top:8px;font-size:12.5px;font-weight:700}.m b{color:#F5B700}
</style></head><body><a class="w" href="https://stroomwekker.eu/?bron=widget" target="_blank" rel="noopener">
<div class="k"><span>Stroomprijs nu</span><span>incl. belasting</span></div>
<div class="p">${regel1}${label ? `<span class="l">${label}</span>` : ''}</div>
<div class="r">${regel2}</div>
<div class="m"><b>Stroom</b>wekker.eu · apparaten vanzelf aan</div>
</a></body></html>`;
  return new Response(html, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *; base-uri 'none'",
    'Cache-Control': 'public, max-age=60',
    'Netlify-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
  } });
};

export const config = { path: ['/widget/stroomprijs', '/widget/stroomprijs/'] };
