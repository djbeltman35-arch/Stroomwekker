// Eigen Alexa-skill "Stroomwekker": per stekker twee virtuele deurbellen ("… aan" en "… uit").
// Stroomwekker "drukt" op een deurbel; de Alexa-routine van de gebruiker zet dan de stekker aan of uit.
import { store } from './store.mjs';

const EVENTS = 'https://api.eu.amazonalexa.com/v3/events';
const LWA = 'https://api.amazon.com/auth/o2/token';

export const sha = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(t))))].map(b => b.toString(16).padStart(2, '0')).join('');
export const willekeurig = (n = 40) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join(''); };

// Welke deurbellen heeft dit account? Eén paar per Alexa-stekker.
export function knoppen(acc) {
  const l = [];
  for (const d of acc.devices || []) {
    if (d.kind !== 'alexa' || !d.skill) continue;
    for (const [s, w] of [['aan', 'aan'], ['uit', 'uit']]) l.push({
      endpointId: `${d.id}-${s}`.replace(/[^\w.-]/g, '').slice(0, 250),
      friendlyName: `Stroomwekker ${d.name} ${w}`.slice(0, 128),
      description: `Stroomwekker drukt hierop als ${d.name} ${w} moet`,
      manufacturerName: 'Stroomwekker',
      displayCategories: ['DOORBELL'],
      capabilities: [
        { type: 'AlexaInterface', interface: 'Alexa.DoorbellEventSource', version: '3', proactivelyReported: true },
        { type: 'AlexaInterface', interface: 'Alexa.EndpointHealth', version: '3', properties: { supported: [{ name: 'connectivity' }], proactivelyReported: false, retrievable: true } },
        { type: 'AlexaInterface', interface: 'Alexa', version: '3' },
      ],
    });
  }
  return l;
}

// Token van Amazon om events te sturen (uit AcceptGrant), zo nodig verversen.
async function eventToken(acc) {
  const a = acc.alexa;
  if (!a?.refresh) throw new Error('Alexa is nog niet gekoppeld. Koppel Stroomwekker in de Alexa-app.');
  if (a.access && a.exp > Date.now() + 60e3) return a.access;
  const r = await fetch(LWA, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: a.refresh, client_id: process.env.ALEXA_CLIENT_ID || '', client_secret: process.env.ALEXA_CLIENT_SECRET || '' }), signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Alexa-koppeling verlopen. Koppel Stroomwekker opnieuw in de Alexa-app.');
  Object.assign(acc.alexa, { access: j.access_token, refresh: j.refresh_token || a.refresh, exp: Date.now() + (j.expires_in || 3600) * 1000 });
  return j.access_token;
}

export async function grantAanvragen(code) {
  const r = await fetch(LWA, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: process.env.ALEXA_CLIENT_ID || '', client_secret: process.env.ALEXA_CLIENT_SECRET || '' }), signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('AcceptGrant mislukt: ' + (j.error_description || r.status));
  return { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
}

async function stuur(acc, event) {
  const tok = await eventToken(acc);
  const r = await fetch(EVENTS, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(event), signal: AbortSignal.timeout(10000) });
  if (r.status === 401 || r.status === 403) { acc.alexa.access = null; throw new Error('Alexa weigert het bericht. Koppel Stroomwekker opnieuw in de Alexa-app.'); }
  if (!r.ok && r.status !== 202) throw new Error('Alexa antwoordde met een fout (' + r.status + ')');
}

// Op de deurbel drukken: aan of uit.
export async function druk(acc, d, aan) {
  const endpointId = `${d.id}-${aan ? 'aan' : 'uit'}`.replace(/[^\w.-]/g, '').slice(0, 250);
  await stuur(acc, { context: {}, event: {
    header: { namespace: 'Alexa.DoorbellEventSource', name: 'DoorbellPress', messageId: crypto.randomUUID(), payloadVersion: '3' },
    endpoint: { scope: { type: 'BearerToken', token: await eventToken(acc) }, endpointId },
    payload: { cause: { type: 'PHYSICAL_INTERACTION' }, timestamp: new Date().toISOString() },
  } });
  return 'ok';
}

// Nieuwe of gewijzigde stekkers meteen aan Alexa doorgeven (geen "apparaten zoeken" nodig).
export async function meldKnoppen(acc, oudeIds = []) {
  if (!acc.alexa?.refresh) return;
  const eps = knoppen(acc), weg = oudeIds.filter(id => !eps.some(e => e.endpointId === id));
  const tok = await eventToken(acc);
  // Weggehaalde stekkers ook uit Alexa halen
  if (weg.length) await stuur(acc, { event: {
    header: { namespace: 'Alexa.Discovery', name: 'DeleteReport', payloadVersion: '3', messageId: crypto.randomUUID() },
    payload: { endpoints: weg.map(endpointId => ({ endpointId })), scope: { type: 'BearerToken', token: tok } },
  } });
  if (!eps.length) return;
  await stuur(acc, { event: {
    header: { namespace: 'Alexa.Discovery', name: 'AddOrUpdateReport', payloadVersion: '3', messageId: crypto.randomUUID() },
    payload: { endpoints: eps, scope: { type: 'BearerToken', token: tok } },
  } });
}

// Ons eigen OAuth-token (account linking) → account-sleutel
export async function accountVoorToken(token) {
  if (!token) return null;
  const s = store(), t = await s.get('ot/' + await sha(token), { type: 'json' });
  if (!t || t.exp < Date.now()) return null;
  return t.key;
}
