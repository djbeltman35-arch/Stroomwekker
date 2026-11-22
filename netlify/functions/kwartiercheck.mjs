// Draait elk kwartier: stuurt meldingen en schakelt apparaten van alle gebruikers.
import webpush from 'web-push';
import { store } from '../lib/store.mjs';
import { refreshPrices } from '../lib/data.mjs';
import { switchDevice } from '../lib/devices.mjs';
import { alertsDue, deviceWants, batteryMode, price, current, fmtCt, nlTime, DEFAULT_SETTINGS } from '../../public/js/engine.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async () => {
  const now = Date.now() + 20e3; // net na de kwartierwissel: tel als het nieuwe kwartier
  const { quarters } = await refreshPrices(now); // ververst meteen de bewaarde prijzen voor bezoekers
  const s = store();
  const vapidOk = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY;
  if (vapidOk) webpush.setVapidDetails('mailto:djbeltman35@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const { blobs } = await s.list({ prefix: 'a/' });
  let sent = 0, switched = 0;
  for (const { key } of blobs) {
    const acc = await s.get(key, { type: 'json' });
    if (!acc) continue;
    const st = acc.state || (acc.state = {});
    const settings = { ...DEFAULT_SETTINGS, ...(acc.settings || {}) };
    const msgs = alertsDue(acc.alerts || [], quarters, now, settings, st.alerts || (st.alerts = {}));

    // Apparaten
    st.devices = st.devices || {};
    const cur = current(quarters, now);
    for (const d of acc.devices || []) {
      if (d.enabled === false) continue;
      const ds = st.devices[d.id] || {};
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
        st.devices[d.id] = { on: want, ok: true, at: now, msg: '' };
        switched++;
        if (d.notify !== false) msgs.push(d.rule?.type === 'battery' ? { id: 'dev-' + d.id,
          title: want === 'supply' ? `🔋 ${d.name} levert nu stroom` : want ? `🔋 ${d.name} laadt nu` : `🔋 ${d.name} staat stil`,
          body: cur ? `Stroom kost nu ${fmtCt(price(cur.spot, settings))}.` : '' } : { id: 'dev-' + d.id, title: d.rule?.type === 'solar' ? `☀️ ${d.name} ${want ? 'staan weer aan' : 'staan uit: terugleveren kost nu geld'}` : `${want ? '🔌' : '⏸️'} ${d.name} is ${want ? 'aangezet' : 'uitgezet'}`,
          body: cur ? `Stroom kost nu ${fmtCt(price(cur.spot, settings))}.` : '' });
      } catch (e) {
        st.devices[d.id] = { on: want, ok: false, at: now, msg: String(e.message).slice(0, 140) };
      }
      if (d.kind === 'shelly') await sleep(1100); // Shelly Cloud: max. 1 opdracht per seconde
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
