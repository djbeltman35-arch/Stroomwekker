// Prijsdata ophalen. Bron 1: Energy-Charts (Fraunhofer ISE, CC BY 4.0) met de officiële
// day-ahead kwartierprijzen voor Nederland. Bron 2 (reserve): EnergyZero uurprijzen.
// Gas: EnergyZero dagprijs (incl. energiebelasting en btw, excl. opslag leverancier).

function ymd(t) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

async function getJSON(url, ms = 8000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'Stroomwekker/1.0 (+https://stroomwekker.eu)' } });
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
}

async function fromEnergyCharts(now) {
  const start = ymd(now - 86400e3), end = ymd(now + 2 * 86400e3);
  const d = await getJSON(`https://api.energy-charts.info/price?bzn=NL&start=${start}&end=${end}`, 12000);
  if (!d.unix_seconds?.length) throw new Error('leeg antwoord');
  const out = [];
  d.unix_seconds.forEach((s, i) => {
    const v = d.price[i];
    if (v === null || v === undefined || Number.isNaN(v)) return;
    out.push({ t: s * 1000, spot: Math.round(v * 100) / 100000 }); // EUR/MWh -> EUR/kWh
  });
  // Kwartierdata? Zo niet (uurdata), splits uren in vier kwartieren.
  const step = out.length > 1 ? out[1].t - out[0].t : 900e3;
  if (step === 3600e3) return out.flatMap(q => [0, 1, 2, 3].map(k => ({ t: q.t + k * 900e3, spot: q.spot })));
  return out;
}

async function fromEnergyZero(now) {
  const from = new Date(now - 86400e3).toISOString(), till = new Date(now + 2 * 86400e3).toISOString();
  const d = await getJSON(`https://api.energyzero.nl/v1/energyprices?fromDate=${from}&tillDate=${till}&interval=4&usageType=1&inclBtw=false`);
  return d.Prices.flatMap(p => {
    const t = Date.parse(p.readingDate);
    return [0, 1, 2, 3].map(k => ({ t: t + k * 900e3, spot: p.price }));
  });
}

async function gas(now) {
  const from = new Date(now - 86400e3).toISOString(), till = new Date(now + 2 * 86400e3).toISOString();
  const d = await getJSON(`https://api.energyzero.nl/v1/energyprices?fromDate=${from}&tillDate=${till}&interval=4&usageType=3&inclBtw=true`);
  const days = {};
  for (const p of d.Prices) days[ymd(Date.parse(p.readingDate))] = p.price;
  return days; // { 'YYYY-MM-DD': prijs per m3 }
}

import { getStore } from '@netlify/blobs';

const memCache = { v: null }; // lokaal testen
const priceStore = () => process.env.DEV_MEMORY ? null : getStore({ name: 'prices' });

function nlHour(t) { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false }).format(new Date(t))); }
function dayStartNL(t) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });
  const day = fmt.format(new Date(t)); let s = Date.parse(day + 'T00:00:00Z') - 3 * 3600e3;
  while (fmt.format(new Date(s)) !== day) s += 900e3;
  return s;
}
// Heeft de data al (bijna) alle kwartieren van morgen?
function hasTomorrow(d, now) { const tm = dayStartNL(now) + 36 * 3600e3, s = dayStartNL(tm); return d.quarters.filter(q => q.t >= s && q.t < s + 25 * 3600e3).length >= 92; }

// Snelle weg voor bezoekers: bewaarde prijzen, alleen vernieuwen als het nodig is.
export async function getPrices(now = Date.now()) {
  const st = priceStore();
  let cached = st ? await st.get('latest', { type: 'json' }).catch(() => null) : memCache.v;
  const age = cached ? now - cached.updated : Infinity;
  // Na 13:00 vaker kijken tot de prijzen van morgen binnen zijn
  // Kwartierbron ontbrak? Dan snel opnieuw proberen. Na 13:00 vaker tot morgen binnen is.
  const maxAge = cached && !String(cached.source).startsWith('Energy-Charts') ? 3 * 60e3
    : (nlHour(now) >= 13 && cached && !hasTomorrow(cached, now)) ? 5 * 60e3 : 20 * 60e3;
  if (cached && age < maxAge && cached.quarters?.length) return cached;
  try { return await refreshPrices(now); }
  catch (e) { if (cached) return cached; throw e; }
}

export async function refreshPrices(now = Date.now()) {
  const d = await loadPrices(now);
  const from = dayStartNL(now);
  const slim = { ...d, quarters: d.quarters.filter(q => q.t >= from) }; // alleen vandaag en later
  const st = priceStore();
  if (st) await st.setJSON('latest', slim).catch(e => console.error('blob', e.message)); else memCache.v = slim;
  return slim;
}

export async function loadPrices(now = Date.now()) {
  // Beide bronnen tegelijk ophalen: Energy-Charts (kwartieren) en EnergyZero (uren, vaak eerder bekend voor morgen)
  const [ec, ez, gasDays] = await Promise.all([
    fromEnergyCharts(now).catch(e => { console.error('energy-charts', e.message); return []; }),
    fromEnergyZero(now).catch(e => { console.error('energyzero', e.message); return []; }),
    gas(now).catch(e => { console.error('gas', e.message); return {}; }),
  ]);
  if (!ec.length && !ez.length) throw new Error('Geen prijsbron bereikbaar');
  const map = new Map(ez.map(q => [q.t, q]));      // eerst de uurprijzen
  for (const q of ec) map.set(q.t, q);               // kwartierprijzen gaan voor
  const quarters = [...map.values()].sort((a, b) => a.t - b.t);
  const lastEc = ec.length ? ec[ec.length - 1].t : 0;
  const source = ec.length
    ? 'Energy-Charts (Fraunhofer ISE), day-ahead EPEX Nederland' + (quarters.some(q => q.t > lastEc) ? '; morgen voorlopig via EnergyZero (uurprijzen)' : '')
    : 'EnergyZero (uurprijzen)';
  return { updated: now, source, quarters, gas: gasDays };
}

// ---------- Prijsarchief (voorbije dagen en maanden) ----------
// Prijzen per kwartier van een periode uit Energy-Charts. Afgeronde periodes bewaren we, die veranderen niet meer.
const archiefMem = new Map();
const archiefStore = () => process.env.DEV_MEMORY ? null : getStore({ name: 'archief' });
export const ARCHIEF_START = '2025-10-01'; // sinds 1 oktober 2025 prijzen per kwartier

function plusDag(dag, n) { const d = new Date(dag + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

async function periode(van, tot) { // van/tot: 'YYYY-MM-DD' (beide NL-dagen, inclusief)
  const d = await getJSON(`https://api.energy-charts.info/price?bzn=NL&start=${plusDag(van, -1)}&end=${plusDag(tot, 1)}`, 15000);
  const s = dayStartNL(Date.parse(van + 'T12:00:00Z')), e = dayStartNL(Date.parse(plusDag(tot, 1) + 'T12:00:00Z'));
  let out = [];
  (d.unix_seconds || []).forEach((sec, i) => {
    const v = d.price[i]; const t = sec * 1000;
    if (v === null || v === undefined || Number.isNaN(v) || t < s || t >= e) return;
    out.push({ t, spot: Math.round(v * 100) / 100000 });
  });
  const step = out.length > 1 ? out[1].t - out[0].t : 900e3;
  if (step === 3600e3) out = out.flatMap(q => [0, 1, 2, 3].map(k => ({ t: q.t + k * 900e3, spot: q.spot })));
  return out;
}

async function gasPeriode(van, tot) {
  try {
    const d = await getJSON(`https://api.energyzero.nl/v1/energyprices?fromDate=${van}T00:00:00.000Z&tillDate=${plusDag(tot, 1)}T00:00:00.000Z&interval=4&usageType=3&inclBtw=true`);
    const days = {}; for (const p of d.Prices) days[ymd(Date.parse(p.readingDate))] = p.price; return days;
  } catch { return {}; }
}

// Eén dag: { dag, quarters, gas }
export async function dagArchief(dag, now = Date.now()) {
  const st = archiefStore(), key = 'dag/' + dag;
  const hit = st ? await st.get(key, { type: 'json' }).catch(() => null) : archiefMem.get(key);
  if (hit) return hit;
  let [quarters, g] = await Promise.all([periode(dag, dag).catch(() => []), gasPeriode(dag, dag)]);
  let bron = 'Energy-Charts (Fraunhofer ISE), day-ahead EPEX Nederland';
  if (quarters.length < 80) { // reserve: uurprijzen van EnergyZero
    const s = dayStartNL(Date.parse(dag + 'T12:00:00Z'));
    quarters = (await fromEnergyZero(s + 86400e3).catch(() => [])).filter(q => q.t >= s && q.t < s + 25 * 3600e3 && ymd(q.t) === dag);
    bron = 'EnergyZero (uurprijzen)';
  }
  const res = { dag, quarters, gas: g[dag] ?? null, bron };
  const klaar = dag < ymd(now) && quarters.length >= 92 && bron.startsWith('Energy-Charts');
  if (klaar) { if (st) await st.setJSON(key, res).catch(() => {}); else archiefMem.set(key, res); }
  return res;
}

// Eén maand: { maand, dagen: { 'YYYY-MM-DD': { gem, min, max, minT, maxT, n } }, gas }
export async function maandArchief(maand, now = Date.now()) {
  const st = archiefStore(), key = 'maand/' + maand;
  const hit = st ? await st.get(key, { type: 'json' }).catch(() => null) : archiefMem.get(key);
  if (hit) return hit;
  const van = maand + '-01';
  const d = new Date(van + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
  let tot = d.toISOString().slice(0, 10);
  const vandaag = ymd(now); if (tot >= vandaag) tot = plusDag(vandaag, -1);
  if (tot < van) return { maand, dagen: {}, gas: {} };
  const [qs, g] = await Promise.all([periode(van, tot), gasPeriode(van, tot)]);
  const dagen = {};
  for (const q of qs) {
    const k = ymd(q.t); const x = (dagen[k] ||= { som: 0, n: 0, min: Infinity, max: -Infinity, minT: 0, maxT: 0 });
    x.som += q.spot; x.n++;
    if (q.spot < x.min) { x.min = q.spot; x.minT = q.t; }
    if (q.spot > x.max) { x.max = q.spot; x.maxT = q.t; }
  }
  for (const k in dagen) { const x = dagen[k]; x.gem = x.som / x.n; delete x.som; }
  const res = { maand, dagen, gas: g };
  const maandKlaar = tot === d.toISOString().slice(0, 10);
  if (maandKlaar) { if (st) await st.setJSON(key, res).catch(() => {}); else archiefMem.set(key, res); }
  return res;
}
export { ymd, plusDag, gasPeriode };
