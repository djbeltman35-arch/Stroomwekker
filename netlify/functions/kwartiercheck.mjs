// Draait elk kwartier: stuurt meldingen en schakelt apparaten van alle gebruikers.
import webpush from 'web-push';
import { store } from '../lib/store.mjs';
import { refreshPrices } from '../lib/data.mjs';
import { switchDevice, readMeter } from '../lib/devices.mjs';
import { magSchakelen, afdwingen, proefVoor } from '../lib/proef.mjs';
import { stuurMail, mailKlaar } from '../lib/mail.mjs';
import { vasteTijd } from '../lib/vastetijd.mjs';
import { alertsDue, deviceWants, batteryMode, batteryPlan, cheapestBlock, negativeWindows, gasUren, gasPrijs, fmtEuro, price, current, fmtCt, nlTime, nlDayBounds, inRange, quarterStart, Q, DEFAULT_SETTINGS } from '../../public/js/engine.js';

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

// Dagoverzicht voor de ochtendmail: alles wat vandaag telt, in gewone taal.
function stukken(qs, wil) { const out = []; for (const q of qs) { if (!wil(q)) continue; const l = out[out.length - 1]; if (l && l.end === q.t) l.end = q.t + Q; else out.push({ start: q.t, end: q.t + Q }); } return out; }
const tijden = l => l.map(b => `${nlTime(b.start)} tot ${nlTime(b.end)}`).join(', ');
function dagOverzicht(acc, quarters, now, settings) {
  const { start, end } = nlDayBounds(now), qs = inRange(quarters, start, end);
  if (qs.length < 80) return '';
  const r = [], gem = qs.reduce((a, q) => a + q.spot, 0) / qs.length;
  const b3 = cheapestBlock(quarters, start, end, 12), min = qs.reduce((m, q) => q.spot < m.spot ? q : m), max = qs.reduce((m, q) => q.spot > m.spot ? q : m);
  r.push(`STROOM VANDAAG\nGemiddeld ${fmtCt(price(gem, settings))} per kWh.\nGoedkoopste 3 uur: ${nlTime(b3.start)} tot ${nlTime(b3.end)} (${fmtCt(price(b3.avg, settings))}).\nGoedkoopst om ${nlTime(min.t)}, duurst om ${nlTime(max.t)} (${fmtCt(price(max.spot, settings))}).`);
  const apparaten = [];
  for (const d of acc.devices || []) {
    if (d.enabled === false) continue;
    let aan = null; const l = stukken(qs, q => (aan = deviceWants(d, quarters, q.t + 60e3, settings, aan)) === true);
    if (l.length) apparaten.push(`- ${d.name}: aan van ${tijden(l)}`);
  }
  if (apparaten.length) r.push('JE APPARATEN GAAN VANZELF AAN\n' + apparaten.join('\n'));
  const al = acc.alerts || [], heeft = t => al.find(a => a.type === t);
  for (const a of al.filter(a => a.type === 'timer')) {
    const b = cheapestBlock(quarters, Math.max(start, quarterStart(now)), end, Math.max(1, Math.round((a.hours || 2) * 4)));
    if (b) r.push(`TIMER ${String(a.name || 'je apparaat').toUpperCase()}\nZet hem vandaag aan om ${nlTime(b.start)} en uit om ${nlTime(b.end)}.`);
  }
  const warmte = heeft('warmte') || (acc.devices || []).some(d => d.rule?.type === 'warmte');
  if (warmte) {
    const g = gasUren(quarters, start, end, settings), gasQ = g.reduce((n, b) => n + (b.end - b.start) / Q, 0);
    const wp = stukken(qs, q => !g.some(b => q.t >= b.start && q.t < b.end));
    r.push('HYBRIDE WARMTEPOMP\n' + (!g.length ? 'Vandaag is de warmtepomp de hele dag goedkoper dan gas.'
      : !wp.length ? 'Vandaag is stoken op gas de hele dag goedkoper dan de warmtepomp.'
      : gasQ > qs.length / 2 ? `Vandaag is gas meestal goedkoper. De warmtepomp is goedkoper van ${tijden(wp)}.`
      : `De warmtepomp is meestal goedkoper. Stook op gas van ${tijden(g)}.`));
  }
  if (heeft('negative') || (acc.devices || []).some(d => d.rule?.type === 'solar')) { const n = negativeWindows(quarters, start, end, 0); r.push('ZONNEPANELEN\n' + (n.length ? `Terugleveren kost geld van ${tijden(n)}. Zet je panelen dan uit, of gebruik juist veel stroom.` : 'Terugleveren kost vandaag geen geld.')); }
  const bat = heeft('battery');
  if (bat) { const p = batteryPlan(quarters, start, end, bat.hours, settings); if (p) r.push('THUISBATTERIJ\n' + (p.worth ? `Laden van ${nlTime(p.charge.start)} tot ${nlTime(p.charge.end)}, gebruiken van ${nlTime(p.discharge.start)} tot ${nlTime(p.discharge.end)}.` : 'Het prijsverschil is vandaag te klein: laden en gebruiken levert bijna niets op.')); }
  const g = gasPrijs(now, settings);
  if (g != null && (warmte || heeft('gasmorgen'))) r.push(`GAS VANDAAG\n${fmtEuro(g, 2)} per m³ (vanaf 06:00).`);
  return 'Goedemorgen!\n\n' + r.join('\n\n') + '\n\nDit is een hulpmiddel, geen advies. De prijzen zijn inclusief belasting en je opslag.';
}

export default async () => {
  const now = Date.now() + 20e3; // net na de kwartierwissel: tel als het nieuwe kwartier
  const { quarters, gas, temp } = await refreshPrices(now); // ververst meteen de bewaarde prijzen voor bezoekers
  const s = store();
  const vapidOk = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY;
  if (vapidOk) webpush.setVapidDetails('mailto:djbeltman35@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const { blobs } = await s.list({ prefix: 'a/' });
  let sent = 0, switched = 0;
  for (const { key } of blobs) {
    const acc = await s.get(key, { type: 'json' });
    if (!acc) continue;
    const st = acc.state || (acc.state = {});
    const settings = { ...DEFAULT_SETTINGS, ...(acc.settings || {}), gas: gas || {}, temp: temp || {} };
    const msgs = alertsDue(acc.alerts || [], quarters, now, settings, st.alerts || (st.alerts = {}));

    // Vaste timer (LSC): één keer per week kijken of de goedkoopste vaste tijd duidelijk is verschoven
    for (const a of (acc.alerts || []).filter(a => a.type === 'vastetimer')) {
      const sa = (st.alerts[a.id] ||= {});
      if (sa.vastCheck && now - sa.vastCheck < 7 * 86400e3) continue;
      sa.vastCheck = now;
      try {
        const v = await vasteTijd(a.hours || 2, now), oud = sa.aan || a.aan;
        const min = x => { const [h, m] = String(x).split(':').map(Number); return h * 60 + m; };
        const verschil = oud ? Math.abs(min(v.aan) - min(oud)) : 0;
        if (oud && Math.min(verschil, 1440 - verschil) >= 60) {
          msgs.push({ id: 'vast-' + a.id, title: `⏰ Nieuwe tijd voor je timer: ${a.name || 'je apparaat'}`,
            body: `De goedkoopste tijd is verschoven. Zet je timer in de app voortaan aan om ${v.aan} en uit om ${v.uit} (elke dag).` });
        }
        sa.aan = v.aan;
      } catch { sa.vastCheck = now - 6 * 86400e3; } // prijzen niet bereikbaar: morgen opnieuw
    }

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
        await switchDevice(d, want, acc);
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
    // E-mail (bevestigd adres): standaard één dagoverzicht om 7:00. Los daarvan alleen een mail bij storingen
    // (hooguit één per storing per dag) en het maandoverzicht. Alle andere meldingen gaan alleen als pushbericht.
    if (acc.email?.ok && acc.email.berichten !== false && (mailKlaar() || process.env.DEV_MEMORY)) {
      const dag = nlDayBounds(now).day, afmeld = `\n\nOpen Stroomwekker: https://stroomwekker.eu/\nGeen mails meer? Klik hier: https://stroomwekker.eu/api/email?a=${key.slice(2)}&uit=${acc.email.code}`;
      const gemeld = st.mailGemeld?.dag === dag ? st.mailGemeld.ids : [];
      const urgent = msgs.filter(m => /^(fout-|proef-|maand-|vast-)/.test(String(m.id)) && !gemeld.includes(String(m.id)));
      if (urgent.length) {
        try {
          await stuurMail(acc.email.adres, urgent[0].title.replace(/^[^\p{L}\d€]+/u, ''), urgent.map(m => `${m.title}\n${m.body || ''}`).join('\n\n') + afmeld);
          st.mailGemeld = { dag, ids: [...gemeld, ...urgent.map(m => String(m.id))] }; sent++;
        } catch (e) { console.error('mail', e.message); }
      }
      const uurNL = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false }).format(new Date(now))) % 24;
      if (uurNL >= 7 && st.mailDag !== dag && ((acc.alerts || []).some(a => a.type !== 'vastetimer') || (acc.devices || []).length)) {
        st.mailDag = dag;
        const tekst = dagOverzicht(acc, quarters, now, settings);
        if (tekst) { try { await stuurMail(acc.email.adres, 'Je stroomdag: de beste tijden van vandaag', tekst + afmeld); sent++; } catch (e) { console.error('mail', e.message); } }
      }
    }
    await s.setJSON(key, acc);
  }
  console.log(`kwartiercheck: ${blobs.length} accounts, ${sent} meldingen, ${switched} schakelingen`);
};

export const config = { schedule: '*/15 * * * *' };
