import { store, keyFor } from '../lib/store.mjs';
import { validateDevice, switchDevice, readMeter, listDevices } from '../lib/devices.mjs';
import { nlDayBounds } from '../../public/js/engine.js';
import { proefVoor, afdwingen } from '../lib/proef.mjs';

// Samenvatting van het verbruik voor de app: nu, vandaag en deze maand.
function verbruik(d, m) {
  if (d.kind === 'webhook') return { meet: false, reden: 'link' };
  if (!m) return { meet: null };
  if (m.meet === false) return { meet: false, reden: 'stekker' };
  const vandaag = nlDayBounds(Date.now()).day, maand = vandaag.slice(0, 7);
  const som = keys => keys.reduce((a, k) => { const x = m.days[k]; a.kwh += x.kwh; a.cost += x.cost; a.ref += x.ref; return a; }, { kwh: 0, cost: 0, ref: 0 });
  const dagen = Object.keys(m.days || {});
  return { meet: m.meet ?? null, est: !!m.est, w: m.w ?? null, at: m.at || null, err: m.err || '',
    vandaag: som(dagen.filter(k => k === vandaag)), maand: som(dagen.filter(k => k.startsWith(maand))) };
}


const MASK = '••••';
const mask = acc => ({
  settings: acc.settings, alerts: acc.alerts, hasPush: !!acc.push,
  devices: (acc.devices || []).map(d => ({ ...d, key: d.key ? MASK + d.key.slice(-4) : undefined, accessSecret: d.accessSecret ? MASK + d.accessSecret.slice(-4) : undefined,
    status: acc.state?.devices?.[d.id] || null, verbruik: verbruik(d, acc.state?.meter?.[d.id]), proef: acc.proef?.[d.id] || null })),
  betaaldTot: acc.betaaldTot || null, proefAfdwingen: afdwingen(),
});

// Gemaskeerde geheimen ('••••1234') vervangen door de bewaarde waarde
function keepSecrets(d, old) {
  if (!old) return d;
  if (String(d.key || '').startsWith(MASK)) d = { ...d, key: old.key };
  if (String(d.accessSecret || '').startsWith(MASK)) d = { ...d, accessSecret: old.accessSecret };
  return d;
}

function cleanAlerts(list) {
  return (Array.isArray(list) ? list : []).slice(0, 12).map(a => ({
    id: String(a.id || crypto.randomUUID()).slice(0, 40),
    type: ['below', 'above', 'cheapest', 'tomorrow', 'negative', 'battery', 'timer', 'warmte', 'gasmorgen'].includes(a.type) ? a.type : 'below',
    name: String(a.name || '').slice(0, 40),
    value: Number(a.value) || 0, hours: Math.max(0.25, Math.min(12, Number(a.hours) || 1)),
  }));
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'Ongeldig verzoek' }, { status: 400 }); }
  const s = store();
  let key;
  try { key = await keyFor(body.token); } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
  const acc = (await s.get(key, { type: 'json' })) || { created: Date.now(), state: {} };

  try {
    if (body.action === 'get') return Response.json(mask(acc));

    if (body.action === 'delete') { await s.delete(key); return Response.json({ ok: true }); }

    if (body.action === 'save') {
      if (body.settings) acc.settings = { mode: body.settings.mode === 'kaal' ? 'kaal' : 'allin',
        opslag: Math.max(0, Math.min(0.5, Number(body.settings.opslag) || 0)), gasOpslag: Math.max(0, Math.min(0.5, Number(body.settings.gasOpslag ?? 0.07) || 0)), lever: String(body.settings.lever || '').slice(0, 60) };
      if ('alerts' in body) acc.alerts = cleanAlerts(body.alerts);
      if ('push' in body) acc.push = body.push && body.push.endpoint?.startsWith('https://') ? body.push : null;
      if ('devices' in body) {
        const old = Object.fromEntries((acc.devices || []).map(d => [d.id, d]));
        acc.devices = (body.devices || []).slice(0, 10).map(d => {
          d = keepSecrets(d, old[d.id]);
          return validateDevice(d);
        });
        acc.proef = await proefVoor(s, acc.devices, Date.now(), acc.created || Date.now());
      }
      acc.updated = Date.now();
      await s.setJSON(key, acc);
      return Response.json(mask(acc));
    }

    if (body.action === 'list') {
      const d = { ...(body.device || {}), deviceId: 'zoekennnnn', rule: { type: 'cheap' } };
      const dev = validateDevice(d);
      return Response.json({ devices: await listDevices(dev) });
    }

    if (body.action === 'test') {
      let dev = (acc.devices || []).find(d => d.id === body.deviceId);
      if (body.device) {
        let d = body.device;
        d = keepSecrets(d, dev);
        dev = validateDevice(d);
      }
      if (!dev) return Response.json({ error: 'Apparaat niet gevonden' }, { status: 404 });
      await switchDevice(dev, body.on === 'supply' ? 'supply' : !!body.on);
      // Meteen kijken of deze stekker ook verbruik meet
      let meet = false;
      if (dev.kind !== 'webhook') { try { await new Promise(r => setTimeout(r, dev.kind === 'shelly' ? 1100 : 0)); meet = !!(await readMeter(dev, {})); } catch { meet = null; } }
      return Response.json({ ok: true, meet });
    }
  } catch (e) {
    return Response.json({ error: e.message || 'Er ging iets mis' }, { status: 400 });
  }
  return Response.json({ error: 'Onbekende actie' }, { status: 400 });
};

export const config = { path: '/api/account' };
