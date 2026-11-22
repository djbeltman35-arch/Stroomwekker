import { price, current, quarterStart, nlDayBounds, nlTime, inRange, cheapestBlock, levels, levelOf, alertsDue, negativeWindows, batteryPlan, Q, DEFAULT_SETTINGS } from '/js/engine.js';

const $ = id => document.getElementById(id);
const LS = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Partner-tegels (nooit de naam van de adverteerder tonen) ----------
const aw = (u, ref) => `https://www.awin1.com/cread.php?awinmid=8520&awinaffid=3152283&clickref=stroomwekker-${ref}&ued=${encodeURIComponent(u)}`;
const TILES = [
  ['⚡', 'Dynamisch contract vergelijken', 'Alle tarieven per kwartier', aw('https://www.gaslicht.com/energievergelijken/dynamisch-energiecontract-vergelijken', 'dynamisch')],
  ['🔥', 'Stroom en gas vergelijken', 'Vast, variabel of dynamisch', aw('https://www.gaslicht.com/energievergelijken', 'energie')],
  ['🎁', 'Energie-aanbiedingen', 'Welkomstbonus bij overstappen', aw('https://www.gaslicht.com/energievergelijken/energie-aanbiedingen', 'aanbiedingen')],
  ['🔒', '3 jaar vaste prijs', 'Zekerheid in plaats van dynamisch', aw('https://www.gaslicht.com/energievergelijken/energiecontract-3-jaar-vast', '3jaarvast')],
];
$('tiles').innerHTML = TILES.map(([i, b, s, u]) => `<a href="${u}" target="_blank" rel="sponsored noopener"><span class="i" aria-hidden="true">${i}</span><b>${b}</b><small>${s}</small></a>`).join('');

// ---------- Status ----------
function newToken() { const a = new Uint8Array(24); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); }
let token = LS.get('sw-token', null);
if (!token) { token = newToken(); LS.set('sw-token', token); }
let settings = { ...DEFAULT_SETTINGS, ...LS.get('sw-settings', {}) };
let alerts = LS.get('sw-alerts', []);
let devices = LS.get('sw-devices', []);
let hasPush = LS.get('sw-haspush', false);
let data = null, day = 0, editing = null;

const ct = v => (v * 100).toFixed(1).replace('.', ',');
const eur = (v, d = 3) => '€ ' + v.toFixed(d).replace('.', ',');
const P = spot => price(spot, settings);
const num = id => parseFloat(String($(id).value).replace(',', '.'));

async function api(body) {
  const r = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Er ging iets mis, probeer het later opnieuw');
  return j;
}
let saveT;
function sync(extra = {}) {
  LS.set('sw-settings', settings); LS.set('sw-alerts', alerts); LS.set('sw-devices', devices);
  clearTimeout(saveT);
  return new Promise((res, rej) => {
    saveT = setTimeout(() => api({ action: 'save', settings, alerts, devices, ...extra }).then(j => { applyServer(j); res(j); }).catch(rej), 300);
  });
}
function applyServer(j) {
  if (j.devices) { devices = j.devices; LS.set('sw-devices', devices); }
  if ('hasPush' in j) { hasPush = j.hasPush; LS.set('sw-haspush', hasPush); }
  renderDevices(); renderPushNotice();
}

// ---------- Prijzen ----------
let lastLoad = 0;
async function load() {
  lastLoad = Date.now();
  try {
    const r = await fetch('/api/prices', { cache: 'no-store' });
    if (!r.ok) throw 0;
    data = await r.json();
    LS.set('sw-lastdata', data);
  } catch { data = data || LS.get('sw-lastdata', null); }
  render();
}

function dayName(t, now) { return nlDayBounds(t).day === nlDayBounds(now).day ? 'vandaag' : 'morgen'; }

function render() {
  if (!data) return;
  const now = Date.now(), qs = data.quarters;
  const today = nlDayBounds(now), tom = nlDayBounds(today.end + 60e3);
  const tq = inRange(qs, today.start, today.end), mq = inRange(qs, tom.start, tom.end);
  const cur = current(qs, now), lv = levels(tq);
  $('nowLabel').textContent = settings.mode === 'kaal' ? 'Beursprijs nu (zonder belasting)' : 'Zoveel kost stroom nu';
  if (cur) {
    const p = P(cur.spot), [a, b] = p.toFixed(3).split('.');
    $('nowPrice').innerHTML = `<span class="e">€</span>${a},${b}<span class="u">/kWh</span>`;
    const l = levelOf(cur.spot, lv);
    $('nowLevel').className = 'pill ' + l;
    $('licht').dataset.l = l;
    $('lichtT').textContent = { goedkoop: 'Goedkoop', normaal: 'Gemiddeld', duur: 'Duur' }[l];
    $('lichtS').textContent = `Per kWh, inclusief belasting. Geldt tot ${nlTime(cur.t + Q)}.`;
    $('lichtP').innerHTML = `${ct(p)}<small>ct/kWh</small>`;
    $('strip').innerHTML = tq.map(q => `<i class="${{ goedkoop: 'g', normaal: 'n', duur: 'd' }[levelOf(q.spot, lv)]}${q.t === cur.t ? ' nu' : ''}" style="height:${Math.max(6, Math.round((P(q.spot) - Math.min(...tq.map(x => P(x.spot)))) / ((Math.max(...tq.map(x => P(x.spot))) - Math.min(...tq.map(x => P(x.spot)))) || 1) * 100))}%"></i>`).join('');
    $('nowLevel').textContent = { goedkoop: 'Goedkoop: goed moment', normaal: 'Gewone prijs', duur: 'Duur: liever wachten' }[l];
    $('nowUntil').textContent = `Deze prijs geldt tot ${nlTime(cur.t + Q)}`;
    $('updated').textContent = `Prijzen bijgewerkt om ${nlTime(data.updated)}`;
    document.title = `${ct(p)} ct – Stroomprijs nu | Stroomwekker`;
    const nx = current(qs, cur.t + Q);
    $('nextP').textContent = nx ? ct(P(nx.spot)) + ' cent' : '–';
    $('nextT').textContent = nx ? (nx.spot < cur.spot ? '▼ goedkoper' : nx.spot > cur.spot ? '▲ duurder' : 'hetzelfde') : '';
  } else {
    $('nowUntil').textContent = 'Geen prijs voor dit kwartier gevonden';
  }
  $('avgP').textContent = tq.length ? ct(P(tq.reduce((s, q) => s + q.spot, 0) / tq.length)) + ' cent' : '–';
  const g = data.gas?.[today.day];
  $('gasP').textContent = g != null ? eur(g, 2) : '–';

  const from = quarterStart(now), to = mq.length ? tom.end : today.end;
  const rest = inRange(qs, from, to);
  const cells = [];
  if (rest.length) {
    const min = rest.reduce((m, q) => q.spot < m.spot ? q : m);
    cells.push(['Goedkoopste moment', nlTime(min.t), `${ct(P(min.spot))} cent · ${dayName(min.t, now)}`]);
    for (const h of [1, 3]) {
      const bl = cheapestBlock(qs, from, to, h * 4);
      if (bl) cells.push([`Beste ${h} uur achter elkaar`, `${nlTime(bl.start)}–${nlTime(bl.end)}`, `${ct(P(bl.avg))} cent · ${dayName(bl.start, now)}`]);
    }
    const max = rest.reduce((m, q) => q.spot > m.spot ? q : m);
    cells.push(['Duurste moment (beter niet)', nlTime(max.t), `${ct(P(max.spot))} cent · ${dayName(max.t, now)}`]);
  }
  $('best').innerHTML = cells.map(([k, t, p]) => `<div class="b"><div class="k">${k}</div><div class="t">${t}</div><div class="p">${p}</div></div>`).join('')
    + (mq.length ? '' : '<p class="small muted" style="grid-column:1/-1;margin:0">De prijzen van morgen zie je na 13:00 uur.</p>');

  // Zonnepanelen
  const wsT = negativeWindows(qs, from, today.end), wsM = negativeWindows(qs, tom.start, tom.end);
  const curNeg = cur && cur.spot < 0;
  const wtxt = ws => ws.map(w => `${nlTime(w.start)}–${nlTime(w.end)}`).join(', ');
  $('zonStatus').innerHTML = (curNeg
      ? `<p class="notice" style="background:var(--deal-soft);border-color:var(--deal);margin:0"><b>Terugleveren kost nu geld.</b> Zet je panelen uit, of gebruik nu veel stroom.</p>`
      : `<p class="notice" style="background:var(--green-soft);border-color:var(--green);margin:0"><b>Alles goed.</b> Je zonnepanelen mogen aan blijven.</p>`)
    + `<p class="small" style="margin:8px 0 0"><b>Panelen uit vandaag:</b> ${wsT.length ? wtxt(wsT) : 'niet nodig'}<br><b>Panelen uit morgen:</b> ${mq.length ? (wsM.length ? wtxt(wsM) : 'niet nodig') : 'dit weet je na 13:00 uur'}</p>`;

  // Thuisbatterij
  const bh = +$('batHours').value;
  const planTxt = (pl, label) => !pl ? '' : `<div class="b"><div class="k">${label}</div>`
    + `<p style="margin:4px 0"><b>Laden:</b> ${nlTime(pl.charge.start)}–${nlTime(pl.charge.end)} <span class="muted">(${ct(pl.buy)} cent)</span><br>`
    + `<b>Batterij gebruiken:</b> ${nlTime(pl.discharge.start)}–${nlTime(pl.discharge.end)} <span class="muted">(${ct(pl.sell)} cent)</span></p>`
    + (pl.worth ? `<span class="pill goedkoop">✓ Loont: ongeveer ${ct(pl.gain)} cent winst per kWh</span>` : `<span class="pill normaal">Loont niet: het verschil is te klein</span><p class="small muted" style="margin:6px 0 0">Laden en weer gebruiken kost ongeveer 15% stroom. Daarvoor is het verschil nu te klein. Laat de batterij dan rusten.</p>`) + '</div>';
  $('batPlan').innerHTML = '<div class="best">' + planTxt(batteryPlan(qs, today.start, today.end, bh, settings), 'Vandaag')
    + (mq.length ? planTxt(batteryPlan(qs, tom.start, tom.end, bh, settings), 'Morgen') : '<div class="b"><div class="k">Morgen</div><p class="small muted" style="margin:4px 0">Dit zie je na 13:00 uur.</p></div>') + '</div>';

  $('tabTomorrow').textContent = mq.length ? 'Morgen' : 'Morgen (na 13:00)';
  const showQ = day === 1 ? mq : tq;
  $('chartNote').hidden = !(day === 1 && !mq.length);
  $('chartNote').textContent = 'De prijzen van morgen zie je na 13:00 uur.';
  chart(showQ, levels(showQ), cur);
  $('qtable').innerHTML = showQ.map(q => `<tr><td>${nlTime(q.t)}–${nlTime(q.t + Q)}</td><td>${ct(P(q.spot))} ct</td></tr>`).join('');
  tick();
}

let wissel = 0;
function tick() {
  const now = Date.now(), qs = quarterStart(now), left = qs + Q - now;
  const m = Math.floor(left / 60000), s = Math.floor(left % 60000 / 1000);
  $('countdown').textContent = `${m}:${String(s).padStart(2, '0')}`;
  $('prog').style.width = ((now - qs) / Q * 100).toFixed(1) + '%';
  if (data && left < 1100 && wissel !== qs) { wissel = qs; setTimeout(() => { render(); localAlerts(); }, 1300); }
}
setInterval(tick, 1000);
// Alleen nieuwe prijzen halen als het nodig is: elke 15 min, en na 13:00 elke 5 min tot morgen er is.
function needsLoad() {
  if (!data) return true;
  const age = Date.now() - lastLoad, h = +nlTime(Date.now()).slice(0, 2);
  const tom = nlDayBounds(nlDayBounds(Date.now()).end + 60e3);
  const hasTom = inRange(data.quarters, tom.start, tom.end).length >= 92;
  return age > 15 * 60e3 || (h >= 13 && !hasTom && age > 5 * 60e3);
}
setInterval(() => { if (!document.hidden && needsLoad()) load(); }, 60e3);
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 200); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); if (needsLoad()) load(); } });

// ---------- Grafiek ----------
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p; return 10 * p; }
function chart(qs, lv, cur) {
  const box = $('chartbox');
  box.querySelector('svg')?.remove();
  if (!qs.length) return;
  const W = Math.max(320, Math.round(box.clientWidth || 960)), H = W < 600 ? 200 : 250, L = 30, R = 4, T = 16, B = 34;
  const vals = qs.map(q => P(q.spot));
  let max = Math.max(...vals); const min = Math.min(0, ...vals);
  max += ((max - min) || 0.01) * 0.08;
  const y = v => T + (max - v) / (max - min) * (H - T - B);
  const bw = (W - L - R) / qs.length;
  const step = niceStep((max - min) * 100 / 4) / 100;
  let g = '';
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step)
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v * 100)}</text>`;
  g += `<text x="2" y="11">cent</text>`;
  let bars = '';
  qs.forEach((q, i) => {
    const v = vals[i], l = levelOf(q.spot, lv);
    const col = l === 'goedkoop' ? 'var(--green)' : l === 'duur' ? 'var(--deal)' : 'var(--mid)';
    const gap = bw < 6 ? 1 : 2, x = L + i * bw + gap / 2, w = Math.max(1, bw - gap);
    const y0 = y(0), y1 = y(v), top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0));
    const isNow = cur && q.t === cur.t;
    bars += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${col}"${isNow ? ' stroke="var(--ink)" stroke-width="2"' : ''}/>`;
    if (isNow) bars += `<text x="${x + w / 2}" y="${H - B + 14}" text-anchor="middle" style="fill:var(--ink);font-weight:700">▲</text>`;
    if (i % (W < 600 ? 24 : 12) === 0) bars += `<text x="${x}" y="${H - 4}">${nlTime(q.t)}</text>`;
  });
  if (min < 0) g += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)"/>`;
  box.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Staafgrafiek van de stroomprijs per kwartier">${g}${bars}<rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/></svg>`);
  const svg = box.querySelector('svg'), tip = $('tip');
  const show = e => {
    const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(qs.length - 1, Math.floor((sx - L) / bw)));
    tip.hidden = false;
    tip.textContent = `${nlTime(qs[i].t)}–${nlTime(qs[i].t + Q)} · ${ct(vals[i])} cent`;
    tip.style.left = Math.max(80, Math.min(r.width - 80, (L + (i + .5) * bw) / W * r.width)) + 'px';
    tip.style.top = (y(Math.max(vals[i], 0)) / H * r.height) + 'px';
  };
  svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  day = +b.dataset.day; document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b)); render();
}));

// ---------- Meldingen ----------
const alertText = a => a.type === 'below' ? `Stroom goedkoper dan ${ct(a.value)} cent` : a.type === 'above' ? `Stroom duurder dan ${ct(a.value)} cent`
  : a.type === 'cheapest' ? `De goedkoopste ${a.hours} uur beginnen` : a.type === 'negative' ? 'Zonnepanelen beter uit' : a.type === 'battery' ? 'Thuisbatterij laden of gebruiken' : 'De prijzen van morgen zijn er';
function renderAlerts() {
  if (typeof renderMijn === 'function') setTimeout(renderMijn);
  $('alertList').innerHTML = alerts.map(a => `<li class="item"><div class="txt"><b>${alertText(a)}</b></div><button class="x" data-del="${a.id}" aria-label="Verwijderen">×</button></li>`).join('');
}
$('alertList').addEventListener('click', e => { const id = e.target.dataset.del; if (!id) return; alerts = alerts.filter(a => a.id !== id); renderAlerts(); sync().catch(() => {}); });
$('aType').addEventListener('change', () => { const t = $('aType').value; $('aValWrap').hidden = !(t === 'below' || t === 'above'); $('aHrsWrap').hidden = !(t === 'cheapest' || t === 'battery'); });
$('alertForm').addEventListener('submit', async e => {
  e.preventDefault();
  alerts.push({ id: crypto.randomUUID(), type: $('aType').value, value: (num('aVal') || 0) / 100, hours: +$('aHrs').value });
  renderAlerts();
  await enablePush();
  sync().catch(() => {});
});

function renderPushNotice() {
  const n = $('pushNotice');
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const ios = /iPhone|iPad/.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches;
  if (hasPush && perm === 'granted') { n.innerHTML = 'Berichten staan aan op dit apparaat.'; return; }
  if (ios) { n.innerHTML = 'Heb je een iPhone? Zet Stroomwekker dan eerst op je beginscherm. Tik onderin op <b>Deel</b> en kies <b>Zet op beginscherm</b>. Open de app daarna via je beginscherm.'; return; }
  if (perm === 'denied') { n.innerHTML = 'Berichten staan uit in je browser. Tik op het slotje naast het webadres en zet berichten aan.'; return; }
  if (perm === 'unsupported') { n.textContent = 'Deze browser kan geen berichten sturen. Probeer Chrome of Safari.'; return; }
  n.innerHTML = '<button class="btn btn-sm" id="pushBtn" type="button">Berichten aanzetten</button> <span class="small">Kies daarna hieronder wanneer.</span>';
  $('pushBtn').onclick = () => enablePush().then(() => sync().catch(() => {}));
}
function b64u(s) { const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); }
async function enablePush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (Notification.permission === 'default' && await Notification.requestPermission() !== 'granted') return renderPushNotice();
  if (Notification.permission !== 'granted') return renderPushNotice();
  try {
    const reg = await navigator.serviceWorker.ready;
    const { key } = await (await fetch('/api/vapid')).json();
    if (!key || !reg.pushManager) return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) });
    await api({ action: 'save', push: sub.toJSON() });
    hasPush = true; LS.set('sw-haspush', true);
  } catch (e) { console.warn('push', e); }
  renderPushNotice();
}
// Reserve: meldingen vanuit de open pagina als push (nog) niet werkt.
async function localAlerts() {
  if (hasPush || !data || !('Notification' in window) || Notification.permission !== 'granted') return;
  const st = LS.get('sw-alertstate', {});
  const msgs = alertsDue(alerts, data.quarters, Date.now() + 5e3, settings, st);
  LS.set('sw-alertstate', st);
  const reg = await navigator.serviceWorker?.ready;
  for (const m of msgs) reg ? reg.showNotification(m.title, { body: m.body, icon: '/icons/icon-192.png', tag: m.id }) : new Notification(m.title, { body: m.body });
}
setInterval(localAlerts, 60e3);

// ---------- Apparaten ----------
const ruleText = r => r.type === 'cheap' ? 'Aan als stroom goedkoop is' : r.type === 'battery' ? `Thuisbatterij: laden als het goedkoop is (${r.hours} uur)` : r.type === 'solar' ? 'Uit als terugleveren geld kost' : r.type === 'cheapest' ? `Aan in de goedkoopste ${r.hours} uur van de dag${r.block ? ' (achter elkaar)' : ''}` : `Aan onder ${ct(r.on)} cent, uit boven ${ct(r.off ?? r.on)} cent`;
function renderDevices() {
  if (typeof renderMijn === 'function') setTimeout(renderMijn);
  $('devList').innerHTML = devices.map(d => {
    const s = d.status;
    const st = d.enabled === false ? '<span class="status muted">Staat op pauze</span>'
      : s ? (s.ok ? `<span class="status ok">● ${s.on ? 'Aan' : 'Uit'} sinds ${nlTime(s.at)}</span>` : `<span class="status err">⚠ ${esc(s.msg || 'Het lukte niet')}</span>`)
      : '<span class="status muted">Begint bij het volgende kwartier</span>';
    return `<li class="item"><div class="txt"><b>${esc(d.name)}</b><span>${ruleText(d.rule)} · ${{ shelly: 'Shelly', tuya: 'Action / Smart Life' }[d.kind] || 'eigen link'}</span><br>${st}</div>
      <button class="btn-line btn-sm" data-edit="${d.id}">Wijzig</button><button class="x" data-deldev="${d.id}" aria-label="Verwijderen">×</button></li>`;
  }).join('');
}
$('devList').addEventListener('click', e => {
  const del = e.target.dataset.deldev, ed = e.target.dataset.edit;
  if (del) { devices = devices.filter(d => d.id !== del); renderDevices(); sync().catch(() => {}); }
  if (ed) openDev(devices.find(d => d.id === ed));
});
const kindUI = () => { const k = $('dKind').value; $('kShelly').hidden = k !== 'shelly'; $('kHook').hidden = k !== 'webhook'; $('kTuya').hidden = k !== 'tuya'; };
const ruleUI = () => {
  const r = $('dRule').value, k = $('dKind').value, bat = r === 'battery', hook = k === 'webhook';
  $('rBelow').hidden = r !== 'below'; $('rCheap').hidden = r !== 'cheapest'; $('rSolar').hidden = r !== 'solar'; $('rBat').hidden = !bat;
  $('supplyWrap').hidden = !(bat && hook); $('dTestSupply').hidden = !(bat && hook); $('batPlugHint').hidden = hook;
  $('lOn').textContent = bat && hook ? 'Link om te LADEN' : 'Link om AAN te zetten';
  $('lOff').textContent = bat && hook ? 'Link om te STOPPEN' : 'Link om UIT te zetten';
  $('dTestOn').textContent = bat && hook ? 'Test: laden' : 'Test: aan'; $('dTestOff').textContent = bat && hook ? 'Test: stoppen' : 'Test: uit';
};
$('dKind').onchange = () => { kindUI(); ruleUI(); }; $('dRule').onchange = ruleUI;
function openDev(d) {
  editing = d ? d.id : null;
  $('devForm').hidden = false; $('devAdd').hidden = true; $('dMsg').textContent = '';
  $('dName').value = d?.name || ''; $('dKind').value = d?.kind || 'tuya';
  $('dTId').value = d?.accessId || ''; $('dTSecret').value = d?.accessSecret || ''; $('dTDev').value = d?.kind === 'tuya' ? d.deviceId : ''; $('dTReg').value = d?.region || 'eu'; $('dTCode').value = d?.code || 'switch_1';
  $('dHost').value = d?.host || ''; $('dKey').value = d?.key || ''; $('dDev').value = d?.kind === 'shelly' ? d.deviceId : ''; $('dCh').value = d?.channel || 0;
  $('dOn').value = d?.onUrl || ''; $('dOff').value = d?.offUrl || ''; $('dMethod').value = d?.method || 'POST';
  const r = d?.rule || { type: 'below', on: 0.20, off: 0.22 };
  $('dRule').value = r.type; $('dOnP').value = r.on != null ? (r.on * 100).toFixed(1) : 20; $('dOffP').value = r.off != null ? (r.off * 100).toFixed(1) : 22;
  $('dLimit').value = ((r.limit || 0) * 100).toFixed(1);
  $('dBatHrs').value = String(r.type === 'battery' ? r.hours : 3); $('dSupply').value = d?.supplyUrl || '';
  $('dHrs').value = String(r.hours || 3); $('dBlock').checked = !!r.block; $('dNotify').checked = d?.notify !== false;
  kindUI(); ruleUI(); $('dName').focus();
}
$('devAdd').onclick = () => openDev(null);

$('zonDevice').onclick = () => {
  openDev(null); $('dName').value = 'Zonnepanelen'; $('dKind').value = 'webhook'; $('dRule').value = 'solar'; kindUI(); ruleUI();
  $('apparaten').scrollIntoView({ behavior: 'smooth' });
};
$('batHours').value = String(LS.get('sw-bathours', 3));
$('batHours').onchange = () => { LS.set('sw-bathours', +$('batHours').value); render(); };
$('batDevice').onclick = () => {
  openDev(null); $('dName').value = 'Thuisbatterij'; $('dRule').value = 'battery'; $('dBatHrs').value = $('batHours').value; kindUI(); ruleUI();
  $('apparaten').scrollIntoView({ behavior: 'smooth' });
};
$('batAlert').onclick = async () => {
  alerts = alerts.filter(a => a.type !== 'battery');
  alerts.push({ id: crypto.randomUUID(), type: 'battery', value: 0, hours: +$('batHours').value });
  renderAlerts(); await enablePush(); sync().catch(() => {});
  $('batAlert').textContent = 'Bericht staat aan';
};
$('zonAlert').onclick = async () => {
  if (!alerts.some(a => a.type === 'negative')) alerts.push({ id: crypto.randomUUID(), type: 'negative', value: 0, hours: 1 });
  renderAlerts(); await enablePush(); sync().catch(() => {});
  $('zonAlert').textContent = 'Bericht staat aan';
};
$('dCancel').onclick = () => { $('devForm').hidden = true; $('devAdd').hidden = false; };
function formDevice() {
  const rt = $('dRule').value;
  return { id: editing || crypto.randomUUID(), name: $('dName').value.trim(), kind: $('dKind').value, notify: $('dNotify').checked,
    host: $('dHost').value.trim(), key: $('dKey').value.trim(), channel: +$('dCh').value,
    deviceId: $('dKind').value === 'tuya' ? $('dTDev').value.trim() : $('dDev').value.trim(),
    accessId: $('dTId').value.trim(), accessSecret: $('dTSecret').value.trim(), region: $('dTReg').value, code: $('dTCode').value,
    onUrl: $('dOn').value.trim(), offUrl: $('dOff').value.trim(), method: $('dMethod').value,
    supplyUrl: $('dSupply').value.trim(),
    rule: rt === 'battery' ? { type: 'battery', hours: +$('dBatHrs').value } : rt === 'solar' ? { type: 'solar', limit: (num('dLimit') || 0) / 100 } : rt === 'cheapest' ? { type: 'cheapest', hours: +$('dHrs').value, block: $('dBlock').checked } : { type: 'below', on: num('dOnP') / 100, off: num('dOffP') / 100 } };
}
const say = (t, ok) => { $('dMsg').textContent = t; $('dMsg').className = 'msg ' + (ok ? 'ok' : 'err'); };
async function test(on) {
  say('Bezig…', true);
  try { await api({ action: 'test', device: formDevice(), on }); say(on === 'supply' ? '✓ Verstuurd. Levert je batterij nu stroom?' : on ? '✓ Verstuurd. Gaat je apparaat nu aan?' : '✓ Verstuurd. Gaat je apparaat nu uit?', true); }
  catch (e) { say(e.message); }
}
$('dTestOn').onclick = () => test(true); $('dTestOff').onclick = () => test(false); $('dTestSupply').onclick = () => test('supply');
$('devForm').addEventListener('submit', async e => {
  e.preventDefault();
  const d = formDevice(), prev = devices;
  devices = editing ? devices.map(x => x.id === editing ? d : x) : [...devices, d];
  say('Even geduld…', true);
  try { await sync(); $('devForm').hidden = true; $('devAdd').hidden = false; enablePush(); }
  catch (err) { devices = prev; LS.set('sw-devices', prev); say(err.message); }
});

// ---------- Instellingen ----------
$('sMode').value = settings.mode; $('sOpslag').value = (settings.opslag * 100).toFixed(2);
$('sOpslagWrap').hidden = settings.mode === 'kaal';
$('sMode').onchange = () => { settings.mode = $('sMode').value; $('sOpslagWrap').hidden = settings.mode === 'kaal'; render(); sync().catch(() => {}); };
$('sOpslag').oninput = () => { const v = num('sOpslag'); if (Number.isFinite(v)) { settings.opslag = v / 100; render(); sync().catch(() => {}); } };
$('myCode').value = token;
$('useCode').onclick = async () => {
  const c = $('otherCode').value.trim();
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(c)) { $('otherCode').value = ''; $('otherCode').placeholder = 'Deze code klopt niet'; return; }
  const old = token; token = c;
  try {
    const j = await api({ action: 'get' });
    LS.set('sw-token', c);
    settings = { ...settings, ...(j.settings || {}) }; alerts = j.alerts || [];
    LS.set('sw-alerts', alerts); LS.set('sw-settings', settings); applyServer(j); renderAlerts(); render(); await enablePush();
    $('otherCode').value = ''; $('otherCode').placeholder = '✓ Gekoppeld';
  } catch (e) { token = old; $('otherCode').value = ''; $('otherCode').placeholder = e.message; }
  $('myCode').value = token;
};

// ---------- Installeren ----------
let bip = null;
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); bip = e; maybeInstall(); });
function maybeInstall() {
  if (standalone || Date.now() < LS.get('sw-installno', 0)) return;
  if (bip || isIOS) { $('install').hidden = false; $('iosHint').hidden = !isIOS || !!bip; $('installGo').hidden = isIOS && !bip; }
}
$('installGo').onclick = async () => { if (bip) { bip.prompt(); await bip.userChoice; bip = null; } $('install').hidden = true; };
$('installNo').onclick = () => { $('install').hidden = true; LS.set('sw-installno', Date.now() + 5 * 86400e3); };
$('installLink').onclick = e => {
  e.preventDefault(); LS.set('sw-installno', 0);
  if (bip) bip.prompt(); else { $('install').hidden = false; $('iosHint').hidden = false; $('installGo').hidden = true; }
};
setTimeout(maybeInstall, 1500);

// ---------- Start ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
renderAlerts(); renderDevices(); renderPushNotice();
data = LS.get('sw-lastdata', null); render();
load();
api({ action: 'get' }).then(j => { if (j.devices?.length || j.alerts?.length || j.hasPush) applyServer(j); }).catch(() => {});


// ---- Lijniconen (geen emoji: zakelijke stijl) ----
const IC = {
  plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5"/>',
  battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 11v2M7 10v4M11 10v4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  drop: '<path d="M12 2.7 6.3 9.2a7.5 7.5 0 1 0 11.4 0z"/>',
  wash: '<rect x="3" y="2" width="18" height="20" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M7 6h.01M10 6h4"/>',
  car: '<path d="M5 17h14M3 17v-4l2-5h14l2 5v4M7 17v2M17 17v2"/><circle cx="7.5" cy="13.5" r="1"/><circle cx="16.5" cy="13.5" r="1"/>',
  dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 18h4M12 18h8M4 12h16"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="18" r="2"/>',
  shop: '<path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  home: '<path d="M3 10 12 3l9 7v11H3z"/>',
  off: '<path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0"/>',
};
const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k] || IC.dots}</svg>`;
document.querySelectorAll('[data-ic]').forEach(e => e.innerHTML = svg(e.dataset.ic));
const EMO = { '🔌': 'plug', '🔋': 'battery', '☀️': 'sun', '🔔': 'bell', '🚿': 'drop', '👕': 'wash', '🚗': 'car', '⚙️': 'sliders', '🛒': 'shop', '📱': 'phone', '🔵': 'chip', '❓': 'help', '✅': 'check', '⏱️': 'clock', '👍': 'check', '🏠': 'home', '🟢': 'clock', '📅': 'calendar' };
const ico = e => svg(EMO[e] || 'dots');

// ================= Stappenplan (één vraag per scherm) =================
const W = { stack: [], d: {} };
const wiz = $('wiz');
const PRESETS = {
  boiler: { name: 'Boiler', icon: '🚿', rule: { type: 'cheapest', hours: 4, block: false }, uitleg: 'in de 4 goedkoopste uren van de dag' },
  was: { name: 'Wasmachine', icon: '👕', rule: { type: 'cheapest', hours: 2, block: true }, uitleg: 'in de goedkoopste 2 uur achter elkaar' },
  auto: { name: 'Auto laden', icon: '🚗', rule: { type: 'cheapest', hours: 6, block: false }, uitleg: 'in de 6 goedkoopste uren van de dag' },
  anders: { name: 'Apparaat', icon: '🔌', rule: { type: 'cheap' }, uitleg: 'als stroom goedkoop is' },
};
function wizOpen(first) { W.stack = []; W.d = {}; wiz.hidden = false; document.body.style.overflow = 'hidden'; go(first); }
function wizClose() { wiz.hidden = true; document.body.style.overflow = ''; }
function go(fn) { W.stack.push(fn); show(); }
function back() { if (W.stack.length > 1) { W.stack.pop(); show(); } else wizClose(); }
function show() {
  const fn = W.stack[W.stack.length - 1];
  const v = fn();
  $('wizT').textContent = v.t;
  $('wizB').innerHTML = (v.p ? `<p>${v.p}</p>` : '') + (v.html || '') + (v.opts ? '<div class="opts">' + v.opts.map((o, i) =>
    `<button class="opt" type="button" data-i="${i}"><span>${ico(o.i)}</span><div><b>${o.l}</b>${o.s ? `<small>${o.s}</small>` : ''}</div></button>`).join('') + '</div>' : '');
  if (v.opts) $('wizB').querySelectorAll('.opt').forEach(b => b.onclick = () => v.opts[+b.dataset.i].go());
  const total = v.of || 4, step = Math.min(W.stack.length, total);
  $('wizDots').innerHTML = Array.from({ length: total }, (_, i) => `<i class="${i < step ? 'on' : ''}"></i>`).join('');
  $('wizBack').textContent = W.stack.length > 1 ? '← Terug' : '← Sluiten';
  v.after && v.after();
  wiz.scrollTop = 0;
}
$('wizBack').onclick = back; $('wizClose').onclick = wizClose;
addEventListener('keydown', e => { if (e.key === 'Escape' && !wiz.hidden) wizClose(); });

// ---- Apparaat ----
const sApparaat = () => ({ t: 'Wat wil je vanzelf laten aangaan?', p: 'Kies wat het meest lijkt. Wij kiezen dan de beste tijden.', opts: [
  ...Object.entries(PRESETS).map(([k, v]) => ({ i: v.icon, l: { boiler: 'Boiler', was: 'Wasmachine, droger of vaatwasser', auto: 'Elektrische auto', anders: 'Iets anders' }[k], s: 'Aan ' + v.uitleg, go: () => { W.d.preset = k; go(sStekker); } })),
  { i: '⚙️', l: 'Zelf instellen', s: 'Voor wie alles zelf wil kiezen', go: () => { wizClose(); openMeer(); openDev(null); $('apparaten').scrollIntoView({ behavior: 'smooth' }); } },
] });
const sStekker = () => ({ t: 'Welke slimme stekker heb je?', opts: [
  { i: '🛒', l: 'Van de Action (LSC)', go: () => { W.d.kind = 'tuya'; W.d.lsc = true; go(sTuya); } },
  { i: '📱', l: 'Smart Life of Tuya', s: 'Ook Hema, Calex, Nedis, Woox', go: () => { W.d.kind = 'tuya'; go(sTuya); } },
  { i: '🔵', l: 'Shelly', go: () => { W.d.kind = 'shelly'; go(sShelly); } },
  { i: '❓', l: 'Ik heb nog geen slimme stekker', go: () => go(sGeenStekker) },
] });
const sGeenStekker = () => ({ t: 'Je hebt een slimme stekker nodig', of: 4,
  p: 'Een slimme stekker zet je tussen het stopcontact en je apparaat. Wij kunnen hem dan aan en uit zetten. De goedkoopste koop je bij de Action, voor een paar euro. Zoek naar <b>LSC Smart Connect slimme stekker</b>.',
  html: '<p class="small muted">Let op: een slimme stekker kan meestal maximaal 3.680 watt aan. Voor een laadpaal of grote boiler heb je soms iets anders nodig.</p>',
  opts: [{ i: '🔔', l: 'Stuur me intussen een bericht als stroom goedkoop is', go: () => go(sBerichtKies) }, { i: '🏠', l: 'Terug naar het begin', go: wizClose }] });

function fieldsHTML(f) { return '<div class="form">' + f.map(([id, label, hint, ph]) => `<label>${label}<input id="${id}" autocomplete="off" spellcheck="false" ${ph ? `placeholder="${ph}"` : ''}>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`).join('') + '</div>'; }
const testRow = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn-line" type="button" id="wTest">🔌 Test: zet aan</button><button class="btn" type="button" id="wNext">Klaar, verder →</button></div><p class="msg" id="wMsg" role="status"></p>';
function wDevice() {
  const p = PRESETS[W.d.preset || 'anders'];
  const v = id => ($(id) ? $(id).value.trim() : '');
  const d = { id: W.d.id || (W.d.id = crypto.randomUUID()), name: W.d.name || p.name, kind: W.d.kind, notify: true, rule: W.d.rule || p.rule };
  if (W.d.kind === 'tuya') Object.assign(d, { accessId: v('wA'), accessSecret: v('wS'), deviceId: v('wD'), region: 'eu', code: 'switch_1' });
  if (W.d.kind === 'shelly') Object.assign(d, { host: v('wH'), key: v('wK'), deviceId: v('wD'), channel: 0 });
  return d;
}
function wireTest() {
  const msg = (t, ok) => { $('wMsg').textContent = t; $('wMsg').className = 'msg ' + (ok ? 'ok' : 'err'); };
  $('wTest').onclick = async () => { msg('Even geduld…', true); try { await api({ action: 'test', device: wDevice(), on: true }); msg('✓ Gelukt! Gaat je apparaat aan? Dan werkt het.', true); W.d.tested = true; } catch (e) { msg(e.message); } };
  $('wNext').onclick = async () => {
    if (!W.d.tested && !W.d.warned) { W.d.warned = true; msg('Tik eerst op "Test: zet aan" om te zien of het werkt. Wil je het toch bewaren? Tik dan nog een keer op "Klaar, verder".'); return; }
    msg('Bewaren…', true);
    const d = wDevice(), prev = devices;
    devices = [...devices.filter(x => x.id !== d.id), d];
    try { await sync(); go(sKlaarApparaat); } catch (e) { devices = prev; LS.set('sw-devices', prev); msg(e.message); }
  };
}
const sTuya = () => ({ t: W.d.lsc ? 'Koppel je stekker van de Action' : 'Koppel je Smart Life-stekker', of: 4,
  html: `<ol>${W.d.lsc ? '<li><b>Zet de stekker in de app Smart Life.</b> Met de app van de Action lukt het niet. Haal de stekker weg uit de LSC-app, download de gratis app <b>Smart Life</b> en voeg de stekker daar toe.</li>' : ''}
    <li>Ga op je computer naar <b>platform.tuya.com</b> en maak een gratis account.</li>
    <li>Klik op <b>Cloud</b> → <b>Development</b> → <b>Create Cloud Project</b>. Kies Data Center: <b>Central Europe</b>.</li>
    <li>Klik op <b>Devices</b> → <b>Link App Account</b>. Scan de QR-code met Smart Life (tab <b>Ik</b>, knopje rechtsboven).</li>
    <li>Neem hieronder over: de <b>Access ID</b> en <b>Access Secret</b> (bij Overview) en het <b>Device ID</b> (bij Devices).</li></ol>`
    + fieldsHTML([['wA', 'Access ID'], ['wS', 'Access Secret'], ['wD', 'Device ID']]) + testRow,
  after: wireTest });
const sShelly = () => ({ t: 'Koppel je Shelly', of: 4,
  html: `<ol><li>Open de <b>Shelly-app</b>. Ga naar <b>Instellingen</b> → <b>Gebruikersinstellingen</b> → <b>Cloud-sleutel</b>.</li><li>Neem de <b>servernaam</b> en de <b>sleutel</b> over.</li><li>Tik in de app op je stekker → <b>Instellingen</b> → <b>Apparaatinformatie</b> en neem het <b>Device ID</b> over.</li></ol>`
    + fieldsHTML([['wH', 'Servernaam', '', 'shelly-49-eu.shelly.cloud'], ['wK', 'Cloud-sleutel'], ['wD', 'Device ID']]) + testRow,
  after: wireTest });
const sKlaarApparaat = () => {
  const p = PRESETS[W.d.preset || 'anders'];
  return { t: 'Klaar! 🎉', of: 4, html: `<div class="bigok">${svg("check")}</div><p>Je ${W.d.rule?.type === 'battery' ? 'batterij laadt' : p.name.toLowerCase() + ' gaat'} vanaf nu vanzelf aan <b>${W.d.rule?.type === 'battery' ? 'als stroom het goedkoopst is' : p.uitleg}</b>. Je hoeft niets meer te doen.</p>`,
    opts: [{ i: '🔔', l: 'Stuur mij een bericht als hij aan of uit gaat', go: async () => { await enablePush(); sync().catch(() => {}); wizClose(); } },
      { i: '✅', l: 'Nee, klaar', go: wizClose }] };
};

// ---- Thuisbatterij ----
const sBatterij = () => ({ t: 'Heeft je batterij een eigen app?', p: 'Kijk in die app of er een stand is zoals <b>"dynamisch tarief"</b> of <b>"slim laden"</b>.', opts: [
  { i: '👍', l: 'Ja, die stand heeft hij', s: 'Dan is dat het makkelijkst', go: () => go(sBatEigen) },
  { i: '🔌', l: 'Nee, ik laad hem met een stekker', s: 'Wij zetten de stekker aan als laden goedkoop is', go: () => go(sBatUren) },
  { i: '❓', l: 'Weet ik niet', go: () => go(sBatUren) },
] });
const sBatEigen = () => ({ t: 'Zet die stand aan', of: 3, html: '<div class="bigok">'+svg('battery')+'</div><p>Zet in de app van je batterij de stand <b>dynamisch tarief</b> of <b>slim laden</b> aan. Dan laadt je batterij vanzelf als stroom goedkoop is. Je hoeft verder niets te doen.</p>',
  opts: [{ i: '🔔', l: 'Stuur mij ook een bericht met de beste tijden', go: async () => { addAlert({ type: 'battery', hours: 3 }); await enablePush(); go(sKlaarBericht); } }, { i: '✅', l: 'Klaar', go: wizClose }] });
const sBatUren = () => ({ t: 'Hoe lang duurt het om je batterij vol te laden?', p: 'Weet je het niet? Kies dan 3 uur.', opts: [1, 2, 3, 4, 6].map(h => ({ i: '⏱️', l: h + (h === 1 ? ' uur' : ' uur'), go: () => {
  W.d.preset = 'anders'; W.d.rule = { type: 'battery', hours: h }; W.d.name = 'Thuisbatterij'; go(sBatHoe); } })) });
const sBatHoe = () => ({ t: 'Hoe wil je het regelen?', opts: [
  { i: '🔌', l: 'Wij zetten de stekker van de lader aan en uit', s: 'Je hebt een slimme stekker nodig', go: () => go(sStekker) },
  { i: '🔔', l: 'Stuur mij alleen een bericht', s: 'Dan zet je hem zelf aan', go: async () => { addAlert({ type: 'battery', hours: W.d.rule.hours }); await enablePush(); go(sKlaarBericht); } },
] });

// ---- Zonnepanelen ----
const sZon = () => ({ t: 'Zonnepanelen', p: 'Soms moet je betalen om stroom terug te leveren. Dat gebeurt op hele zonnige dagen. Zet je panelen dan even uit.', opts: [
  { i: '🔔', l: 'Stuur mij een bericht als ze uit moeten', s: 'Ook de dag ervoor al', go: async () => { addAlert({ type: 'negative', value: 0 }); await enablePush(); go(sKlaarBericht); } },
  { i: '⚙️', l: 'Vanzelf uitzetten', s: 'Alleen via een installateur, Homey of Home Assistant', go: () => { wizClose(); openMeer(); $('zonDevice').click(); } },
] });

// ---- Berichten ----
const BERICHT = [
  ['cheapest', '🟢', 'Als stroom het goedkoopst is', { hours: 2 }],
  ['tomorrow', '📅', 'Als de prijzen van morgen er zijn', {}],
  ['negative', '☀️', 'Als ik mijn zonnepanelen uit moet zetten', { value: 0 }],
  ['battery', '🔋', 'Als ik mijn batterij moet laden', { hours: 3 }],
];
const sBerichtKies = () => ({ t: 'Wanneer wil je een bericht?', p: 'Tik aan wat je wilt. Je kunt er meer kiezen.',
  html: '<div class="opts">' + BERICHT.map(([k, i, l]) => `<button class="opt${alerts.some(a => a.type === k) ? ' sel' : ''}" type="button" data-k="${k}"><span>${ico(i)}</span><div><b>${l}</b></div></button>`).join('') + '</div>'
    + '<button class="btn big" type="button" id="wBer" style="margin-top:16px">Berichten aanzetten</button>',
  after: () => {
    $('wizB').querySelectorAll('[data-k]').forEach(b => b.onclick = () => b.classList.toggle('sel'));
    $('wBer').onclick = async () => {
      const kies = [...$('wizB').querySelectorAll('.sel')].map(b => b.dataset.k);
      alerts = alerts.filter(a => !BERICHT.some(([k]) => k === a.type) || kies.includes(a.type));
      for (const k of kies) if (!alerts.some(a => a.type === k)) addAlert({ type: k, ...BERICHT.find(x => x[0] === k)[3] }, true);
      renderAlerts(); await enablePush(); sync().catch(() => {}); go(sKlaarBericht);
    };
  } });
const sKlaarBericht = () => {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const ios = /iPhone|iPad/.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches;
  const html = ios ? '<p><b>Nog één ding:</b> op een iPhone moet je Stroomwekker eerst op je beginscherm zetten. Tik onderin op <b>Deel</b> en kies <b>Zet op beginscherm</b>. Open de app daarna via je beginscherm en zet berichten aan.</p>'
    : perm === 'granted' ? '<div class="bigok">'+svg('bell')+'</div><p>Je krijgt vanaf nu een bericht op dit apparaat. Ook als de site dicht is.</p>'
    : '<p>Je browser staat berichten nog niet toe. Tik op het slotje naast het webadres en zet <b>Meldingen</b> aan. Probeer het daarna opnieuw.</p>';
  return { t: perm === 'granted' && !ios ? 'Klaar' : 'Bijna klaar', of: 3, html, opts: [{ i: '✅', l: 'Sluiten', go: wizClose }] };
};
function addAlert(a, quiet) {
  if (!alerts.some(x => x.type === a.type)) alerts.push({ id: crypto.randomUUID(), value: 0, hours: 1, ...a });
  if (!quiet) { renderAlerts(); sync().catch(() => {}); }
}

const FLOWS = { apparaat: sApparaat, batterij: sBatterij, zon: sZon, bericht: sBerichtKies };
document.querySelectorAll('[data-flow]').forEach(b => b.onclick = () => wizOpen(FLOWS[b.dataset.flow]));
function openMeer() { $('meer').open = true; }
$('navStart').onclick = e => { e.preventDefault(); scrollTo({ top: 0, behavior: 'smooth' }); };
$('navMeer').onclick = e => { e.preventDefault(); openMeer(); $('meer').scrollIntoView({ behavior: 'smooth' }); };
$('licht').onclick = e => { e.preventDefault(); openMeer(); $('prijs').scrollIntoView({ behavior: 'smooth' }); };
$('mijnMeer').onclick = () => scrollTo({ top: 0, behavior: 'smooth' });

// ---- "Wat staat er aan" ----
function renderMijn() {
  const items = [
    ...devices.map(d => `<li class="item"><div class="txt"><b>${esc(d.name)}</b><span>${ruleText(d.rule)}</span><br>${d.status ? (d.status.ok ? `<span class="status ok">● Nu ${d.status.on === 'supply' ? 'aan het leveren' : d.status.on ? 'aan' : 'uit'}</span>` : `<span class="status err">⚠ ${esc(d.status.msg || 'Het lukte niet')}</span>`) : '<span class="status muted">Begint bij het volgende kwartier</span>'}</div><button class="x" data-mdev="${d.id}" aria-label="Weghalen">×</button></li>`),
    ...alerts.map(a => `<li class="item"><div class="txt"><b>Bericht: ${alertText(a)}</b></div><button class="x" data-malert="${a.id}" aria-label="Weghalen">×</button></li>`),
  ];
  $('mijn').hidden = !items.length;
  $('mijnList').innerHTML = items.join('');
}
$('mijnList').addEventListener('click', e => {
  const d = e.target.dataset.mdev, a = e.target.dataset.malert;
  if (d) devices = devices.filter(x => x.id !== d);
  if (a) alerts = alerts.filter(x => x.id !== a);
  if (d || a) { renderDevices(); renderAlerts(); sync().catch(() => {}); }
});
renderMijn();
