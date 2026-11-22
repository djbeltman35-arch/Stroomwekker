// Proefperiode per stekker: 3 maanden gratis, gekoppeld aan het vaste nummer van de stekker (niet aan e-mail of browser).
// We bewaren alleen een hash van het stekkernummer, zodat niemand kan zien welke stekker het is.
export const PROEF_MAANDEN = 3;
// Pas afdwingen als er een betaalmogelijkheid is: zet PROEF_AFDWINGEN=1 in Netlify.
export const afdwingen = () => process.env.PROEF_AFDWINGEN === '1';

async function sha(txt) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const stekkerSleutel = async d => (d.kind === 'shelly' || d.kind === 'tuya') && d.deviceId
  ? 'p/' + await sha(d.kind + ':' + String(d.deviceId).toLowerCase()) : null;

export function eindVan(start) {
  const e = new Date(start); e.setMonth(e.getMonth() + PROEF_MAANDEN); return e.getTime();
}

// Zoekt of zet de startdatum van de proef per stekker. Geeft per apparaat { start, eind, eerder } terug.
export async function proefVoor(s, devices, now = Date.now(), fallbackStart = now) {
  const uit = {};
  for (const d of devices || []) {
    const k = await stekkerSleutel(d);
    if (!k) { uit[d.id] = { start: fallbackStart, eind: eindVan(fallbackStart), eerder: false }; continue; }
    let r = await s.get(k, { type: 'json' }).catch(() => null);
    const eerder = !!r && now - r.start > 60 * 60e3; // al eerder (niet net nu) gekoppeld
    if (!r) { r = { start: now }; await s.setJSON(k, r); }
    uit[d.id] = { start: r.start, eind: eindVan(r.start), eerder };
  }
  return uit;
}

// Mag dit apparaat schakelen? Betaald, of proef nog niet voorbij, of afdwingen staat uit.
export function magSchakelen(acc, p, now = Date.now()) {
  if (!afdwingen()) return true;
  if (acc.betaaldTot && acc.betaaldTot > now) return true;
  return !!p && p.eind > now;
}
