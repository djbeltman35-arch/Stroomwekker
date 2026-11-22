// Draait automatisch bij elk (niet-spam) bericht via het contactformulier.
// Stuurt het bericht door naar info@stroomwekker.eu via de mailserver van Hostnet.
// Nodig in Netlify (Environment variables): SMTP_PASS = wachtwoord van info@stroomwekker.eu
import nodemailer from 'nodemailer';

const NAAR = 'info@stroomwekker.eu';

export default async (req) => {
  const { payload } = await req.json();
  if (!payload || payload.form_name !== 'contact') return new Response('ok');
  const d = payload.data || {};
  if (!process.env.SMTP_PASS) { console.error('SMTP_PASS ontbreekt: bericht staat wel in Netlify Forms'); return new Response('ok'); }

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostnet.nl', port: Number(process.env.SMTP_PORT || 587), secure: false, requireTLS: true,
    auth: { user: process.env.SMTP_USER || NAAR, pass: process.env.SMTP_PASS },
  });
  const regels = [
    ['Onderwerp', d.onderwerp], ['Naam', d.naam], ['E-mail', d.email], ['Slimme stekker', d.merk],
  ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
  try {
    await transport.sendMail({
      from: `"Stroomwekker contactformulier" <${process.env.SMTP_USER || NAAR}>`,
      to: NAAR,
      replyTo: d.email ? `"${String(d.naam || '').replace(/["<>]/g, '')}" <${d.email}>` : undefined,
      subject: `Contact: ${d.onderwerp || 'Nieuw bericht'} (${d.naam || 'onbekend'})`,
      text: `${regels}\n\nBericht:\n${d.bericht || ''}\n\n—\nVerstuurd via stroomwekker.eu/contact. Klik op Beantwoorden om direct terug te mailen.`,
    });
  } catch (e) { console.error('mail mislukt', e.message); }
  return new Response('ok');
};
