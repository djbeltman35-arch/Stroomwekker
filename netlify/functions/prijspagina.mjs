// Stroomprijs vandaag / morgen: echte HTML met alle kwartierprijzen, zodat Google en AI-zoekers ze kunnen lezen.
import { getPrices } from '../lib/data.mjs';
import { HEAD, HEADER, FOOTER } from '../lib/sjabloon.mjs';
import { price, nlDayBounds, inRange, cheapestBlock, priciestBlock, levels, levelOf, nlTime, current, negativeWindows, DEFAULT_SETTINGS, Q } from '../../public/js/engine.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ct = v => (v * 100).toFixed(1).replace('.', ',');
const eur = (v, d = 2) => '€ ' + v.toFixed(d).replace('.', ',');
const datum = t => new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(t));
const uur = t => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false }).format(new Date(t))) % 24;

const CSS = `<style>
.pagina{max-width:860px}
.pkop{background:var(--navy);color:#fff;padding:8px 0 36px;margin-bottom:28px}
.pkop h1{color:#fff;margin:0 0 10px}.pkop p{color:#C9D4E5;font-size:17.5px;margin:0;max-width:62ch}
.terug{display:inline-block;color:#C9D4E5;text-decoration:none;font-size:15px;margin:0 0 14px}
.pagina .card p{font-size:16.5px;margin:0 0 10px;max-width:70ch}.pagina .card p:last-child{margin-bottom:0}
.kerncijfers{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:4px 0 14px}
.kerncijfers div{border:1px solid var(--line);border-radius:6px;padding:12px;background:var(--surface)}
.kerncijfers span{display:block;font-size:13.5px;color:var(--muted)}.kerncijfers b{display:block;font-size:21px;margin-top:2px}
.kerncijfers small{display:block;font-size:13px;color:var(--muted)}
@media (max-width:720px){.kerncijfers{grid-template-columns:1fr 1fr}}
.tabel{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:15px}
.tabel th,.tabel td{padding:8px 6px;border-top:1px solid var(--line);text-align:right}
.tabel th:first-child,.tabel td:first-child{text-align:left}
.tabel thead th{border-top:0;font-size:13px;color:var(--muted);font-weight:600}
.tabel tr.nu{background:var(--amber-soft)}
.tabel td.goedkoop{color:#13703A;font-weight:600}.tabel td.duur{color:#B42318;font-weight:600}
.tabelwrap{overflow-x:auto;margin:0 -4px}
.cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.cta a{text-decoration:none;display:inline-flex;align-items:center;min-height:46px;padding:11px 18px;border-radius:8px;border:1px solid transparent;font-weight:600;font-size:16px;line-height:1.3}.cta a.btn-line{border-color:var(--line);background:var(--surface);color:var(--ink)}
.wissel{display:flex;gap:18px;flex-wrap:wrap;margin:14px 0 0}.wissel a{color:#fff;font-weight:600}
</style>`;

function pagina({ title, desc, url, h1, intro, body, ld }) {
  let head = HEAD.replaceAll('{{TITLE}}', esc(title)).replaceAll('{{DESC}}', esc(desc)).replaceAll('{{URL}}', url);
  head += CSS + `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n`;
  const header = HEADER.replace('href="/#meer">Prijzen', 'href="/stroomprijs-vandaag/" aria-current="page">Prijzen');
  return head + header + `
<div class="pkop"><div class="wrap pagina">
  <a class="terug" href="/">&larr; Terug naar de startpagina</a>
  <h1>${h1}</h1>
  <p>${intro}</p>
  <nav class="wissel" aria-label="Andere dag"><a href="/stroomprijs-vandaag/">Vandaag</a><a href="/stroomprijs-morgen/">Morgen</a></nav>
</div></div>
<main class="wrap pagina">
${body}
` + FOOTER;
}

export default async (req) => {
  const morgen = new URL(req.url).pathname.includes('morgen');
  const now = Date.now();
  const base = morgen ? nlDayBounds(nlDayBounds(now).end + Q) : nlDayBounds(now);
  const url = `https://stroomwekker.eu/stroomprijs-${morgen ? 'morgen' : 'vandaag'}/`;
  const dag = datum(base.start + 6 * 3600e3);
  let data = null;
  try { data = await getPrices(now); } catch { /* hieronder netjes melden */ }
  const qs = data ? inRange(data.quarters, base.start, base.end) : [];
  const S = DEFAULT_SETTINGS;
  const kort = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'long' }).format(new Date(base.start + 6 * 3600e3));
  const title = `Stroomprijs ${morgen ? 'morgen' : 'vandaag'} per kwartier (${kort}) | Stroomwekker`;

  if (qs.length < 80) {
    const body = `<section class="card"><h2>${morgen ? 'De prijzen van morgen zijn er nog niet' : 'Prijzen even niet beschikbaar'}</h2>
<p>${morgen ? 'De stroomprijzen voor morgen worden elke middag rond 13:00 uur bekend gemaakt op de Europese stroombeurs. Kom na 13:00 uur terug, of laat Stroomwekker je een bericht sturen zodra ze er zijn.' : 'We konden de stroomprijzen nu niet ophalen. Probeer het over een paar minuten opnieuw.'}</p>
<div class="cta"><a class="btn" href="/?start=bericht">Stuur mij een bericht</a><a class="btn btn-line" href="/stroomprijs-vandaag/">Bekijk de prijzen van vandaag</a></div></section>`;
    return html(pagina({ title, desc: `De dynamische stroomprijs van ${dag}: de prijzen voor morgen komen rond 13:00 uur. Inclusief btw en energiebelasting, per kwartier.`, url, h1: `Stroomprijs morgen`, intro: dag, body, ld: ldBasis(title, url) }), 300);
  }

  const P = q => price(q.spot, S);
  const lv = levels(qs);
  const gem = qs.reduce((a, q) => a + P(q), 0) / qs.length;
  const laag = qs.reduce((a, q) => (P(q) < P(a) ? q : a));
  const hoog = qs.reduce((a, q) => (P(q) > P(a) ? q : a));
  const blok3 = cheapestBlock(qs, base.start, base.end, 12);
  const duur3 = priciestBlock(qs, base.start, base.end, 12);
  const neg = negativeWindows(qs, base.start, base.end);
  const gratis = qs.filter(q => P(q) <= 0).length;
  const nu = !morgen ? current(qs, now) : null;
  const gas = data.gas?.[base.day];
  const blokTxt = b => b ? `${nlTime(b.start)} tot ${nlTime(b.end)} uur` : '–';

  const samenvatting = [
    `De gemiddelde stroomprijs is ${morgen ? 'morgen' : 'vandaag'}, ${dag}, <b>${ct(gem)} cent per kWh</b>, inclusief btw, energiebelasting en ${ct(S.opslag)} cent inkoopvergoeding.`,
    `Het goedkoopste kwartier is om <b>${nlTime(laag.t)} uur (${ct(P(laag))} cent)</b>. Het duurste kwartier is om <b>${nlTime(hoog.t)} uur (${ct(P(hoog))} cent)</b>.`,
    blok3 ? `De goedkoopste 3 uur achter elkaar zijn van <b>${blokTxt(blok3)}</b> (gemiddeld ${ct(price(blok3.avg, S))} cent). Dat is het beste moment voor de wasmachine, vaatwasser, boiler of het laden van je auto.` : '',
    duur3 ? `Probeer weinig stroom te gebruiken van ${blokTxt(duur3)}.` : '',
    neg.length ? `Let op als je zonnepanelen hebt: de beursprijs is negatief van ${neg.map(w => `${nlTime(w.start)} tot ${nlTime(w.end)}`).join(' en ')} uur. Terugleveren kost je dan geld.` : '',
    gratis ? `In ${gratis} kwartier${gratis > 1 ? 'en' : ''} is stroom zelfs gratis of krijg je geld toe.` : '',
  ].filter(Boolean);

  // Tabel per uur met de vier kwartieren
  const uren = new Map();
  for (const q of qs) { const h = uur(q.t); if (!uren.has(h)) uren.set(h, []); uren.get(h).push(q); }
  const nuUur = nu ? uur(nu.t) : -1;
  const rijen = [...uren.entries()].map(([h, l]) => {
    const cel = i => { const q = l.find(x => new Date(x.t).getUTCMinutes() === i * 15); return q ? `<td class="${levelOf(q.spot, lv)}">${ct(P(q))}</td>` : '<td>–</td>'; };
    const g = l.reduce((a, q) => a + P(q), 0) / l.length;
    return `<tr${h === nuUur ? ' class="nu"' : ''}><td>${String(h).padStart(2, '0')}:00${h === nuUur ? ' (nu)' : ''}</td>${cel(0)}${cel(1)}${cel(2)}${cel(3)}<td><b>${ct(g)}</b></td></tr>`;
  }).join('\n');

  const body = `
  <section class="card">
    <h2>Samenvatting</h2>
    <div class="kerncijfers">
      ${nu ? `<div><span>Nu</span><b>${ct(P(nu))}</b><small>cent per kWh</small></div>` : `<div><span>Gemiddeld</span><b>${ct(gem)}</b><small>cent per kWh</small></div>`}
      <div><span>Goedkoopst</span><b>${ct(P(laag))}</b><small>om ${nlTime(laag.t)} uur</small></div>
      <div><span>Duurst</span><b>${ct(P(hoog))}</b><small>om ${nlTime(hoog.t)} uur</small></div>
      <div><span>Gas ${morgen ? 'morgen' : 'vandaag'}</span><b>${gas != null ? eur(gas) : '–'}</b><small>per m³</small></div>
    </div>
    ${samenvatting.map(p => `<p>${p}</p>`).join('\n    ')}
    <div class="cta"><a class="btn" href="/?start=apparaat">Zet mijn apparaat vanzelf aan als het goedkoop is</a><a class="btn btn-line" href="/?start=bericht">Stuur mij een bericht</a></div>
  </section>

  <section class="card">
    <h2>Stroomprijs per kwartier, ${dag}</h2>
    <p class="small muted">In cent per kWh, inclusief btw (21%), energiebelasting (${ct(0.11085)} cent) en ${ct(S.opslag)} cent inkoopvergoeding. Groen = goedkoop, rood = duur ten opzichte van de rest van de dag.</p>
    <div class="tabelwrap"><table class="tabel">
      <thead><tr><th scope="col">Uur</th><th scope="col">:00</th><th scope="col">:15</th><th scope="col">:30</th><th scope="col">:45</th><th scope="col">Uur gem.</th></tr></thead>
      <tbody>
${rijen}
      </tbody>
    </table></div>
  </section>

  <section class="card">
    <h2>Hoe komen deze prijzen tot stand?</h2>
    <p>Met een dynamisch energiecontract betaal je per kwartier de prijs van de Europese stroombeurs (EPEX day-ahead). Die prijzen worden elke middag rond 13:00 uur vastgesteld voor de hele volgende dag. Wij tellen er de btw, de energiebelasting en een gemiddelde inkoopvergoeding van je energiebedrijf bij op. Zo zie je ongeveer wat je echt betaalt. Vaste kosten, zoals netbeheerkosten, zitten er niet in.</p>
    <p>Rekent jouw energiebedrijf een andere inkoopvergoeding? Stel die in bij Stroomwekker, dan kloppen alle prijzen precies voor jou. Bron: ${esc(data.source)}. Bijgewerkt om ${nlTime(data.updated)} uur.</p>
    <p>Liever niet zelf opletten? <a href="/hoe-werkt-het/">Lees hoe Stroomwekker je apparaten vanzelf aanzet</a> in de goedkoopste kwartieren.</p>
  </section>`;

  const desc = `Stroomprijs ${morgen ? 'morgen' : 'vandaag'} (${dag}): gemiddeld ${ct(gem)} cent per kWh. Goedkoopst om ${nlTime(laag.t)} uur (${ct(P(laag))} ct), duurst om ${nlTime(hoog.t)} uur. Alle 96 kwartierprijzen inclusief belasting.`;
  const ld = ldBasis(title, url);
  ld['@graph'].push({
    '@type': 'Dataset', name: `Dynamische stroomprijs Nederland per kwartier, ${dag}`, description: desc, url,
    temporalCoverage: `${new Date(base.start).toISOString()}/${new Date(base.end).toISOString()}`, spatialCoverage: 'Nederland',
    dateModified: new Date(data.updated).toISOString(), inLanguage: 'nl-NL',
    creator: { '@type': 'Organization', name: 'Stroomwekker', url: 'https://stroomwekker.eu/' },
    isBasedOn: 'https://www.energy-charts.info/', license: 'https://creativecommons.org/licenses/by/4.0/',
    variableMeasured: 'Stroomprijs in euro per kWh inclusief btw en energiebelasting',
  });
  return html(pagina({ title, desc, url, h1: `Stroomprijs ${morgen ? 'morgen' : 'vandaag'} per kwartier`, intro: `${dag[0].toUpperCase() + dag.slice(1)}. Alle prijzen inclusief belasting, met de goedkoopste momenten.`, body, ld }), morgen ? 600 : 300);
};

function ldBasis(title, url) {
  return { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', name: title, url, inLanguage: 'nl-NL', isPartOf: { '@type': 'WebSite', name: 'Stroomwekker', url: 'https://stroomwekker.eu/' } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Stroomwekker', item: 'https://stroomwekker.eu/' },
      { '@type': 'ListItem', position: 2, name: title.split(' (')[0], item: url }] },
  ] };
}

function html(body, sMax) {
  return new Response(body, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Netlify-CDN-Cache-Control': `public, s-maxage=${sMax}, stale-while-revalidate=3600`,
  } });
}

export const config = { path: ['/stroomprijs-vandaag', '/stroomprijs-vandaag/', '/stroomprijs-morgen', '/stroomprijs-morgen/'] };
