// Stroomprijs vandaag / morgen: echte HTML met alle kwartierprijzen, zodat Google en AI-zoekers ze kunnen lezen.
import { getPrices, dagArchief, maandArchief, ARCHIEF_START, ymd, plusDag } from '../lib/data.mjs';
import { HEAD, HEADER, FOOTER } from '../lib/sjabloon.mjs';
import { price, nlDayBounds, inRange, cheapestBlock, priciestBlock, levels, levelOf, nlTime, current, negativeWindows, DEFAULT_SETTINGS, Q } from '../../public/js/engine.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ct = v => (v * 100).toFixed(1).replace('.', ',');
const eur = (v, d = 2) => '€ ' + v.toFixed(d).replace('.', ',');
const datum = t => new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(t));
const MAANDEN = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
const maandNaam = m => `${MAANDEN[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
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
.gidslijst{list-style:none;padding:0;margin:0;display:grid;gap:8px}.gidslijst a{display:block;border:1px solid var(--line);border-radius:8px;padding:12px 14px;text-decoration:none;color:var(--ink);background:var(--surface)}.gidslijst a b{display:block;font-size:16px}.gidslijst a span{color:var(--muted);font-size:14.5px}
.tabel td a{color:var(--ink);white-space:nowrap}.tabel small{display:block}.tabel small{color:var(--muted);font-weight:400}
</style>`;

function pagina({ title, desc, url, h1, intro, body, ld, nav }) {
  let head = HEAD.replaceAll('{{TITLE}}', esc(title)).replaceAll('{{DESC}}', esc(desc)).replaceAll('{{URL}}', url);
  head += CSS + `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n`;
  const header = HEADER.replace('href="/#meer">Prijzen', 'href="/stroomprijs-vandaag/" aria-current="page">Prijzen');
  return head + header + `
<div class="pkop"><div class="wrap pagina">
  <a class="terug" href="/">&larr; Terug naar de startpagina</a>
  <h1>${h1}</h1>
  <p>${intro}</p>
  <nav class="wissel" aria-label="Andere dag">${nav || '<a href="/stroomprijs-vandaag/">Vandaag</a><a href="/stroomprijs-morgen/">Morgen</a><a href="/stroomprijs/">Archief</a>'}</nav>
</div></div>
<main class="wrap pagina">
${body}
` + FOOTER;
}

export default async (req) => {
  const pad = new URL(req.url).pathname;
  const now = Date.now();
  if (pad.startsWith('/sitemap-archief')) return sitemap(now);
  const mDag = pad.match(/^\/stroomprijs\/(\d{4}-\d{2}-\d{2})\/?$/), mMaand = pad.match(/^\/stroomprijs\/(\d{4}-\d{2})\/?$/);
  if (/^\/stroomprijs\/?$/.test(pad)) return archiefIndex(now);
  if (mMaand) return maandPagina(mMaand[1], now);
  if (pad.startsWith('/stroomprijs/') && !mDag) return nietGevonden();
  const archief = mDag ? mDag[1] : null;
  if (archief && (archief < ARCHIEF_START || archief >= ymd(now))) {
    if (archief === ymd(now)) return Response.redirect('https://stroomwekker.eu/stroomprijs-vandaag/', 301);
    return nietGevonden();
  }
  const morgen = pad.includes('morgen');
  const base = archief ? nlDayBounds(Date.parse(archief + 'T12:00:00Z')) : morgen ? nlDayBounds(nlDayBounds(now).end + Q) : nlDayBounds(now);
  const url = archief ? `https://stroomwekker.eu/stroomprijs/${archief}/` : `https://stroomwekker.eu/stroomprijs-${morgen ? 'morgen' : 'vandaag'}/`;
  const dag = datum(base.start + 6 * 3600e3);
  let data = null;
  try {
    if (archief) { const a = await dagArchief(archief, now); data = { quarters: a.quarters, gas: { [base.day]: a.gas }, source: a.bron, updated: base.end }; }
    else data = await getPrices(now);
  } catch { /* hieronder netjes melden */ }
  const qs = data ? inRange(data.quarters, base.start, base.end) : [];
  const S = DEFAULT_SETTINGS;
  const kort = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'long' }).format(new Date(base.start + 6 * 3600e3));
  const zonderWeekdag = dag.replace(/^\S+ /, '');
  const title = archief ? `Stroomprijs ${zonderWeekdag} per kwartier | Stroomwekker` : `Stroomprijs ${morgen ? 'morgen' : 'vandaag'} per kwartier (${kort}) | Stroomwekker`;
  const nav = archief ? `<a href="/stroomprijs/${plusDag(archief, -1)}/">&larr; Vorige dag</a>${plusDag(archief, 1) < ymd(now) ? `<a href="/stroomprijs/${plusDag(archief, 1)}/">Volgende dag &rarr;</a>` : '<a href="/stroomprijs-vandaag/">Vandaag &rarr;</a>'}<a href="/stroomprijs/${archief.slice(0, 7)}/">Heel ${maandNaam(archief.slice(0, 7))}</a>` : null;

  if (qs.length < 80) {
    const body = `<section class="card"><h2>${morgen ? 'De prijzen van morgen zijn er nog niet' : 'Prijzen even niet beschikbaar'}</h2>
<p>${morgen ? 'De stroomprijzen voor morgen worden elke middag rond 13:00 uur bekend gemaakt op de Europese stroombeurs. Kom na 13:00 uur terug, of laat Stroomwekker je een bericht sturen zodra ze er zijn.' : 'We konden de stroomprijzen nu niet ophalen. Probeer het over een paar minuten opnieuw.'}</p>
<div class="cta"><a class="btn" href="/?start=bericht">Stuur mij een bericht</a><a class="btn btn-line" href="/stroomprijs-vandaag/">Bekijk de prijzen van vandaag</a></div></section>`;
    if (archief) return html(pagina({ title, desc: `Stroomprijs ${dag}.`, url, nav, h1: `Stroomprijs ${zonderWeekdag}`, intro: dag, body: '<section class="card"><h2>Prijzen even niet beschikbaar</h2><p>We konden de prijzen van deze dag nu niet ophalen. Probeer het later opnieuw.</p></section>', ld: ldBasis(title, url) }), 120);
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
  const nu = !morgen && !archief ? current(qs, now) : null;
  const gas = data.gas?.[base.day];
  const blokTxt = b => b ? `${nlTime(b.start)} tot ${nlTime(b.end)} uur` : '–';

  const samenvatting = [
    `De gemiddelde stroomprijs ${archief ? 'was op ' + dag : 'is ' + (morgen ? 'morgen' : 'vandaag') + ', ' + dag}, <b>${ct(gem)} cent per kWh</b>, inclusief btw, energiebelasting en ${ct(S.opslag)} cent inkoopvergoeding.`,
    `Het goedkoopste kwartier ${archief ? 'was' : 'is'} om <b>${nlTime(laag.t)} uur (${ct(P(laag))} cent)</b>. Het duurste kwartier ${archief ? 'was' : 'is'} om <b>${nlTime(hoog.t)} uur (${ct(P(hoog))} cent)</b>.`,
    blok3 ? `De goedkoopste 3 uur achter elkaar ${archief ? 'waren' : 'zijn'} van <b>${blokTxt(blok3)}</b> (gemiddeld ${ct(price(blok3.avg, S))} cent). Dat is het beste moment voor de wasmachine, vaatwasser, boiler of het laden van je auto.` : '',
    duur3 ? (archief ? `Het duurst was het van ${blokTxt(duur3)}.` : `Probeer weinig stroom te gebruiken van ${blokTxt(duur3)}.`) : '',
    neg.length ? `${archief ? 'De beursprijs was negatief' : 'Let op als je zonnepanelen hebt: de beursprijs is negatief'} van ${neg.map(w => `${nlTime(w.start)} tot ${nlTime(w.end)}`).join(' en ')} uur.${archief ? '' : ' Terugleveren kost je dan geld.'}` : '',
    gratis ? `In ${gratis} kwartier${gratis > 1 ? 'en' : ''} ${archief ? 'was stroom zelfs gratis of kreeg je' : 'is stroom zelfs gratis of krijg je'} geld toe.` : '',
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
      <div><span>Gas ${archief ? 'die dag' : morgen ? 'morgen' : 'vandaag'}</span><b>${gas != null ? eur(gas) : '–'}</b><small>per m³</small></div>
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
    <p>Rekent jouw energiebedrijf een andere inkoopvergoeding? Stel die in bij Stroomwekker, dan kloppen alle prijzen precies voor jou. Bron: ${esc(data.source)}.${archief ? '' : ` Bijgewerkt om ${nlTime(data.updated)} uur.`} Oudere dagen vind je in het <a href="/stroomprijs/">prijsarchief</a>.</p>
    <p>Liever niet zelf opletten? <a href="/hoe-werkt-het/">Lees hoe Stroomwekker je apparaten vanzelf aanzet</a> in de goedkoopste kwartieren.</p>
    <p>Meer weten? <a href="/gids/dynamisch-energiecontract/">Wat is een dynamisch energiecontract?</a> · <a href="/gids/negatieve-stroomprijs/">Negatieve stroomprijs</a> · <a href="/gids/stroomprijs-per-kwartier/">Waarom per kwartier?</a> · <a href="/zo-rekenen-wij/">Zo berekenen wij de prijs</a></p>
  </section>`;

  const desc = `Stroomprijs ${archief ? dag : (morgen ? 'morgen' : 'vandaag') + ' (' + dag + ')'}: gemiddeld ${ct(gem)} cent per kWh. Goedkoopst om ${nlTime(laag.t)} uur (${ct(P(laag))} ct), duurst om ${nlTime(hoog.t)} uur. Alle 96 kwartierprijzen inclusief belasting.`;
  const ld = ldBasis(title, url, archief ? [['Prijsarchief', 'https://stroomwekker.eu/stroomprijs/'], [maandNaam(archief.slice(0, 7)), `https://stroomwekker.eu/stroomprijs/${archief.slice(0, 7)}/`]] : []);
  ld['@graph'].push({
    '@type': 'Dataset', name: `Dynamische stroomprijs Nederland per kwartier, ${dag}`, description: desc, url,
    temporalCoverage: `${new Date(base.start).toISOString()}/${new Date(base.end).toISOString()}`, spatialCoverage: 'Nederland',
    dateModified: new Date(data.updated).toISOString(), inLanguage: 'nl-NL',
    creator: { '@type': 'Organization', name: 'Stroomwekker', url: 'https://stroomwekker.eu/' },
    isBasedOn: 'https://www.energy-charts.info/', license: 'https://creativecommons.org/licenses/by/4.0/',
    variableMeasured: 'Stroomprijs in euro per kWh inclusief btw en energiebelasting',
  });
  return html(pagina({ title, desc, url, nav, h1: archief ? `Stroomprijs ${zonderWeekdag}` : `Stroomprijs ${morgen ? 'morgen' : 'vandaag'} per kwartier`, intro: `${dag[0].toUpperCase() + dag.slice(1)}. Alle prijzen inclusief belasting, met de goedkoopste momenten.`, body, ld }), archief ? 31536000 : morgen ? 600 : 300);
};

function ldBasis(title, url, tussen = []) {
  const kr = [['Stroomwekker', 'https://stroomwekker.eu/'], ...tussen, [title.split(' (')[0].replace(' | Stroomwekker', ''), url]];
  return { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', name: title, url, inLanguage: 'nl-NL', isPartOf: { '@type': 'WebSite', name: 'Stroomwekker', url: 'https://stroomwekker.eu/' } },
    { '@type': 'BreadcrumbList', itemListElement: kr.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })) },
  ] };
}

// ---------- Archief: overzicht, maanden en sitemap ----------
const kortDag = d => new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00:00Z'));
const dagNaam = d => datum(Date.parse(d + 'T12:00:00Z'));
function maanden(now) {
  const uit = []; let m = ARCHIEF_START.slice(0, 7); const laatste = ymd(now - 86400e3).slice(0, 7);
  while (m <= laatste) { uit.push(m); const d = new Date(m + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); m = d.toISOString().slice(0, 7); }
  return uit.reverse();
}
const hoofd = t => t[0].toUpperCase() + t.slice(1);

function archiefIndex(now) {
  const lijst = maanden(now);
  const recent = []; for (let i = 1; i <= 14; i++) recent.push(plusDag(ymd(now), -i));
  const body = `
  <section class="card">
    <h2>De afgelopen twee weken</h2>
    <ul class="gidslijst">${recent.map(d => `<li><a href="/stroomprijs/${d}/"><b>${hoofd(dagNaam(d))}</b><span>Alle 96 kwartierprijzen van die dag</span></a></li>`).join('')}</ul>
  </section>
  <section class="card">
    <h2>Per maand</h2>
    <ul class="gidslijst">${lijst.map(m => `<li><a href="/stroomprijs/${m}/"><b>${hoofd(maandNaam(m))}</b><span>Gemiddelde, laagste en hoogste prijs per dag</span></a></li>`).join('')}</ul>
  </section>
  <section class="card">
    <h2>Over dit archief</h2>
    <p>Sinds 1 oktober 2025 wordt stroom op de beurs per kwartier verhandeld. Hier vind je alle dagen sinds dat moment. Alle prijzen zijn inclusief btw, energiebelasting en ${ct(DEFAULT_SETTINGS.opslag)} cent inkoopvergoeding. <a href="/zo-rekenen-wij/">Zo berekenen wij de prijs</a>.</p>
  </section>`;
  const title = 'Stroomprijs archief: alle dagen per kwartier | Stroomwekker';
  const url = 'https://stroomwekker.eu/stroomprijs/';
  return html(pagina({ title, desc: 'Archief van de dynamische stroomprijs in Nederland: per dag alle kwartierprijzen en per maand het gemiddelde, de laagste en de hoogste prijs. Sinds oktober 2025.', url, h1: 'Stroomprijs archief', intro: 'Alle dagen sinds de start van de kwartierprijzen, inclusief belasting.', body, ld: ldBasis(title, url) }), 3600);
}

async function maandPagina(m, now) {
  if (!maanden(now).includes(m)) return nietGevonden();
  let a; try { a = await maandArchief(m, now); } catch { a = null; }
  const S = DEFAULT_SETTINGS, P = v => price(v, S);
  const dagen = a ? Object.keys(a.dagen).sort() : [];
  const naam = maandNaam(m);
  const url = `https://stroomwekker.eu/stroomprijs/${m}/`;
  const title = `Stroomprijs ${naam} per dag | Stroomwekker`;
  let body;
  if (!dagen.length) body = '<section class="card"><h2>Prijzen even niet beschikbaar</h2><p>Probeer het later opnieuw.</p></section>';
  else {
    const gem = dagen.reduce((x, d) => x + P(a.dagen[d].gem), 0) / dagen.length;
    const goed = dagen.reduce((x, d) => P(a.dagen[d].gem) < P(a.dagen[x].gem) ? d : x);
    const duur = dagen.reduce((x, d) => P(a.dagen[d].gem) > P(a.dagen[x].gem) ? d : x);
    const rijen = dagen.map(d => { const x = a.dagen[d]; return `<tr><td><a href="/stroomprijs/${d}/">${kortDag(d)}</a></td><td>${ct(P(x.gem))}</td><td class="goedkoop">${ct(P(x.min))} <small>${nlTime(x.minT)}</small></td><td class="duur">${ct(P(x.max))} <small>${nlTime(x.maxT)}</small></td><td>${a.gas?.[d] != null ? eur(a.gas[d]).replace(' ', '&nbsp;') : '–'}</td></tr>`; }).join('\n');
    body = `
  <section class="card">
    <h2>Samenvatting</h2>
    <p>In ${naam} was stroom gemiddeld <b>${ct(gem)} cent per kWh</b>, inclusief btw, energiebelasting en ${ct(S.opslag)} cent inkoopvergoeding. De goedkoopste dag was <a href="/stroomprijs/${goed}/">${dagNaam(goed)}</a> (gemiddeld ${ct(P(a.dagen[goed].gem))} cent). De duurste dag was <a href="/stroomprijs/${duur}/">${dagNaam(duur)}</a> (gemiddeld ${ct(P(a.dagen[duur].gem))} cent).</p>
  </section>
  <section class="card">
    <h2>Stroomprijs per dag, ${naam}</h2>
    <p class="small muted">In cent per kWh, inclusief belasting. Laagste en hoogste kwartier van de dag, met het tijdstip. Gas in euro per m³. Kies een dag voor alle kwartieren.</p>
    <div class="tabelwrap"><table class="tabel">
      <thead><tr><th scope="col">Dag</th><th scope="col">Gem.</th><th scope="col">Laagst</th><th scope="col">Hoogst</th><th scope="col">Gas</th></tr></thead>
      <tbody>
${rijen}
      </tbody>
    </table></div>
  </section>`;
  }
  const lijst = maanden(now), i = lijst.indexOf(m);
  const nav = `${lijst[i + 1] ? `<a href="/stroomprijs/${lijst[i + 1]}/">&larr; ${maandNaam(lijst[i + 1])}</a>` : ''}${lijst[i - 1] ? `<a href="/stroomprijs/${lijst[i - 1]}/">${maandNaam(lijst[i - 1])} &rarr;</a>` : ''}<a href="/stroomprijs/">Archief</a>`;
  const klaar = m < ymd(now).slice(0, 7);
  return html(pagina({ title, desc: `Dynamische stroomprijs in ${naam}: gemiddeld, laagst en hoogst per dag, inclusief belasting. Met de goedkoopste en duurste dag van de maand.`, url, nav, h1: `Stroomprijs ${naam}`, intro: `${hoofd(naam)}: per dag de gemiddelde, laagste en hoogste prijs.`, body, ld: ldBasis(title, url, [['Prijsarchief', 'https://stroomwekker.eu/stroomprijs/']]) }), klaar ? 31536000 : 3600);
}

function sitemap(now) {
  const urls = ['https://stroomwekker.eu/stroomprijs/'];
  for (const m of maanden(now)) urls.push(`https://stroomwekker.eu/stroomprijs/${m}/`);
  for (let d = ARCHIEF_START; d < ymd(now); d = plusDag(d, 1)) urls.push(`https://stroomwekker.eu/stroomprijs/${d}/`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Netlify-CDN-Cache-Control': 'public, s-maxage=21600' } });
}

function nietGevonden() {
  return new Response('<!doctype html><meta charset="utf-8"><title>Niet gevonden</title><p>Deze pagina staat niet in het archief. <a href="/stroomprijs/">Naar het prijsarchief</a></p>', { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}


function html(body, sMax) {
  return new Response(body, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Netlify-CDN-Cache-Control': `public, s-maxage=${sMax}, stale-while-revalidate=3600`,
  } });
}

export const config = { path: ['/stroomprijs-vandaag', '/stroomprijs-vandaag/', '/stroomprijs-morgen', '/stroomprijs-morgen/', '/stroomprijs', '/stroomprijs/', '/stroomprijs/:p', '/stroomprijs/:p/', '/sitemap-archief.xml'] };
