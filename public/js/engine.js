// Stroomwekker rekenkern: gedeeld door de browser en de server (Netlify functions).
// Prijzen komen binnen als kale beursprijs (spot) in euro per kWh, excl. btw, per kwartier.

export const BTW = 0.21;
export const EB_STROOM = 0.11085; // energiebelasting 2026 per kWh, incl. btw
export const Q = 15 * 60 * 1000;  // één kwartier in ms

export const DEFAULT_SETTINGS = {
  mode: 'allin',   // 'allin' = wat je ongeveer betaalt, 'kaal' = beursprijs excl. btw
  opslag: 0.02,    // inkoopvergoeding leverancier per kWh, incl. btw
};

export function price(spot, s = DEFAULT_SETTINGS) {
  if (s.mode === 'kaal') return spot;
  return spot * (1 + BTW) + Number(s.opslag || 0) + EB_STROOM;
}

export function quarterStart(t) { return Math.floor(t / Q) * Q; }

// Begin en eind van de Nederlandse kalenderdag waarin t valt (zomer-/wintertijd veilig).
export function nlDayBounds(t) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });
  const day = fmt.format(new Date(t)); // YYYY-MM-DD
  // Zoek de eerste ms van die dag: begin bij UTC-middernacht -3u en loop in kwartieren.
  let s = Date.parse(day + 'T00:00:00Z') - 3 * 3600e3;
  while (fmt.format(new Date(s)) !== day) s += Q;
  let e = s + 20 * 3600e3;
  while (fmt.format(new Date(e)) === day) e += Q;
  return { start: s, end: e, day };
}

export function nlTime(t) {
  return new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' }).format(new Date(t));
}

export function current(quarters, t) {
  const qs = quarterStart(t);
  return quarters.find(q => q.t === qs) || null;
}

export function inRange(quarters, from, to) {
  return quarters.filter(q => q.t >= from && q.t < to);
}

// Goedkoopste aaneengesloten blok van n kwartieren binnen [from, to).
export function cheapestBlock(quarters, from, to, n) {
  const qs = inRange(quarters, from, to);
  if (qs.length < n) return null;
  let best = null, sum = 0;
  for (let i = 0; i < qs.length; i++) {
    sum += qs[i].spot;
    if (i >= n) sum -= qs[i - n].spot;
    if (i >= n - 1) {
      // alleen echt aaneengesloten blokken
      if (qs[i].t - qs[i - n + 1].t !== (n - 1) * Q) continue;
      const avg = sum / n;
      if (!best || avg < best.avg) best = { start: qs[i - n + 1].t, end: qs[i].t + Q, avg };
    }
  }
  return best;
}

// De n goedkoopste losse kwartieren binnen [from, to) als set van starttijden.
export function cheapestSet(quarters, from, to, n) {
  const qs = inRange(quarters, from, to).slice().sort((a, b) => a.spot - b.spot || a.t - b.t);
  return new Set(qs.slice(0, n).map(q => q.t));
}

// Indeling goedkoop / normaal / duur ten opzichte van de rest van de dag.
export function levels(dayQuarters) {
  const v = dayQuarters.map(q => q.spot).sort((a, b) => a - b);
  if (!v.length) return { lo: 0, hi: 0 };
  const at = p => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { lo: at(1 / 3), hi: at(2 / 3) };
}
export function levelOf(spot, lv) {
  if (spot <= lv.lo) return 'goedkoop';
  if (spot >= lv.hi) return 'duur';
  return 'normaal';
}

export function fmtEuro(v, digits = 3) {
  return '€ ' + v.toFixed(digits).replace('.', ',');
}
export function fmtCt(v) {
  return (v * 100).toFixed(1).replace('.', ',') + ' cent';
}

// Periodes waarin de kale beursprijs onder 'limit' ligt (standaard 0 = negatief): terugleveren kost dan geld.
export function negativeWindows(quarters, from, to, limit = 0) {
  const out = [];
  for (const q of inRange(quarters, from, to)) {
    if (q.spot >= limit) continue;
    const last = out[out.length - 1];
    if (last && last.end === q.t) { last.end = q.t + Q; last.min = Math.min(last.min, q.spot); }
    else out.push({ start: q.t, end: q.t + Q, min: q.spot });
  }
  return out;
}

// ---------- Thuisbatterij ----------
// Rendement heen en terug (laden + ontladen). Onder dit verschil loont het niet.
export const BAT_EFF = 0.85;

// Duurste aaneengesloten blok van n kwartieren binnen [from, to).
export function priciestBlock(quarters, from, to, n) {
  const neg = quarters.map(q => ({ t: q.t, spot: -q.spot }));
  const b = cheapestBlock(neg, from, to, n);
  return b ? { ...b, avg: -b.avg } : null;
}

// Dagplan: eerst laden (goedkoopste blok), daarna leveren (duurste blok erna).
// We proberen beide volgordes van zoeken en nemen het plan met de meeste winst.
export function batteryPlan(quarters, from, to, hours, s = DEFAULT_SETTINGS) {
  const n = Math.max(1, Math.min(48, Math.round(Number(hours || 3) * 4)));
  const opts = [];
  const c1 = cheapestBlock(quarters, from, to, n);
  if (c1) { const d1 = priciestBlock(quarters, c1.end, to, n); if (d1) opts.push({ charge: c1, discharge: d1 }); }
  const d2 = priciestBlock(quarters, from, to, n);
  if (d2) { const c2 = cheapestBlock(quarters, from, d2.start, n); if (c2) opts.push({ charge: c2, discharge: d2 }); }
  if (!opts.length) return null;
  for (const o of opts) {
    o.buy = price(o.charge.avg, s); o.sell = price(o.discharge.avg, s);
    o.gain = o.sell * BAT_EFF - o.buy; // winst per kWh die je laadt
  }
  const best = opts.sort((a, b) => b.gain - a.gain)[0];
  best.worth = best.gain > 0.01;
  return best;
}

// 'charge' | 'discharge' | 'idle' voor het huidige kwartier (plan per kalenderdag).
export function batteryMode(hours, quarters, t, s) {
  const cur = current(quarters, t);
  if (!cur) return null;
  const { start, end } = nlDayBounds(t);
  const p = batteryPlan(quarters, start, end, hours, s);
  if (!p || !p.worth) return 'idle';
  if (cur.t >= p.charge.start && cur.t < p.charge.end) return 'charge';
  if (cur.t >= p.discharge.start && cur.t < p.discharge.end) return 'discharge';
  return 'idle';
}

// ---------- Apparaten ----------
// device.rule: { type: 'below', on: 0.25, off: 0.28 }  (prijzen in euro per kWh, in de modus van de gebruiker)
//              { type: 'cheapest', hours: 3, block: false }
// Geeft true (aan), false (uit) of null (geen prijsdata: niets doen).
export function deviceWants(device, quarters, t, s, lastOn) {
  const r = device.rule || {};
  const cur = current(quarters, t);
  if (!cur) return null;
  if (r.type === 'cheapest') {
    const { start, end } = nlDayBounds(t);
    const n = Math.max(1, Math.min(96, Math.round(Number(r.hours || 1) * 4)));
    if (r.block) {
      const b = cheapestBlock(quarters, start, end, n);
      return !!b && cur.t >= b.start && cur.t < b.end;
    }
    return cheapestSet(quarters, start, end, n).has(cur.t);
  }
  if (r.type === 'cheap') {
    // Simpelste stand: aan zolang het kwartier bij het goedkoopste derde van de dag hoort
    const { start, end } = nlDayBounds(t);
    return levelOf(cur.spot, levels(inRange(quarters, start, end))) === 'goedkoop';
  }
  if (r.type === 'battery') {
    // Slimme stekker voor de lader: AAN tijdens het laden, anders UIT.
    const m = batteryMode(r.hours, quarters, t, s);
    return m === null ? null : m === 'charge';
  }
  if (r.type === 'solar') {
    // Zonnepanelen/omvormer: UIT zolang de beursprijs onder de grens ligt, anders AAN.
    const limit = Number.isFinite(Number(r.limit)) ? Number(r.limit) : 0;
    return !(cur.spot < limit);
  }
  // 'below' met hysterese: aan onder 'on', pas weer uit boven 'off'
  const p = price(cur.spot, s);
  const on = Number(r.on), off = Number.isFinite(Number(r.off)) && r.off !== '' ? Number(r.off) : on;
  if (p <= on) return true;
  if (p > off) return false;
  return lastOn === true; // tussen de grenzen: stand houden
}

// ---------- Meldingen ----------
// alert: { id, type: 'below'|'above'|'cheapest'|'tomorrow'|'negative', value, hours }
// state: per alert een klein geheugen om dubbele meldingen te voorkomen.
export function alertsDue(alerts, quarters, t, s, state = {}) {
  const out = [];
  const cur = current(quarters, t);
  const { start, end, day } = nlDayBounds(t);
  for (const a of alerts || []) {
    const st = state[a.id] || {};
    if (a.type === 'below' || a.type === 'above') {
      if (!cur) continue;
      const p = price(cur.spot, s);
      const hit = a.type === 'below' ? p <= a.value : p >= a.value;
      if (hit && !st.active) {
        out.push({ id: a.id, title: a.type === 'below' ? '⚡ Stroom is nu goedkoop' : '⚠️ Stroom is nu duur',
          body: a.type === 'below' ? `Nu ${fmtCt(p)}. Goed moment om de wasmachine of auto aan te zetten.` : `Nu ${fmtCt(p)}. Wacht liever even met grote apparaten.` });
      }
      state[a.id] = { ...st, active: hit };
    } else if (a.type === 'cheapest') {
      if (!cur) continue;
      const n = Math.max(1, Math.round(Number(a.hours || 1) * 4));
      const b = cheapestBlock(quarters, start, end, n);
      if (b && cur.t === b.start && st.day !== day) {
        out.push({ id: a.id, title: '🟢 Nu is stroom het goedkoopst',
          body: `Van ${nlTime(b.start)} tot ${nlTime(b.end)} is stroom het goedkoopst van vandaag (${fmtCt(price(b.avg, s))}).` });
        state[a.id] = { ...st, day };
      }
    } else if (a.type === 'negative') {
      if (!cur) continue;
      const limit = Number(a.value) || 0;
      const neg = cur.spot < limit;
      if (neg && !st.active) {
        const w = negativeWindows(quarters, cur.t, cur.t + 24 * 3600e3, limit)[0];
        out.push({ id: a.id, title: '☀️ Zet je zonnepanelen uit',
          body: `Terugleveren kost nu geld${w ? `, tot ${nlTime(w.end)}` : ''}. Stroom gebruiken levert juist geld op.` });
      } else if (!neg && st.active) {
        out.push({ id: a.id, title: '☀️ Zonnepanelen mogen weer aan', body: 'Terugleveren kost geen geld meer.' });
      }
      // Vooraankondiging zodra de prijzen van morgen bekend zijn
      const tm = nlDayBounds(end + 60e3), ws = negativeWindows(quarters, tm.start, tm.end, limit);
      if (ws.length && inRange(quarters, tm.start, tm.end).length >= 92 && st.warned !== tm.day) {
        out.push({ id: a.id + '-m', title: '☀️ Morgen zonnepanelen even uit',
          body: 'Morgen kost terugleveren geld van ' + ws.map(w => `${nlTime(w.start)} tot ${nlTime(w.end)}`).join(' en ') + '. Zet je panelen dan uit, of gebruik juist veel stroom.' });
        state[a.id] = { ...(state[a.id] || st), warned: tm.day };
      }
      state[a.id] = { ...(state[a.id] || st), active: neg };
    } else if (a.type === 'battery') {
      const m = batteryMode(a.hours, quarters, t, s);
      if (m === null) continue;
      if (m !== st.mode && m !== 'idle') {
        const p = batteryPlan(quarters, start, end, a.hours, s);
        out.push(m === 'charge'
          ? { id: a.id, title: '🔋 Laad nu je thuisbatterij', body: `Stroom is nu goedkoop. Laad tot ${nlTime(p.charge.end)}.` }
          : { id: a.id, title: '🔋 Gebruik nu je thuisbatterij', body: `Stroom is nu duur. Gebruik je batterij tot ${nlTime(p.discharge.end)}.` });
      }
      state[a.id] = { ...st, mode: m };
    } else if (a.type === 'timer') {
      // Voor stekkers die wij niet zelf kunnen schakelen (zoals de LSC-app): elke dag de tijden voor de timer
      const tm = nlDayBounds(end + 60e3);
      if (inRange(quarters, tm.start, tm.end).length >= 92 && st.day !== tm.day) {
        const b = cheapestBlock(quarters, tm.start, tm.end, Math.max(1, Math.round(Number(a.hours || 2) * 4)));
        if (b) out.push({ id: a.id, title: `⏰ Timer voor morgen: ${a.name || 'je apparaat'}`,
          body: `Zet hem aan om ${nlTime(b.start)} en uit om ${nlTime(b.end)}. Dan is stroom het goedkoopst (${fmtCt(price(b.avg, s))}).` });
        state[a.id] = { ...st, day: tm.day };
      }
    } else if (a.type === 'tomorrow') {
      const tm = nlDayBounds(end + 60e3);
      const qs = inRange(quarters, tm.start, tm.end);
      if (qs.length >= 92 && st.day !== tm.day) {
        const min = qs.reduce((m, q) => q.spot < m.spot ? q : m), max = qs.reduce((m, q) => q.spot > m.spot ? q : m);
        out.push({ id: a.id, title: '📅 De prijzen van morgen zijn er',
          body: `Het goedkoopst om ${nlTime(min.t)} (${fmtCt(price(min.spot, s))}). Het duurst om ${nlTime(max.t)} (${fmtCt(price(max.spot, s))}).` });
        state[a.id] = { ...st, day: tm.day };
      }
    }
  }
  return out;
}
