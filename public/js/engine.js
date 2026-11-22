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
