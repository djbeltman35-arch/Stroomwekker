// Vaste timer: welke tijd van de dag was de afgelopen 4 weken gemiddeld het goedkoopst?
// Voor stekkers die we niet zelf kunnen schakelen (zoals LSC): de gebruiker zet één keer een dagelijkse timer.
import { periode, ymd, plusDag, archiefStore, archiefMem } from './data.mjs';
import { price, nlTime, DEFAULT_SETTINGS } from '../../public/js/engine.js';

const DAGEN = 28;
const idx = t => { const [h, m] = nlTime(t).split(':').map(Number); return h * 4 + Math.floor(m / 15); };
const hhmm = i => String(Math.floor(i / 4) % 24).padStart(2, '0') + ':' + String((i % 4) * 15).padStart(2, '0');

export async function vasteTijd(uren, now = Date.now()) {
  const n = Math.max(1, Math.min(32, Math.round(Number(uren || 2) * 4)));
  const tot = plusDag(ymd(now), -1), van = plusDag(tot, -(DAGEN - 1)), key = `vast/${tot}/${n}`;
  const st = archiefStore();
  const hit = st ? await st.get(key, { type: 'json' }).catch(() => null) : archiefMem.get(key);
  if (hit) return hit;
  const qs = await periode(van, tot);
  const S = DEFAULT_SETTINGS, perDag = {};
  for (const q of qs) (perDag[ymd(q.t)] ||= new Array(96).fill(null))[idx(q.t)] = price(q.spot, S);
  const dagen = Object.values(perDag).filter(d => d.filter(v => v != null).length >= 92);
  if (dagen.length < 14) throw new Error('te weinig prijzen');
  for (const d of dagen) for (let i = 0; i < 96; i++) if (d[i] == null) d[i] = d[i - 1] ?? d[i + 1]; // zomer-/wintertijd
  const gemBlok = s => dagen.reduce((a, d) => { let x = 0; for (let k = 0; k < n; k++) x += d[s + k]; return a + x / n; }, 0) / dagen.length;
  let best = 0, bestV = Infinity;
  for (let s = 0; s + n <= 96; s++) { const v = gemBlok(s); if (v < bestV) { bestV = v; best = s; } }
  const dagGem = dagen.reduce((a, d) => a + d.reduce((x, y) => x + y, 0) / 96, 0) / dagen.length;
  const elkeDagBest = dagen.reduce((a, d) => { let m = Infinity; for (let s = 0; s + n <= 96; s++) { let x = 0; for (let k = 0; k < n; k++) x += d[s + k]; m = Math.min(m, x / n); } return a + m; }, 0) / dagen.length;
  const res = { uren: n / 4, aan: hhmm(best), uit: hhmm(best + n), vast: bestV, gem: dagGem, elkeDag: elkeDagBest, dagen: dagen.length, van, tot };
  if (st) await st.setJSON(key, res).catch(() => {}); else archiefMem.set(key, res);
  return res;
}
