// Bespaarcheck: gemiddelde dynamische prijzen van de afgelopen 30 dagen (stroom per kWh, gas per m3, alles inclusief).
import { periode, gasPeriode, ymd, plusDag, archiefStore, archiefMem } from '../lib/data.mjs';
import { price, DEFAULT_SETTINGS } from '../../public/js/engine.js';

export default async () => {
  const now = Date.now(), tot = plusDag(ymd(now), -1), van = plusDag(tot, -29), key = 'bespaar2/' + tot;
  const st = archiefStore();
  let res = st ? await st.get(key, { type: 'json' }).catch(() => null) : archiefMem.get(key);
  if (!res) {
    try {
      const [qs, gas] = await Promise.all([periode(van, tot), gasPeriode(van, tot)]);
      if (qs.length < 96 * 20) throw new Error('te weinig prijzen');
      const S = DEFAULT_SETTINGS, perDag = {};
      for (const q of qs) (perDag[ymd(q.t)] ||= []).push(price(q.spot, S));
      const alle = qs.map(q => price(q.spot, S)), gem = alle.reduce((a, b) => a + b, 0) / alle.length;
      const derdes = Object.values(perDag).map(l => { const z = l.slice().sort((a, b) => a - b).slice(0, Math.ceil(l.length / 3)); return z.reduce((a, b) => a + b, 0) / z.length; });
      const goedkoop = derdes.reduce((a, b) => a + b, 0) / derdes.length;
      // Gemiddelde van de duurste 3 uur per dag: daar ontlaadt een thuisbatterij
      const pieken = Object.values(perDag).map(l => { const z = l.slice().sort((a, b) => b - a).slice(0, Math.min(12, l.length)); return z.reduce((a, b) => a + b, 0) / z.length; });
      const duur = pieken.reduce((a, b) => a + b, 0) / pieken.length;
      const gl = Object.values(gas);
      const gasGem = gl.length ? gl.reduce((a, b) => a + b, 0) / gl.length + S.gasOpslag : null;
      res = { van, tot, stroom: gem, stroomGoedkoop: goedkoop, stroomDuur: duur, gas: gasGem, opslag: S.opslag, gasOpslag: S.gasOpslag };
      if (st) await st.setJSON(key, res).catch(() => {}); else archiefMem.set(key, res);
    } catch (e) {
      return Response.json({ error: 'De prijzen zijn even niet bereikbaar. Probeer het straks opnieuw.' }, { status: 502 });
    }
  }
  return Response.json(res, { headers: { 'Cache-Control': 'public, max-age=600', 'Netlify-CDN-Cache-Control': 'public, s-maxage=3600' } });
};

export const config = { path: '/api/bespaar' };
