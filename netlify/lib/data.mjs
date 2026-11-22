// Prijsdata ophalen. Bron 1: Energy-Charts (Fraunhofer ISE, CC BY 4.0) met de officiële
// day-ahead kwartierprijzen voor Nederland. Bron 2 (reserve): EnergyZero uurprijzen.
// Gas: EnergyZero dagprijs (incl. energiebelasting en btw, excl. opslag leverancier).

function ymd(t) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

async function getJSON(url, ms = 8000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'Stroomwekker/1.0 (+https://stroomwekker.netlify.app)' } });
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
}

async function fromEnergyCharts(now) {
  const start = ymd(now - 86400e3), end = ymd(now + 2 * 86400e3);
  const d = await getJSON(`https://api.energy-charts.info/price?bzn=NL&start=${start}&end=${end}`);
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
  const maxAge = (nlHour(now) >= 13 && cached && !hasTomorrow(cached, now)) ? 5 * 60e3 : 20 * 60e3;
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
