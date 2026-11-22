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

export async function loadPrices(now = Date.now()) {
  let quarters = [], source = 'Energy-Charts (Fraunhofer ISE), day-ahead EPEX Nederland';
  try { quarters = await fromEnergyCharts(now); }
  catch (e) {
    console.error('energy-charts', e.message);
    quarters = await fromEnergyZero(now);
    source = 'EnergyZero (uurprijzen, reserve)';
  }
  // Ontdubbelen en sorteren
  const map = new Map(quarters.map(q => [q.t, q]));
  quarters = [...map.values()].sort((a, b) => a.t - b.t);
  let gasDays = {};
  try { gasDays = await gas(now); } catch (e) { console.error('gas', e.message); }
  return { updated: now, source, quarters, gas: gasDays };
}
