import { store, keyFor } from '../lib/store.mjs';
import { validateDevice, switchDevice, readMeter, listDevices, easeeLogin } from '../lib/devices.mjs';
import { nlDayBounds } from '../../public/js/engine.js';
import { proefVoor, afdwingen } from '../lib/proef.mjs';
import { stuurMail, geldigMail, hashMail, willekeurig } from '../lib/mail.mjs';

const SITE = 'https://stroomwekker.eu';

// Samenvatting van het verbruik voor de app: nu, vandaag en deze maand.
function verbruik(d, m) {
  if (d.kind === 'webhook' || d.kind === 'easee') return { meet: false, reden: 'link' };
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
  devices: (acc.devices || []).map(d => ({ ...d, key: d.key ? MASK + d.key.slice(-4) : undefined, accessSecret: d.accessSecret ? MASK + d.accessSecret.slice(-4) : undefined, eAccess: d.eAccess ? MASK : undefined, eRefresh: d.eRefresh ? MASK : undefined,
    status: acc.state?.devices?.[d.id] || null, verbruik: verbruik(d, acc.state?.meter?.[d.id]), proef: acc.proef?.[d.id] || null })),
  betaaldTot: acc.betaaldTot || null, proefAfdwingen: afdwingen(),
  email: acc.email ? { adres: acc.email.adres, ok: !!acc.email.ok, berichten: acc.email.berichten !== false } : null,
});

// Gemaskeerde geheimen ('••••1234') vervangen door de bewaarde waarde
function keepSecrets(d, old) {
  if (!old) return d;
  if (String(d.key || '').startsWith(MASK)) d = { ...d, key: old.key };
  if (String(d.accessSecret || '').startsWith(MASK)) d = { ...d, accessSecret: old.accessSecret };
  if (String(d.eRefresh || '').startsWith(MASK)) d = { ...d, eAccess: old.eAccess, eRefresh: old.eRefresh, eExp: old.eExp };
  return d;
}

function cleanAlerts(list) {
  return (Array.isArray(list) ? list : []).slice(0, 12).map(a => ({
    id: String(a.id || crypto.randomUUID()).slice(0, 40),
    type: ['below', 'above', 'cheapest', 'tomorrow', 'negative', 'battery', 'timer', 'vastetimer', 'warmte', 'gasmorgen'].includes(a.type) ? a.type : 'below',
    name: String(a.name || '').slice(0, 40),
    ...(/^\d\d:\d\d$/.test(a.aan) ? { aan: a.aan } : {}),
    value: Number(a.value) || 0, hours: Math.max(0.25, Math.min(12, Number(a.hours) || 1)),
  }));
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'Ongeldig verzoek' }, { status: 400 }); }
  const s = store();

  // Inloglink: werkt zonder sleutel. Altijd hetzelfde antwoord, zodat niemand kan zien welke adressen bestaan.
  if (body.action === 'loginlink') {
    const ok = { ok: true, msg: 'Staat dit adres bij ons? Dan krijg je binnen een minuut een mail met een inloglink.' };
    if (!geldigMail(body.email)) return Response.json({ error: 'Vul een geldig e-mailadres in' }, { status: 400 });
    const ek = await hashMail(body.email), idx = await s.get(ek, { type: 'json' });
    if (!idx?.ok || !idx.token || Date.now() - (idx.linkAt || 0) < 60e3) return Response.json(ok);
    const nonce = willekeurig(24);
    await s.setJSON('l/' + nonce, { token: idx.token, exp: Date.now() + 30 * 60e3 });
    await s.setJSON(ek, { ...idx, linkAt: Date.now() });
    try { await stuurMail(body.email.trim(), 'Je inloglink voor Stroomwekker',
      `Hallo,

Klik op deze link om Stroomwekker op dit apparaat te openen met je eigen berichten en apparaten:

${SITE}/?login=${nonce}

De link werkt 30 minuten en één keer.

Heb je dit niet zelf gevraagd? Dan hoef je niets te doen.

Stroomwekker`); } catch (e) { console.error('loginlink', e.message); }
    return Response.json(ok);
  }
  if (body.action === 'login') {
    const n = String(body.nonce || ''); if (!/^[A-Za-z0-9_-]{20,64}$/.test(n)) return Response.json({ error: 'Deze link klopt niet' }, { status: 400 });
    const l = await s.get('l/' + n, { type: 'json' }); await s.delete('l/' + n);
    if (!l || l.exp < Date.now()) return Response.json({ error: 'Deze inloglink is verlopen of al gebruikt. Vraag een nieuwe aan.' }, { status: 400 });
    return Response.json({ token: l.token });
  }

  let key;
  try { key = await keyFor(body.token); } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
  const acc = (await s.get(key, { type: 'json' })) || { created: Date.now(), state: {} };

  try {
    if (body.action === 'get') return Response.json(mask(acc));

    if (body.action === 'delete') { if (acc.email?.adres) await s.delete(await hashMail(acc.email.adres)).catch(() => {}); await s.delete(key); return Response.json({ ok: true }); }

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

    if (body.action === 'email') {
      // E-mailadres instellen of wissen. Eerst bevestigen via een link.
      if (!body.email) {
        if (acc.email?.adres) await s.delete(await hashMail(acc.email.adres)).catch(() => {});
        acc.email = null; await s.setJSON(key, acc); return Response.json(mask(acc));
      }
      if (!geldigMail(body.email)) return Response.json({ error: 'Vul een geldig e-mailadres in' }, { status: 400 });
      const adres = body.email.trim(), zelfde = acc.email?.adres?.toLowerCase() === adres.toLowerCase();
      if (zelfde && 'berichten' in body) { acc.email.berichten = !!body.berichten; await s.setJSON(key, acc); return Response.json(mask(acc)); }
      if (zelfde && acc.email.ok) return Response.json(mask(acc));
      if (acc.email?.at && Date.now() - acc.email.at < 60e3) return Response.json({ error: 'Even geduld: we hebben net al een mail gestuurd.' }, { status: 429 });
      if (acc.email?.adres && !zelfde) await s.delete(await hashMail(acc.email.adres)).catch(() => {});
      const code = willekeurig(18);
      acc.email = { adres, ok: false, code, at: Date.now(), berichten: body.berichten !== false };
      await s.setJSON(await hashMail(adres), { token: body.token, ok: false });
      await s.setJSON(key, acc);
      await stuurMail(adres, 'Bevestig je e-mailadres voor Stroomwekker',
        `Hallo,

Klik op deze link om je e-mailadres te bevestigen:

${SITE}/api/email?a=${key.slice(2)}&c=${code}

Daarna krijg je elke ochtend één mail met de beste tijden van de dag, en kun je met een inloglink op een ander apparaat inloggen.

Heb je dit niet zelf gevraagd? Dan hoef je niets te doen.

Stroomwekker`);
      return Response.json(mask(acc));
    }

    if (body.action === 'easee-login') {
      const u = String(body.user || '').trim(), p = String(body.password || '');
      if (!u || !p) return Response.json({ error: 'Vul je e-mailadres en wachtwoord van Easee in' }, { status: 400 });
      return Response.json(await easeeLogin(u, p)); // wachtwoord wordt niet bewaard
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
      // Easee: nieuwe sleutels na verversen meteen bewaren (een refresh-token werkt maar één keer)
      if (dev.kind === 'easee') { const i = (acc.devices || []).findIndex(x => x.id === dev.id); if (i >= 0) { Object.assign(acc.devices[i], { eAccess: dev.eAccess, eRefresh: dev.eRefresh, eExp: dev.eExp }); await s.setJSON(key, acc); } }
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
