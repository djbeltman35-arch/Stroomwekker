// E-mail versturen via de mailserver van Hostnet (zelfde account als het contactformulier).
// Nodig in Netlify: SMTP_PASS (wachtwoord van info@stroomwekker.eu).
import nodemailer from 'nodemailer';

const VAN = process.env.SMTP_USER || 'info@stroomwekker.eu';
let transport = null;
export const mailKlaar = () => !!process.env.SMTP_PASS;
export async function stuurMail(naar, onderwerp, tekst) {
  if (process.env.DEV_MEMORY) { console.log('[mail]', naar, onderwerp, '\n' + tekst); return; }
  if (!mailKlaar()) throw new Error('Mail is nog niet ingesteld');
  transport ||= nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostnet.nl', port: Number(process.env.SMTP_PORT || 587), secure: false, requireTLS: true,
    auth: { user: VAN, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({ from: `"Stroomwekker" <${VAN}>`, to: naar, subject: onderwerp, text: tekst });
}
export const geldigMail = e => typeof e === 'string' && e.length <= 120 && /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(e.trim());
export async function hashMail(e) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sw-mail:' + e.trim().toLowerCase()));
  return 'e/' + [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const willekeurig = (n = 24) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); };
