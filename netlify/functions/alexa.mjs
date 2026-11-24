// Alexa-skill "Stroomwekker":
//  POST /api/alexa         — directives van Alexa (via het AWS Lambda-doorgeefluik)
//  GET/POST /api/alexa/koppel — inlogpagina voor het koppelen (account linking), met een koppelcode uit Stroomwekker
//  POST /api/alexa/token   — OAuth-tokens voor Alexa
import { store } from '../lib/store.mjs';
import { sha, willekeurig, knoppen, grantAanvragen, accountVoorToken, druk } from '../lib/alexaskill.mjs';

const CLIENT_ID = 'stroomwekker-alexa';
const JAAR = 365 * 86400e3;
// Vaste koppelcode voor de controleurs van Amazon: koppelt aan een demo-account met één "Testlamp".
const DEMO_CODE = 'AMZ123', DEMO_KEY = 'a/demo-amazon-review';
async function demoAccount(s) {
  let acc = await s.get(DEMO_KEY, { type: 'json' });
  if (!acc) { acc = { created: Date.now(), state: {}, devices: [{ id: 'demo', name: 'Testlamp', kind: 'alexa', skill: true, enabled: true, notify: false, rule: { type: 'cheapest', hours: 2, block: true } }] }; await s.setJSON(DEMO_KEY, acc); }
  return acc;
}
const AMAZON_REDIRECT = /^https:\/\/([\w-]+\.)*(amazon\.(com|co\.uk|de|nl|fr|it|es|co\.jp)|amazonalexa\.com)\//;

const hdr = (namespace, name, extra = {}) => ({ namespace, name, messageId: crypto.randomUUID(), payloadVersion: '3', ...extra });
const fout = (d, type, message) => ({ event: { header: hdr('Alexa', 'ErrorResponse', d?.header?.correlationToken ? { correlationToken: d.header.correlationToken } : {}),
  endpoint: d?.endpoint?.endpointId ? { endpointId: d.endpoint.endpointId } : undefined, payload: { type, message } } });

async function directive(req) {
  const body = await req.json().catch(() => null);
  const d = body?.directive;
  if (!d?.header) return Response.json(fout(null, 'INVALID_DIRECTIVE', 'Geen directive'), { status: 400 });
  const { namespace, name } = d.header, s = store();

  if (namespace === 'Alexa.Authorization' && name === 'AcceptGrant') {
    try {
      const key = await accountVoorToken(d.payload?.grantee?.token);
      if (!key) throw new Error('Onbekend account');
      const acc = await s.get(key, { type: 'json' });
      if (!acc) throw new Error('Onbekend account');
      acc.alexa = await grantAanvragen(d.payload.grant.code);
      await s.setJSON(key, acc);
      return Response.json({ event: { header: hdr('Alexa.Authorization', 'AcceptGrant.Response'), payload: {} } });
    } catch (e) {
      console.error('AcceptGrant', e.message);
      return Response.json({ event: { header: hdr('Alexa.Authorization', 'ErrorResponse'), payload: { type: 'ACCEPT_GRANT_FAILED', message: e.message } } });
    }
  }

  if (namespace === 'Alexa.Discovery' && name === 'Discover') {
    const key = await accountVoorToken(d.payload?.scope?.token);
    const acc = key ? await s.get(key, { type: 'json' }) : null;
    return Response.json({ event: { header: hdr('Alexa.Discovery', 'Discover.Response'), payload: { endpoints: acc ? knoppen(acc) : [] } } });
  }

  const token = d.endpoint?.scope?.token || d.payload?.scope?.token;
  if (!(await accountVoorToken(token))) return Response.json(fout(d, 'INVALID_AUTHORIZATION_CREDENTIAL', 'Koppel Stroomwekker opnieuw'));

  if (namespace === 'Alexa' && name === 'ReportState') {
    return Response.json({ context: { properties: [{ namespace: 'Alexa.EndpointHealth', name: 'connectivity', value: { value: 'OK' }, timeOfSample: new Date().toISOString(), uncertaintyInMilliseconds: 0 }] },
      event: { header: hdr('Alexa', 'StateReport', { correlationToken: d.header.correlationToken }), endpoint: { endpointId: d.endpoint.endpointId }, payload: {} } });
  }
  return Response.json(fout(d, 'INVALID_DIRECTIVE', 'Niet ondersteund'));
}

const pagina = (inhoud) => new Response(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stroomwekker koppelen</title>
<style>body{margin:0;font:17px/1.5 system-ui,sans-serif;background:#f4f6fa;color:#0F2340}main{max-width:420px;margin:0 auto;padding:28px 20px}h1{font-size:28px;margin:0 0 8px}.logo{font-weight:800;font-size:22px;background:#0F2340;color:#fff;padding:14px 20px}.logo b{color:#F5B700}
input{font:700 28px/1 ui-monospace,monospace;letter-spacing:6px;text-transform:uppercase;width:100%;box-sizing:border-box;padding:14px;border:2px solid #C9D3E1;border-radius:12px;text-align:center;margin:12px 0}
button{width:100%;font:700 18px system-ui;background:#F5B700;color:#0F2340;border:0;border-radius:12px;padding:16px;cursor:pointer}.fout{color:#B42318;font-weight:600}.klein{font-size:14px;color:#5B6B80}</style></head>
<body><div class="logo">Stroom<b>wekker</b></div><main>${inhoud}</main></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function formulier(q, melding = '') {
  const verborgen = ['client_id', 'redirect_uri', 'state', 'response_type', 'scope'].map(k => `<input type="hidden" name="${k}" value="${esc(q.get(k) || '')}">`).join('');
  return pagina(`<h1>Koppel je Stroomwekker</h1><p>Open Stroomwekker op je telefoon. Daar staat een <b>koppelcode</b> van 6 tekens. Typ die hier.</p>
${melding ? `<p class="fout">${esc(melding)}</p>` : ''}<form method="post">${verborgen}<input name="koppelcode" maxlength="6" autocomplete="one-time-code" autocapitalize="characters" required placeholder="ABC123"><button type="submit">Koppelen</button></form>
<p class="klein">Geen code? Open stroomwekker.eu, kies Apparaat toevoegen en daarna Via Alexa.</p>`);
}

async function koppel(req) {
  const u = new URL(req.url);
  if (req.method === 'GET') {
    if (u.searchParams.get('client_id') !== CLIENT_ID || !AMAZON_REDIRECT.test(u.searchParams.get('redirect_uri') || '')) return pagina('<h1>Deze link klopt niet</h1><p>Start het koppelen opnieuw in de Alexa-app.</p>');
    return formulier(u.searchParams);
  }
  const f = new URLSearchParams(await req.text());
  const redirect = f.get('redirect_uri') || '';
  if (f.get('client_id') !== CLIENT_ID || !AMAZON_REDIRECT.test(redirect)) return pagina('<h1>Deze link klopt niet</h1><p>Start het koppelen opnieuw in de Alexa-app.</p>');
  const code = String(f.get('koppelcode') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const s = store();
  let kc = null;
  if (code === DEMO_CODE) { await demoAccount(s); kc = { key: DEMO_KEY, exp: Infinity }; }
  else {
    kc = code.length === 6 ? await s.get('kc/' + code, { type: 'json' }) : null;
    if (!kc || kc.exp < Date.now()) return formulier(f, 'Deze koppelcode klopt niet of is verlopen. Vraag in Stroomwekker een nieuwe aan.');
    await s.delete('kc/' + code);
  }
  const auth = willekeurig(32);
  await s.setJSON('oc/' + await sha(auth), { key: kc.key, redirect, exp: Date.now() + 5 * 60e3 });
  const terug = new URL(redirect); terug.searchParams.set('code', auth); if (f.get('state')) terug.searchParams.set('state', f.get('state'));
  return new Response(null, { status: 302, headers: { Location: terug.href, 'Cache-Control': 'no-store' } });
}

async function token(req) {
  const f = new URLSearchParams(await req.text());
  let id = f.get('client_id'), geheim = f.get('client_secret');
  const basic = (req.headers.get('authorization') || '').match(/^Basic\s+(.+)$/i);
  if (basic) { const [a, b] = atob(basic[1]).split(':'); id = decodeURIComponent(a); geheim = decodeURIComponent(b || ''); }
  const nee = (error, status = 400) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
  if (id !== CLIENT_ID) return nee('invalid_client', 401);
  if (process.env.OAUTH_CLIENT_SECRET && geheim !== process.env.OAUTH_CLIENT_SECRET) return nee('invalid_client', 401);
  const s = store();
  let key;
  if (f.get('grant_type') === 'authorization_code') {
    const k = 'oc/' + await sha(f.get('code') || ''), c = await s.get(k, { type: 'json' });
    await s.delete(k).catch(() => {});
    if (!c || c.exp < Date.now() || (f.get('redirect_uri') && f.get('redirect_uri') !== c.redirect)) return nee('invalid_grant');
    key = c.key;
  } else if (f.get('grant_type') === 'refresh_token') {
    const r = await s.get('or/' + await sha(f.get('refresh_token') || ''), { type: 'json' });
    if (!r) return nee('invalid_grant');
    key = r.key;
  } else return nee('unsupported_grant_type');
  const access = willekeurig(48), refresh = f.get('grant_type') === 'refresh_token' ? f.get('refresh_token') : willekeurig(48);
  await s.setJSON('ot/' + await sha(access), { key, exp: Date.now() + JAAR });
  if (f.get('grant_type') === 'authorization_code') await s.setJSON('or/' + await sha(refresh), { key });
  return Response.json({ access_token: access, token_type: 'bearer', expires_in: JAAR / 1000, refresh_token: refresh }, { headers: { 'Cache-Control': 'no-store' } });
}

export default async (req) => {
  const p = new URL(req.url).pathname.replace(/\/$/, '');
  try {
    if (p === '/api/alexa/koppel') return await koppel(req);
    if (p === '/api/alexa/token' && req.method === 'POST') return await token(req);
    if (p === '/api/alexa' && req.method === 'POST') return await directive(req);
    if (p === '/api/alexa/demo') {
      // Voor de controleurs van Amazon: druk op de knop "Stroomwekker Testlamp aan/uit" van het demo-account
      const u = new URL(req.url), aan = u.searchParams.get('druk') !== 'uit';
      if (u.searchParams.get('code') !== DEMO_CODE) return new Response('Not found', { status: 404 });
      const s = store(), acc = await demoAccount(s);
      try { await druk(acc, acc.devices[0], aan); await s.setJSON(DEMO_KEY, acc); return pagina(`<h1>Gedrukt: Testlamp ${aan ? 'aan' : 'uit'}</h1><p>The doorbell event "Stroomwekker Testlamp ${aan ? 'aan' : 'uit'}" was sent to Alexa.</p>`); }
      catch (e) { return pagina(`<h1>Niet gelukt</h1><p>${esc(e.message)}</p>`); }
    }
  } catch (e) { console.error('alexa', e.message); return Response.json({ error: 'server_error' }, { status: 500 }); }
  return new Response('Not found', { status: 404 });
};

export const config = { path: ['/api/alexa', '/api/alexa/koppel', '/api/alexa/token', '/api/alexa/demo'] };
