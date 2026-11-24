// Draait elk kwartier: stuurt meldingen en schakelt apparaten van alle gebruikers.
import webpush from 'web-push';
import { store } from '../lib/store.mjs';
import { refreshPrices } from '../lib/data.mjs';
import { switchDevice, readMeter } from '../lib/devices.mjs';
import { magSchakelen, afdwingen, proefVoor } from '../lib/proef.mjs';
import { alertsDue, deviceWants, batteryMode, price, current, fmtCt, nlTime, nlDayBounds, inRange, quarterStart, Q, DEFAULT_SETTINGS } from '../../public/js/engine.js';

// Verbruik van het afgelopen kwartier optellen bij de dag: kWh, wat het kostte, en wat het op een gemiddeld moment had gekost.
function boekVerbruik(m, r, now, quarters, settings) {
  const prevQ = quarterStart(now) - Q, pq = quarters.find(q => q.t === prevQ);
  let kwh = null;
  if (r.totalWh != null) {
    if (m.lastWh != null && r.totalWh >= m.lastWh && r.totalWh - m.lastWh < 5000) kwh = (r.totalWh - m.lastWh) / 1000;
    m.lastWh = r.totalWh;
  } else if (m.w != null && m.at && now - m.at < 20 * 60e3) {
    kwh = ((m.w + r.w) / 2) * 0.25 / 1000; // schatting uit twee metingen
  }
  m.w = Math.max(0, r.w); m.at = now; m.meet = true; m.est = !!r.est; m.err = '';
  if (!kwh || kwh <= 0 || !pq) return;
  const dag = nlDayBounds(prevQ), dq = inRange(quarters, dag.start, dag.end);
  const gem = dq.length ? dq.reduce((a, q) => a + price(q.spot, settings), 0) / dq.length : price(pq.spot, settings);
  const d = (m.days[dag.day] ||= { kwh: 0, cost: 0, ref: 0 });
  d.kwh += kwh; d.cost += kwh * price(pq.spot, settings); d.ref += kwh * gem;
  const keys = Object.keys(m.days).sort(); while (keys.length > 62) delete m.days[keys.shift()];
}


const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async () => {
  const now = Date.now() + 20e3; // net na de kwartierwissel: tel als het nieuwe kwartier
  const { quarters, gas } = await refreshPrices(now); // ververst meteen de bewaarde prijzen voor bezoekers
  const s = store();
  const vapidOk = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY;
  if (vapidOk) webpush.setVapidDetails('mailto:djbeltman35@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const { blobs } = await s.list({ prefix: 'a/' });
  let sent = 0, switched = 0;
  for (const { key } of blobs) {
    const acc = await s.get(key, { type: 'json' });
    if (!acc) continue;
    const st = acc.state || (acc.state = {});
    const settings = { ...DEFAULT_SETTINGS, ...(acc.settings || {}), gas: gas || {} };
    const msgs = alertsDue(acc.alerts || [], quarters, now, settings, st.alerts || (st.alerts = {}));

    // Proefperiode per stekker bijhouden (ook voor oudere accounts)
    if ((acc.devices || []).some(d => !acc.proef?.[d.id])) acc.proef = await proefVoor(s, acc.devices, now, acc.created || now);

    // Apparaten
    st.devices = st.devices || {};
    const cur = current(quarters, now);
    for (const d of acc.devices || []) {
      if (d.enabled === false) continue;
      const ds = st.devices[d.id] || {};
      const p = acc.proef?.[d.id];
      if (!magSchakelen(acc, p, now)) {
        if (!ds.proefOp) {
          st.devices[d.id] = { ...ds, ok: false, proefOp: true, at: now, msg: 'Je gratis proefperiode is voorbij. Start een abonnement om dit apparaat weer automatisch te laten schakelen.' };
          msgs.push({ id: 'proef-' + d.id, title: `⏰ Proefperiode voorbij voor ${d.name}`, body: 'Start een abonnement in Stroomwekker om weer automatisch te schakelen.' });
        }
        continue;
      }
      if (afdwingen() && p && !st.proefHerinnerd?.[d.id] && p.eind - now < 7 * 86400e3 && !(acc.betaaldTot > now)) {
        (st.proefHerinnerd ||= {})[d.id] = true;
        msgs.push({ id: 'proefbijna-' + d.id, title: `⏳ Nog een week gratis voor ${d.name}`, body: 'Daarna kost automatisch schakelen € 2,50 per maand.' });
      }
      let want = deviceWants(d, quarters, now, settings, ds.on);
      // Batterij met eigen links: drie standen (laden / leveren / stoppen)
      if (d.rule?.type === 'battery' && d.kind === 'webhook' && d.supplyUrl) {
        const m = batteryMode(d.rule.hours, quarters, now, settings);
        want = m === null ? null : m === 'charge' ? true : m === 'discharge' ? 'supply' : false;
      }
      if (want === null) continue;
      if (want === ds.on && ds.ok) continue; // al goed
      try {
        await switchDevice(d, want);
        if (ds.ok === false && ds.failAt) msgs.push({ id: 'herstel-' + d.id, title: `✅ ${d.name} werkt weer`, body: 'Stroomwekker kan dit apparaat weer aan en uit zetten.' });
        st.devices[d.id] = { on: want, ok: true, at: now, msg: '' };
        switched++;
        if (d.notify !== false) msgs.push(d.rule?.type === 'battery' ? { id: 'dev-' + d.id,
          title: want === 'supply' ? `🔋 ${d.name} levert nu stroom` : want ? `🔋 ${d.name} laadt nu` : `🔋 ${d.name} staat stil`,
          body: cur ? `Stroom kost nu ${fmtCt(price(cur.spot, settings))}.` : '' } : { id: 'dev-' + d.id, title: d.rule?.type === 'solar' ? `☀️ ${d.name} ${want ? 'staan weer aan' : 'staan uit: terugleveren kost nu geld'}` : `${want ? '🔌' : '⏸️'} ${d.name} is ${want ? 'aangezet' : 'uitgezet'}`,
          body: cur ? `Stroom kost nu ${fmtCt(price(cur.spot, settings))}.` : '' });
      } catch (e) {
        const msg = String(e.message).slice(0, 240);
        const failAt = ds.failAt || now, gemeld = ds.failPush || 0;
        st.devices[d.id] = { on: ds.on, ok: false, at: now, msg, failAt, failPush: gemeld };
        // Eén bericht als een apparaat twee keer achter elkaar niet reageert, daarna hooguit één keer per 12 uur
        if (now - failAt >= 14 * 60e3 && now - gemeld > 12 * 3600e3) {
          st.devices[d.id].failPush = now;
          const tuyaOp = /IoT Core/.test(msg);
          msgs.push({ id: 'fout-' + d.id, title: tuyaOp ? `⚠️ Tuya-koppeling verlopen: ${d.name}` : `⚠️ ${d.name} reageert niet`,
            body: tuyaOp ? 'Verleng de gratis IoT Core op platform.tuya.com (6 maanden). Open Stroomwekker voor de stappen.' : msg.replace(/^Tuya: /, '') });
        }
      }
      if (d.kind === 'shelly') await sleep(1100); // Shelly Cloud: max. 1 opdracht per seconde
    }

    // Verbruik meten (alleen stekkers met energiemeter; schakelen werkt met elke stekker)
    st.meter = st.meter || {};
    for (const d of acc.devices || []) {
      if (d.kind !== 'shelly' && d.kind !== 'tuya') continue;
      const m = (st.meter[d.id] ||= { days: {} });
      if (m.meet === false && m.checked && now - m.checked < 24 * 3600e3) continue; // meet niet: dagelijks opnieuw proberen
      try {
        const r = await readMeter(d, m);
        m.checked = now;
        if (r) boekVerbruik(m, r, now, quarters, settings); else m.meet = false;
      } catch (e) { m.err = String(e.message).slice(0, 120); }
      if (d.kind === 'shelly') await sleep(1100);
    }
    for (const id of Object.keys(st.meter)) if (!(acc.devices || []).some(d => d.id === id)) delete st.meter[id];

    // Maandoverzicht: op de 1e van de maand na 9:00 uur één bericht over de vorige maand
    const nlNu = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date(now));
    const deel = k => nlNu.find(p => p.type === k)?.value;
    if (deel('day') === '01' && Number(deel('hour')) >= 9) {
      const d0 = new Date(Date.UTC(Number(deel('year')), Number(deel('month')) - 2, 15));
      const vorige = d0.toISOString().slice(0, 7);
      if (st.maandGemeld !== vorige) {
        st.maandGemeld = vorige;
        let kwh = 0, kost = 0, ref = 0;
        for (const m of Object.values(st.meter)) for (const [dag, x] of Object.entries(m.days || {})) if (dag.startsWith(vorige)) { kwh += x.kwh; kost += x.cost; ref += x.ref; }
        if (kwh > 0.5) {
          const e2 = v => '€ ' + v.toFixed(2).replace('.', ',');
          const naam = new Intl.DateTimeFormat('nl-NL', { month: 'long' }).format(d0);
          msgs.push({ id: 'maand-' + vorige, title: `📊 Je ${naam} met Stroomwekker`,
            body: `Je apparaten gebruikten ${kwh.toFixed(1).replace('.', ',')} kWh voor ${e2(kost)}. ` + (ref - kost > 0.01 ? `Je bespaarde ${e2(ref - kost)} door op goedkope momenten stroom te gebruiken.` : 'Open Stroomwekker voor het overzicht.') });
        }
      }
    }

    // Pushmeldingen
    if (vapidOk && acc.push && msgs.length) {
      for (const m of msgs) {
        try { await webpush.sendNotification(acc.push, JSON.stringify(m), { TTL: 900, urgency: 'high' }); sent++; }
        catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { acc.push = null; break; } }
      }
    }
    await s.setJSON(key, acc);
  }
  console.log(`kwartiercheck: ${blobs.length} accounts, ${sent} meldingen, ${switched} schakelingen`);
};

export const config = { schedule: '*/15 * * * *' };
