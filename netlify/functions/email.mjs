// Links uit e-mails: adres bevestigen of afmelden voor berichten per e-mail.
import { store } from '../lib/store.mjs';
import { hashMail } from '../lib/mail.mjs';

const pagina = (titel, tekst) => new Response(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${titel} | Stroomwekker</title>
<style>body{font-family:system-ui,sans-serif;background:#0F2340;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px}main{max-width:440px}h1{color:#F5B700}a{color:#fff;font-weight:700}</style></head>
<body><main><h1>${titel}</h1><p>${tekst}</p><p><a href="/">Naar Stroomwekker</a></p></main></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

export default async (req) => {
  const u = new URL(req.url), a = u.searchParams.get('a') || '', c = u.searchParams.get('c') || '', uit = u.searchParams.get('uit') || '';
  if (!/^[a-f0-9]{64}$/.test(a)) return pagina('Link klopt niet', 'Deze link is niet compleet. Kopieer de hele link uit de mail.');
  const s = store(), key = 'a/' + a, acc = await s.get(key, { type: 'json' });
  if (!acc?.email) return pagina('Link klopt niet', 'We vinden dit e-mailadres niet meer.');
  if (uit && uit === acc.email.code) {
    acc.email.berichten = false; await s.setJSON(key, acc);
    return pagina('Afgemeld', 'Je krijgt geen berichten meer per e-mail. Je kunt dit altijd weer aanzetten bij Instellingen.');
  }
  if (c && c === acc.email.code) {
    acc.email.ok = true; await s.setJSON(key, acc);
    const ek = await hashMail(acc.email.adres), idx = await s.get(ek, { type: 'json' });
    if (idx) await s.setJSON(ek, { ...idx, ok: true });
    return pagina('E-mailadres bevestigd', 'Gelukt! Je kunt nu berichten per e-mail krijgen en op een ander apparaat inloggen met een inloglink.');
  }
  return pagina('Link verlopen', 'Deze link werkt niet meer. Vul je e-mailadres opnieuw in bij Instellingen.');
};

export const config = { path: '/api/email' };
