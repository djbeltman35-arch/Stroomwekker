import { TOP3, PEIL, topLink } from '/js/top3.js';
import { gasPrijs, warmte, gasUren, COP, price, current, quarterStart, nlDayBounds, nlTime, inRange, cheapestBlock, levels, levelOf, alertsDue, negativeWindows, batteryPlan, Q, DEFAULT_SETTINGS } from '/js/engine.js';

const $ = id => document.getElementById(id);
const LS = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Partner-tegels (nooit de naam van de adverteerder tonen) ----------
const aw = (u, ref) => `https://www.awin1.com/cread.php?awinmid=8520&awinaffid=3152283&clickref=stroomwekker-${ref}&ued=${encodeURIComponent(u)}`;
const BOLSTEKKER = 'https://partner.bol.com/click/click?p=1&t=url&s=1558346&url=' + encodeURIComponent('https://www.bol.com/nl/nl/s/?searchtext=slimme+stekker+met+energiemeter') + '&f=TXL&name=stroomwekker-stekker';
const TILES = [
  ['⚡', 'Dynamisch contract vergelijken', 'Alle tarieven per kwartier', aw('https://www.gaslicht.com/energievergelijken/dynamisch-energiecontract-vergelijken', 'dynamisch')],
  ['🔥', 'Stroom en gas vergelijken', 'Vast, variabel of dynamisch', aw('https://www.gaslicht.com/energievergelijken', 'energie')],
  ['🎁', 'Energie-aanbiedingen', 'Welkomstbonus bij overstappen', aw('https://www.gaslicht.com/energievergelijken/energie-aanbiedingen', 'aanbiedingen')],
  ['🔒', '3 jaar vaste prijs', 'Zekerheid in plaats van dynamisch', aw('https://www.gaslicht.com/energievergelijken/energiecontract-3-jaar-vast', '3jaarvast')],
];
$('vergelijkOpslag').href = aw('https://www.gaslicht.com/energievergelijken/dynamisch-energiecontract-vergelijken', 'toeslag');
// ---------- Top 3 goedkoopste contracten voor stroom en gas samen (gegevens in top3.js) ----------
const GL = pad => topLink(pad);
function toonTop3(k) {
  const t = TOP3[k];
  $('top3tabs').querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', b.dataset.k === k));
  $('top3').innerHTML = t.r.map(([lev, pak, pm, pad], i) => `<li><a href="${GL(pad)}" target="_blank" rel="sponsored noopener"><span class="nr">${i + 1}</span><span><b>${lev}</b><small>${pak}</small></span><span class="pr">€ ${pm}<small> p/m</small></span></a></li>`).join('');
  $('top3uitleg').textContent = `${t.uitleg}. Bedragen per maand voor stroom en gas samen, bij 2.300 kWh en 1.000 m³ per jaar, inclusief welkomstkorting. Tarieven van ${PEIL}; wat jij betaalt hangt af van je adres en verbruik. Dit is geen advies: controleer de tarieven en voorwaarden bij het energiebedrijf voordat je overstapt.`;
}
if ($('top3tabs')) {
  $('top3tabs').innerHTML = Object.entries(TOP3).map(([k, t]) => `<button type="button" role="tab" data-k="${k}">${t.l}</button>`).join('');
  $('top3tabs').querySelectorAll('button').forEach(b => b.onclick = () => toonTop3(b.dataset.k));
  toonTop3('dynamisch');
}
$('tiles').innerHTML = TILES.map(([i, b, s, u]) => `<a href="${u}" target="_blank" rel="sponsored noopener"><span class="i" aria-hidden="true">${i}</span><b>${b}</b><small>${s}</small></a>`).join('');

// ---------- Status ----------
function newToken() { const a = new Uint8Array(24); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); }
let token = LS.get('sw-token', null);
if (!token) { token = newToken(); LS.set('sw-token', token); }
let settings = { ...DEFAULT_SETTINGS, ...LS.get('sw-settings', {}) };
let alerts = LS.get('sw-alerts', []);
let devices = LS.get('sw-devices', []);
let accInfo = { betaaldTot: null, proefAfdwingen: false };
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
  if ('betaaldTot' in j) accInfo = { betaaldTot: j.betaaldTot, proefAfdwingen: j.proefAfdwingen };
  if ('hasPush' in j) { hasPush = j.hasPush; LS.set('sw-haspush', hasPush); }
  if ('email' in j) { mailInfo = j.email; typeof renderMail === 'function' && setTimeout(renderMail); }
  renderDevices(); renderPushNotice();
}

// ---------- Prijzen ----------
let lastLoad = 0;
async function load() {
  lastLoad = Date.now();
  try {
    const r = await fetch('/api/prices', { cache: 'no-store' });
    if (!r.ok) throw 0;
    data = await r.json(); globalThis.__swGas = data.gas; globalThis.__swTemp = data.temp;
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
  const g = gasPrijs(now, settings);
  $('gasP').textContent = g != null ? eur(g, 2) : '–';
  renderWarmte(now);

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

// ---------- Verwarmen: gas of stroom (hybride warmtepomp) ----------
function renderWarmte(now) {
  const el = $('warmteNu'); if (!el) return;
  const cur = current(data.quarters, now), w = cur && warmte(cur, settings);
  if (!w) { el.hidden = true; return; }
  const { start, end } = nlDayBounds(now), gasStuk = gasUren(data.quarters, Math.max(start, quarterStart(now)), end, settings);
  el.hidden = false;
  el.innerHTML = `<b>${w.beter === 'stroom' ? '♨️ Hybride warmtepomp: stook nu met stroom' : '🔥 Hybride warmtepomp: stook nu op gas'}</b><small>Stroom is goedkoper zolang hij onder ${ct(w.grens)} cent blijft.${gasStuk.length ? ' Vandaag is gas goedkoper ' + gasStuk.map(b => `van ${nlTime(b.start)} tot ${nlTime(b.end)}`).join(', ') + '.' : ' Vandaag blijft stroom de rest van de dag goedkoper.'} <a href="/gasprijs-vandaag/">Hoe rekenen we dit?</a></small>`;
}

// ---------- Meldingen ----------
const alertText = a => a.type === 'below' ? `Stroom goedkoper dan ${ct(a.value)} cent` : a.type === 'above' ? `Stroom duurder dan ${ct(a.value)} cent`
  : a.type === 'cheapest' ? `De goedkoopste ${a.hours} uur beginnen` : a.type === 'negative' ? 'Zonnepanelen beter uit' : a.type === 'battery' ? 'Thuisbatterij laden of gebruiken' : a.type === 'timer' ? `Timer-tijden voor ${esc(a.name || 'je apparaat')}` : a.type === 'warmte' ? 'Stoken op gas of stroom (hybride warmtepomp)' : a.type === 'gasmorgen' ? 'Gas morgen veel goedkoper of duurder' : 'De prijzen van morgen zijn er';
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
const ruleText = r => r.type === 'warmte' ? 'Hybride warmtepomp: aan als stroom goedkoper verwarmt dan gas' : r.type === 'cheap' ? 'Aan als stroom goedkoop is' : r.type === 'battery' ? `Thuisbatterij: laden als het goedkoop is (${r.hours} uur)` : r.type === 'solar' ? 'Uit als terugleveren geld kost' : r.type === 'cheapest' ? `Aan in de goedkoopste ${r.hours} uur van de dag${r.block ? ' (achter elkaar)' : ''}` : `Aan onder ${ct(r.on)} cent, uit boven ${ct(r.off ?? r.on)} cent`;
// Verbruik: alleen bij stekkers met een energiemeter. Aan- en uitzetten werkt met elke stekker.
const kwhTxt = v => v.toFixed(v < 10 ? 2 : 1).replace('.', ',') + ' kWh';
function verbruikHTML(d) {
  const v = d.verbruik;
  if (!v) return '';
  if (v.meet === false) return `<div class="verbr nee">Verbruik zien: ${v.reden === 'link' ? 'kan niet met een eigen link' : 'deze stekker meet geen verbruik'}. Aan en uit zetten werkt wel gewoon. <a href="#welkemeet" data-welke>Welke stekkers meten wel?</a>${v.reden === 'stekker' ? ` · <a href="${BOLSTEKKER}" target="_blank" rel="sponsored noopener">Stekker met energiemeter bekijken</a> <small>(advertentie)</small>` : ''}</div>`;
  if (v.meet == null) return `<div class="verbr">Verbruik: we kijken bij het volgende kwartier of deze stekker het verbruik meet.</div>`;
  const bespaard = v.maand.ref - v.maand.cost;
  return `<div class="verbr ja"><div><span>Nu</span><b>${v.w != null ? Math.round(v.w).toLocaleString('nl-NL') + ' W' : '–'}</b></div>`
    + `<div><span>Vandaag</span><b>${kwhTxt(v.vandaag.kwh)}</b><span>${eur(v.vandaag.cost, 2)}</span></div>`
    + `<div><span>Deze maand</span><b>${kwhTxt(v.maand.kwh)}</b><span>${eur(v.maand.cost, 2)}</span></div>`
    + (v.maand.kwh > 0.05 ? `<p class="besp">${bespaard >= 0 ? `Bespaard deze maand: <b>${eur(bespaard, 2)}</b> vergeleken met stroom op gemiddelde momenten` : `Deze maand ${eur(-bespaard, 2)} duurder dan op gemiddelde momenten`}</p>` : '')
    + (v.est ? '<small>Schatting: deze stekker geeft elk kwartier het vermogen door, geen meterstand.</small>' : '') + '</div>';
}
const datumNL = t => new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(t));
function proefHTML(d) {
  if (!d.proef || accInfo.betaaldTot > Date.now()) return '';
  const over = d.proef.eind - Date.now();
  if (over <= 0) return accInfo.proefAfdwingen ? '<div class="proefr op">Je gratis proefperiode is voorbij.</div>' : '';
  return accInfo.proefAfdwingen ? `<div class="proefr">Gratis tot ${datumNL(d.proef.eind)}.</div>` : '';
}
// ---------- Besparing delen als plaatje (gratis reclame) ----------
async function deelBesparing(bedrag) {
  const c = document.createElement('canvas'); c.width = c.height = 1080; const g = c.getContext('2d');
  g.fillStyle = '#0F2340'; g.fillRect(0, 0, 1080, 1080);
  g.fillStyle = '#F5B700'; g.beginPath(); g.moveTo(0, 1080); g.lineTo(520, 760); g.lineTo(400, 860); g.lineTo(1080, 640); g.lineTo(560, 960); g.lineTo(680, 860); g.closePath(); g.globalAlpha = .18; g.fill(); g.globalAlpha = 1;
  const f = (w, px) => `${w} ${px}px "Plex", system-ui, sans-serif`;
  try { await Promise.all([document.fonts.load('700 74px Plex'), document.fonts.load('600 52px Plex')]); } catch { /* systeemletter */ }
  g.textAlign = 'center';
  g.fillStyle = '#C7D2E3'; g.font = f(600, 52); g.fillText('Deze maand bespaarde ik', 540, 330);
  g.fillStyle = '#F5B700'; g.font = f(700, 190); g.fillText(eur(bedrag, 2), 540, 540);
  g.fillStyle = '#FFFFFF'; g.font = f(600, 46); g.fillText('door stroom te gebruiken als het goedkoop is', 540, 640);
  g.font = f(700, 74); g.fillStyle = '#F5B700'; g.fillText('Stroom', 430, 880); g.fillStyle = '#FFFFFF'; g.fillText('wekker', 660, 880);
  g.fillStyle = '#C7D2E3'; g.font = f(600, 40); g.fillText('stroomwekker.eu · gratis', 540, 950);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'besparing-stroomwekker.png', { type: 'image/png' });
  const tekst = `Ik bespaarde deze maand ${eur(bedrag, 2)} met Stroomwekker: mijn apparaten gaan vanzelf aan als stroom goedkoop is. Gratis: https://stroomwekker.eu/?bron=deel`;
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: tekst }); return; }
    if (navigator.share) { await navigator.share({ text: tekst, url: 'https://stroomwekker.eu/?bron=deel' }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Het plaatje is opgeslagen. Deel het op Facebook, WhatsApp of Instagram.');
}
function renderDevices() {
  if (typeof renderMijn === 'function') setTimeout(renderMijn);
  { const m = devices.map(d => d.verbruik).filter(v => v && v.meet && v.maand);
    const kwh = m.reduce((a, v) => a + v.maand.kwh, 0), kost = m.reduce((a, v) => a + v.maand.cost, 0), ref = m.reduce((a, v) => a + v.maand.ref, 0);
    const el = $('devSom'); el.hidden = !(kwh > 0.05);
    if (!el.hidden) el.innerHTML = `Deze maand samen: <strong>${kwhTxt(kwh)}</strong> voor <strong>${eur(kost, 2)}</strong>.` + (ref - kost > 0.005 ? ` Je bespaarde <b>${eur(ref - kost, 2)}</b> door op goedkope momenten stroom te gebruiken.` : '')
      + (ref - kost >= 0.5 ? ' <button type="button" class="deelknop" id="deelBesparing">Deel je besparing</button>' : '');
    if (!el.hidden && $('deelBesparing')) $('deelBesparing').onclick = () => deelBesparing(ref - kost); }
  $('devList').innerHTML = devices.map(d => {
    const s = d.status;
    const st = d.enabled === false ? '<span class="status muted">Staat op pauze</span>'
      : s ? (s.ok ? `<span class="status ok">● ${s.on ? 'Aan' : 'Uit'} sinds ${nlTime(s.at)}</span>` : `<span class="status err">⚠ ${esc(s.msg || 'Het lukte niet')}</span>`)
      : '<span class="status muted">Begint bij het volgende kwartier</span>';
    return `<li class="item"><div class="txt"><b>${esc(d.name)}</b><span>${ruleText(d.rule)} · ${{ shelly: 'Shelly', tuya: 'Action / Smart Life' }[d.kind] || 'eigen link'}</span><br>${st}</div>
      <button class="btn-line btn-sm" data-edit="${d.id}">Wijzig</button><button class="x" data-deldev="${d.id}" aria-label="Verwijderen">×</button>${proefHTML(d)}${verbruikHTML(d)}</li>`;
  }).join('');
}
document.addEventListener('click', e => {
  const w = e.target.closest?.('[data-welke]'); if (!w) return;
  e.preventDefault(); const m = document.querySelector('.meetuitleg'); if (m) { m.open = true; m.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});
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
  if (d?.kind === 'easee') { toast('Een Easee-laadpaal pas je aan door hem weg te halen en opnieuw te koppelen via "Apparaat toevoegen".'); return; }
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
    rule: rt === 'warmte' ? { type: 'warmte', cop: COP } : rt === 'battery' ? { type: 'battery', hours: +$('dBatHrs').value } : rt === 'solar' ? { type: 'solar', limit: (num('dLimit') || 0) / 100 } : rt === 'cheapest' ? { type: 'cheapest', hours: +$('dHrs').value, block: $('dBlock').checked } : { type: 'below', on: num('dOnP') / 100, off: num('dOffP') / 100 } };
}
const say = (t, ok) => { $('dMsg').textContent = t; $('dMsg').className = 'msg ' + (ok ? 'ok' : 'err'); };
async function test(on) {
  say('Bezig…', true);
  try { const r = await api({ action: 'test', device: formDevice(), on }); say((on === 'supply' ? '✓ Verstuurd. Levert je batterij nu stroom?' : on ? '✓ Verstuurd. Gaat je apparaat nu aan?' : '✓ Verstuurd. Gaat je apparaat nu uit?') + meetZin(r), true); }
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
{ const opt = [...$('sLever').options].find(o => o.value && Math.abs(Number(o.value) / 100 - settings.opslag) < 1e-6 && settings.lever === o.textContent); if (opt) opt.selected = true; }
$('sLever').onchange = () => { const v = Number($('sLever').value); if (!v) return; settings.opslag = v / 100; const gv = Number($('sLever').selectedOptions[0].dataset.gas); if (gv) { settings.gasOpslag = gv / 100; $('sGasOpslag').value = gv.toFixed(2); } settings.lever = $('sLever').selectedOptions[0].textContent; $('sOpslag').value = v.toFixed(2); render(); sync().catch(() => {}); };
$('sGasOpslag').value = ((settings.gasOpslag ?? 0.07) * 100).toFixed(2);
$('sGasOpslag').oninput = () => { settings.lever = ''; $('sLever').value = ''; const v = num('sGasOpslag'); if (Number.isFinite(v)) { settings.gasOpslag = v / 100; render(); sync().catch(() => {}); } };
$('sOpslag').oninput = () => { settings.lever = ''; $('sLever').value = ''; const v = num('sOpslag'); if (Number.isFinite(v)) { settings.opslag = v / 100; render(); sync().catch(() => {}); } };
$('myCode').value = token;
async function wisselNaar(c) {
  const old = token; token = c;
  try {
    const j = await api({ action: 'get' });
    LS.set('sw-token', c);
    settings = { ...settings, ...(j.settings || {}) }; alerts = j.alerts || [];
    LS.set('sw-alerts', alerts); LS.set('sw-settings', settings); applyServer(j); renderAlerts(); render(); await enablePush();
    $('myCode').value = token; return true;
  } catch (e) { token = old; $('myCode').value = token; throw e; }
}
$('useCode').onclick = async () => {
  const c = $('otherCode').value.trim();
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(c)) { $('otherCode').value = ''; $('otherCode').placeholder = 'Deze code klopt niet'; return; }
  try { await wisselNaar(c); $('otherCode').value = ''; $('otherCode').placeholder = '✓ Gekoppeld'; }
  catch (e) { $('otherCode').value = ''; $('otherCode').placeholder = e.message; }
};

// ---------- E-mail: berichten per mail en inloggen met een link ----------
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = t; document.body.append(d); setTimeout(() => d.remove(), 6000); }
let mailInfo = null;
function renderMail() {
  if (!$('sMail')) return;
  if (mailInfo && document.activeElement !== $('sMail')) $('sMail').value = mailInfo.adres || '';
  $('sMailBer').checked = mailInfo ? mailInfo.berichten !== false : true;
  if (mailInfo && !$('sMailMsg').dataset.vast) { $('sMailMsg').textContent = mailInfo.ok ? '✓ Bevestigd' : 'Nog niet bevestigd: klik op de link in de mail die we stuurden.'; $('sMailMsg').className = 'msg ' + (mailInfo.ok ? 'ok' : ''); }
}
async function slaMailOp(adres, berichten, msgEl) {
  const zeg = (t, ok) => { if (msgEl) { msgEl.textContent = t; msgEl.className = 'msg ' + (ok ? 'ok' : 'err'); msgEl.dataset.vast = '1'; } };
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(adres)) { zeg('Vul een geldig e-mailadres in.'); return false; }
  zeg('Bezig…', true);
  try { await sync(); const j = await api({ action: 'email', email: adres, berichten }); applyServer(j);
    zeg(j.email?.ok ? '✓ Opgeslagen' : 'Bijna klaar: we hebben je een mail gestuurd. Klik op de link om je adres te bevestigen.', true); return true; }
  catch (e) { zeg(e.message); return false; }
}
$('sMailSave') && ($('sMailSave').onclick = () => slaMailOp($('sMail').value.trim(), $('sMailBer').checked, $('sMailMsg')));
$('sMailBer') && ($('sMailBer').onchange = () => { if (mailInfo?.adres) slaMailOp(mailInfo.adres, $('sMailBer').checked, $('sMailMsg')); });
$('loginGo') && ($('loginGo').onclick = async () => {
  const m = $('loginMsg'); m.className = 'msg ok'; m.textContent = 'Bezig…';
  try { const r = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'loginlink', email: $('loginMail').value.trim() }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error); m.textContent = j.msg; }
  catch (e) { m.className = 'msg err'; m.textContent = e.message || 'Dat lukte niet. Probeer het later opnieuw.'; }
});
{ const n = new URLSearchParams(location.search).get('login');
  if (n) { history.replaceState(null, '', location.pathname);
    fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', nonce: n }) })
      .then(r => r.json()).then(async j => { if (j.error) throw new Error(j.error); await wisselNaar(j.token); toast('✓ Je bent ingelogd. Je ziet nu je eigen berichten en apparaten.'); })
      .catch(e => toast(e.message || 'Deze inloglink werkt niet meer.')); } }

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
function installeer(e) {
  e && e.preventDefault(); LS.set('sw-installno', 0);
  if (standalone) { return; }
  if (bip) { bip.prompt(); return; }
  $('install').hidden = false; $('iosHint').hidden = false; $('installGo').hidden = true;
  $('iosHint').innerHTML = isIOS ? 'Tik onderin op <b>Deel</b> en kies <b>Zet op beginscherm</b>.' : 'Open het menu van je browser (de drie puntjes) en kies <b>App installeren</b> of <b>Toevoegen aan startscherm</b>.';
}
$('installKnop') && ($('installKnop').onclick = installeer);
$('navInstall') && ($('navInstall').onclick = installeer);
$('installLink') && ($('installLink').onclick = e => {
  e.preventDefault(); LS.set('sw-installno', 0);
  if (bip) bip.prompt(); else { $('install').hidden = false; $('iosHint').hidden = false; $('installGo').hidden = true; }
});
if (standalone) { $('installKnop') && ($('installKnop').hidden = true); $('navInstall') && ($('navInstall').hidden = true); }
setTimeout(maybeInstall, 1500);

// ---------- Start ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
renderAlerts(); renderDevices(); renderPushNotice();
data = LS.get('sw-lastdata', null); globalThis.__swGas = data?.gas; globalThis.__swTemp = data?.temp; render();
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
const EMO = { '🔌': 'plug', '🔋': 'battery', '☀️': 'sun', '🔔': 'bell', '🚿': 'drop', '👕': 'wash', '🚗': 'car', '⚙️': 'sliders', '🛒': 'shop', '📱': 'phone', '🔵': 'chip', '❓': 'help', '✅': 'check', '⏱️': 'clock', '👍': 'check', '🏠': 'home', '🟢': 'clock', '📅': 'calendar', '🗣️': 'phone', '🔧': 'sliders', '♨️': 'drop', '🔥': 'drop' };
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
  if ((W.d.kind === 'tuya' || W.d.kind === 'shelly' || W.d.alexa) && v.t !== 'Klaar') { $('wizB').insertAdjacentHTML('beforeend', hulpLink(v.t));
    const h = $('wizB').querySelector('.hulp a'); h.onclick = () => { h.href = new DOMParser().parseFromString(hulpLink(v.t), 'text/html').querySelector('a').getAttribute('href'); }; }
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
const sStekker = () => ({ t: W.d.preset === 'auto' ? 'Hoe laad je je auto?' : 'Welke slimme stekker heb je?', p: W.d.preset === 'auto' ? 'Heb je een Easee-laadpaal? Die koppelen we rechtstreeks. Laad je met een gewone stekker, kies dan je slimme stekker.' : 'Aan en uit zetten werkt met élke stekker hieronder, ook de goedkoopste. Alleen voor het verbruik zien heb je een stekker met energiemeter nodig.', opts: [
  ...(W.d.preset === 'auto' ? [{ i: '🚗', l: 'Easee-laadpaal', s: 'Rechtstreeks gekoppeld, geen stekker nodig. Klaar in 2 minuten.', go: () => { W.d.kind = 'easee'; go(sEasee); } },
    { i: '❓', l: 'Andere laadpaal of Tesla', s: 'Zaptec, Wallbox, Alfen, Tesla en andere', go: () => go(sLaadAnders) }] : []),
  { i: '🛒', l: 'Van de Action (LSC)', s: 'Makkelijk met een timer, of volledig automatisch', go: () => { W.d.kind = 'tuya'; W.d.lsc = true; go(sLscKeuze); } },
  { i: '📱', l: 'Smart Life of Tuya', s: 'Ook Hema, Calex, Nedis, Woox. Makkelijk via Alexa, of via Tuya', go: () => { W.d.kind = 'tuya'; W.d.lsc = false; go(sLscKeuze); } },
  { i: '🔵', l: 'Shelly', s: 'Snelst te koppelen (3 minuten). Verbruik zien: Plug S, Plus Plug S en modellen met PM', go: () => { W.d.kind = 'shelly'; go(sShelly); } },
  { i: '🗣️', l: 'Een andere stekker die met Alexa werkt', s: 'Bijvoorbeeld TP-Link, Meross of Philips Hue', go: () => { W.d.merkApp = ''; W.d.kind = 'webhook'; W.d.alexa = true; go(sAlexa1); } },
  { i: '❓', l: 'Ik heb nog geen slimme stekker', go: () => go(sGeenStekker) },
] });
const BOLSHELLY = 'https://partner.bol.com/click/click?p=1&t=url&s=1558346&url=' + encodeURIComponent('https://www.bol.com/nl/nl/s/?searchtext=shelly+plug+s') + '&f=TXL&name=stroomwekker-shelly';
const sGeenStekker = () => ({ t: 'Je hebt een slimme stekker nodig', of: 4,
  p: 'Een slimme stekker zet je tussen het stopcontact en je apparaat. Wij kunnen hem dan aan en uit zetten. Er zijn twee goede keuzes:',
  html: `<a class="koopstekker" href="${BOLSHELLY}" target="_blank" rel="sponsored noopener"><span aria-hidden="true">⚡</span><span><b>Makkelijkst: Shelly Plug S</b><small>Rond de € 20 tot € 25. Meet ook het verbruik. Koppelen duurt 3 minuten, op je telefoon · advertentie</small></span></a>
    <div class="koopstekker"><span aria-hidden="true">🛒</span><span><b>Goedkoopst: LSC Smart Connect van de Action</b><small>Een paar euro. Koppelen duurt ongeveer 20 minuten en gaat het best op een computer. Kies een stekker met energiemeter als je het verbruik wilt zien.</small></span></div>
    <p class="small muted" style="margin-top:12px">Let op: een slimme stekker kan meestal maximaal 3.680 watt aan. Voor een laadpaal of grote boiler heb je soms iets anders nodig.</p>`,
  opts: [{ i: '🔔', l: 'Stuur me intussen een bericht als stroom goedkoop is', go: () => go(sBerichtKies) }, { i: '🏠', l: 'Terug naar het begin', go: wizClose }] });

// Invulvakken met uitleg: wat het is, waar je het vindt, hoe het eruitziet, en direct controleren.
function veldHTML(id, label, wat, waar, voorbeeld, patroon) {
  return `<label class="veld">${label}<span class="hint">${wat}</span>
    <input id="${id}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${voorbeeld}" data-p="${patroon}">
    <span class="hint"><b>Waar vind ik dit?</b> ${waar}</span><span class="vchk" id="${id}c" aria-live="polite"></span></label>`;
}
function wireVelden() {
  $('wizB').querySelectorAll('input[data-p]').forEach(i => {
    const c = $(i.id + 'c'), re = new RegExp(i.dataset.p);
    const check = () => { const v = i.value.trim(); if (!v) { c.textContent = ''; c.className = 'vchk'; return; }
      const ok = re.test(v); c.textContent = ok ? '✓ Dit ziet er goed uit' : 'Dit lijkt nog niet te kloppen. Kopieer de hele code, zonder spaties.'; c.className = 'vchk ' + (ok ? 'ok' : 'err'); };
    i.addEventListener('input', check); i.addEventListener('blur', check);
  });
}
const testRow = '<div class="testrij"><button class="btn-line" type="button" id="wTest">Test: zet aan</button><button class="btn" type="button" id="wNext">Klaar, verder</button></div><p class="msg" id="wMsg" role="status"></p>';
const stap = (t, items, of, volgende, img) => ({ t, of, html: (img || '') + '<ol class="kstap">' + items.map(x => `<li><span>${x}</span></li>`).join('') + '</ol>', opts: [{ i: '✅', l: 'Gedaan, volgende stap', go: () => go(volgende) }] });
function wDevice() {
  const p = PRESETS[W.d.preset || 'anders'];
  const v = id => ($(id) ? $(id).value.trim() : '');
  const d = { id: W.d.id || (W.d.id = crypto.randomUUID()), name: W.d.name || p.name, kind: W.d.kind, notify: true, rule: W.d.rule || p.rule };
  if (W.d.kind === 'tuya') Object.assign(d, { accessId: v('wA'), accessSecret: v('wS'), deviceId: v('wD'), region: 'eu', code: 'switch_1' });
  if (W.d.kind === 'shelly') Object.assign(d, { host: v('wH'), key: v('wK'), deviceId: v('wD'), channel: 0 });
  if (W.d.kind === 'easee') Object.assign(d, { deviceId: v('wD'), ...(W.d.easee || {}) });
  if (W.d.kind === 'webhook') Object.assign(d, { onUrl: v('wOn'), offUrl: v('wOff'), method: 'GET' });
  return d;
}
const meetZin = r => r?.meet === true ? ' Deze stekker meet ook het verbruik: je ziet straks wat je apparaat kost en wat je bespaart.' : r?.meet === false ? ' Deze stekker meet geen verbruik. Dat is niet erg: aan en uit zetten werkt gewoon.' : '';
function wireTest() {
  const msg = (t, ok) => { $('wMsg').textContent = t; $('wMsg').className = 'msg ' + (ok ? 'ok' : 'err'); if (!ok) W.d.fout = t; };
  $('wTest').onclick = async () => { msg('Even geduld…', true); try { const r = await api({ action: 'test', device: wDevice(), on: true }); msg('✓ Gelukt! Gaat je apparaat aan? Dan werkt het.' + meetZin(r), true); W.d.fout = ''; W.d.tested = true; } catch (e) { msg(e.message); } };
  $('wNext').onclick = async () => {
    if (!$('wD').value.trim()) { msg('Kies eerst je stekker. Tik op "Zoek mijn stekkers".'); return; }
    if (!W.d.tested && !W.d.warned) { W.d.warned = true; msg('Tik eerst op "Test: zet aan" om te zien of het werkt. Wil je het toch bewaren? Tik dan nog een keer op "Klaar, verder".'); return; }
    msg('Bewaren…', true);
    const d = wDevice(), prev = devices;
    devices = [...devices.filter(x => x.id !== d.id), d];
    try { await sync(); go(sKlaarApparaat); } catch (e) { devices = prev; LS.set('sw-devices', prev); msg(e.message); }
  };
}
// ---- Schetsen: zo ziet het scherm er ongeveer uit (geen echte schermafbeelding) ----
const xe = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function schets({ menu = [], actief = -1, sub = '', tabs = [], tab = -1, items = [] }) {
  const W2 = 320; let o = '';
  const hl = (x, y, w, h) => `<rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="7" fill="none" stroke="#F5B700" stroke-width="3"/>`;
  let left = 10, menuEind = 0;
  if (menu.length) {
    left = 88; let y = 34;
    menu.forEach((m, i) => { o += `<text x="12" y="${y + 9}" font-size="9" fill="${i === actief ? '#F5B700' : '#C7D2E3'}" font-weight="${i === actief ? 700 : 400}">${xe(m)}</text>`;
      if (i === actief) { o += hl(8, y, 64, 12); if (sub) { y += 20; o += `<text x="17" y="${y + 9}" font-size="7.8" fill="#fff" font-weight="700">› ${xe(sub)}</text>` + hl(13, y, 64, 12); } }
      y += 20; });
    menuEind = y;
  }
  let y = 34;
  if (tabs.length) { let x = left; tabs.forEach((t, i) => { const w = t.length * 5.4 + 12; o += `<text x="${x + 6}" y="${y + 10}" font-size="9" fill="${i === tab ? '#0F2340' : '#8492A6'}" font-weight="${i === tab ? 700 : 400}">${xe(t)}</text>`; if (i === tab) o += hl(x, y, w, 14); x += w + 8; }); y += 26; }
  for (const it of items) {
    if (it.k === 'btn') { const w = it.t.length * 5.6 + 18; o += `<rect x="${left}" y="${y}" width="${w}" height="18" rx="5" fill="#2563EB"/><text x="${left + 9}" y="${y + 12.5}" font-size="9" fill="#fff" font-weight="700">${xe(it.t)}</text>` + (it.hl ? hl(left, y, w, 18) : ''); y += 28; }
    else if (it.k === 'row') { o += `<text x="${left}" y="${y + 9}" font-size="8.5" fill="#5B6B80">${xe(it.l)}</text><rect x="${left}" y="${y + 13}" width="${W2 - left - 12}" height="14" rx="4" fill="#F1F4F8"/><text x="${left + 6}" y="${y + 23}" font-size="8.5" fill="#0F2340" font-family="monospace">${xe(it.t)}</text>` + (it.hl ? hl(left, y + 13, W2 - left - 12, 14) : ''); y += 36; }
    else if (it.k === 'card') { o += `<rect x="${left}" y="${y}" width="${W2 - left - 12}" height="30" rx="6" fill="#F7F9FC" stroke="#DCE3ED"/><text x="${left + 8}" y="${y + 13}" font-size="9" fill="#0F2340" font-weight="700">${xe(it.t)}</text><text x="${left + 8}" y="${y + 24}" font-size="8" fill="#5B6B80">${xe(it.s || '')}</text>` + (it.hl ? hl(left, y, W2 - left - 12, 30) : ''); y += 40; }
    else if (it.k === 'qr') { for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) if ((i * 3 + j * 5 + i * j) % 3) o += `<rect x="${left + i * 7}" y="${y + j * 7}" width="6" height="6" fill="#0F2340"/>`; o += `<text x="${left + 58}" y="${y + 22}" font-size="8.5" fill="#5B6B80">Scan met Smart Life</text>`; y += 56; }
  }
  const H = Math.max(y, menuEind) + 6;
  const kader = `<rect x="1" y="1" width="${W2 - 2}" height="${H - 2}" rx="10" fill="#fff" stroke="#C9D3E1"/>` + (menu.length ? `<rect x="1" y="23" width="80" height="${H - 24}" fill="#0F2340"/>` : '') + `<rect x="1" y="1" width="${W2 - 2}" height="22" rx="10" fill="#E8EDF4"/><rect x="1" y="14" width="${W2 - 2}" height="9" fill="#E8EDF4"/><circle cx="14" cy="12" r="3" fill="#C9D3E1"/><circle cx="24" cy="12" r="3" fill="#C9D3E1"/><rect x="40" y="6" width="150" height="12" rx="6" fill="#fff"/><text x="48" y="15.5" font-size="8" fill="#5B6B80">platform.tuya.com</text>`;
  return `<figure class="schets"><svg viewBox="0 0 ${W2} ${H}" role="img" aria-label="Schets van het scherm">${kader + o}</svg><figcaption>Schets: zo ziet het er ongeveer uit. Klik op wat geel omrand is.</figcaption></figure>`;
}
const TMENU = ['Overview', 'Cloud', 'Devices', 'Service'];
const SCH = {
  aanmelden: () => schets({ items: [{ k: 'card', t: 'Create an account', s: 'E-mail en wachtwoord' }, { k: 'card', t: 'Individual Developer', s: 'Kies dit: voor privégebruik', hl: 1 }, { k: 'btn', t: 'Sign Up', hl: 1 }] }),
  project: () => schets({ menu: TMENU, actief: 1, sub: 'Development', items: [{ k: 'btn', t: 'Create Cloud Project', hl: 1 }, { k: 'row', l: 'Data Center', t: 'Central Europe Data Center' }] }),
  koppel: () => schets({ menu: TMENU, actief: 1, sub: 'Development', tabs: ['Overview', 'Devices', 'Service API'], tab: 1, items: [{ k: 'btn', t: 'Link App Account', hl: 1 }, { k: 'qr' }] }),
  verleng: () => schets({ menu: TMENU, actief: 1, sub: 'Cloud Services', items: [{ k: 'card', t: 'IoT Core', s: 'View Details', hl: 1 }, { k: 'btn', t: 'Extend Trial Period', hl: 1 }] }),
  codes: () => schets({ menu: TMENU, actief: 1, sub: 'Development', tabs: ['Overview', 'Devices', 'Service API'], tab: 0, items: [{ k: 'row', l: 'Access ID/Client ID', t: 'k8xq3m7rw2c9vn5tyhpe', hl: 1 }, { k: 'row', l: 'Access Secret/Client Secret', t: '••••••••••••••••  👁', hl: 1 }] }),
};

// ---- Hulp: contactformulier met de stap en de foutmelding al ingevuld ----
function hulpLink(stapNaam) {
  const merk = W.d.alexa ? 'Via Alexa (' + appNaam() + ')' : W.d.kind === 'shelly' ? 'Shelly' : W.d.lsc ? 'Action (LSC Smart Connect)' : W.d.kind === 'tuya' ? 'Smart Life of Tuya (Hema, Calex, Nedis, Woox, Hombli…)' : '';
  const q = new URLSearchParams({ onderwerp: 'Hulp bij het koppelen van mijn slimme stekker', merk, bericht: `Ik loop vast bij: ${stapNaam}.` + (W.d.fout ? `\nIk zie deze melding: ${W.d.fout}` : '') + '\n\n' });
  return `<p class="hulp"><a href="/contact/?${q}" target="_blank" rel="noopener">${svg('help')}<span>Kom je er niet uit? <b>Vraag hulp</b>. Wij zien dan meteen bij welke stap je bent.</span></a></p>`;
}

// ---- Codes in één keer plakken: wij herkennen zelf wat wat is ----
function verdeel(tekst) {
  const t = String(tekst || '');
  if (W.d.kind === 'tuya') {
    const tok = t.match(/[A-Za-z0-9]{16,40}/g) || []; if (tok.length < 2) return false;
    const sec = tok.find(x => x.length === 32) || tok.find(x => x.length > 24), id = tok.find(x => x !== sec && x.length <= 24);
    if (!sec || !id) return false; $('wA').value = id; $('wS').value = sec; return true;
  }
  if (W.d.kind === 'shelly') {
    const host = (t.match(/shelly-\d{1,3}-[a-z]{2,4}\.shelly\.cloud/i) || [])[0];
    const key = (t.replace(host || '§', ' ').match(/[A-Za-z0-9+/=_-]{30,}/g) || []).sort((a, b) => b.length - a.length)[0];
    if (!host || !key) return false; $('wH').value = host.toLowerCase(); $('wK').value = key; return true;
  }
  return false;
}

// ---- Stekkers zoeken: niemand hoeft een apparaatnummer over te typen ----
const zoekHTML = `<div class="zoek"><button class="btn-line" type="button" id="wZoek">Zoek mijn stekkers</button><div id="wLijst" class="opts" aria-live="polite"></div>
  <details class="zelf"><summary>Liever zelf het nummer invullen?</summary>__VELD__</details></div>`;
function wireZoek() {
  const zoek = async (stil) => {
    const l = $('wLijst'); if (!l) return;
    l.innerHTML = '<p class="hint">Even zoeken…</p>';
    try {
      const d = wDevice(); const r = await api({ action: 'list', device: d });
      const lijst = r.devices || [];
      if (!lijst.length) { l.innerHTML = '<p class="msg err">We vonden geen stekkers bij dit account. ' + (W.d.kind === 'tuya' ? 'Heb je stap 4 gedaan (Smart Life koppelen)?' : 'Staat je stekker in de Shelly-app?') + '</p>'; return; }
      l.innerHTML = '<p class="hint" style="margin:6px 0">Tik op de stekker die je wilt gebruiken:</p>' + lijst.map((x, i) => `<button class="opt${$('wD').value === x.id ? ' sel' : ''}" type="button" data-i="${i}"><span>${svg('plug')}</span><div><b>${esc(x.name || 'Stekker')}</b><small>${x.online === false ? 'Offline' : 'Online'}${x.aan == null ? '' : x.aan ? ' · nu aan' : ' · nu uit'}</small></div></button>`).join('');
      l.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const x = lijst[+b.dataset.i]; $('wD').value = x.id; $('wD').dispatchEvent(new Event('input')); W.d.tested = false; l.querySelectorAll('.opt').forEach(o => o.classList.toggle('sel', o === b)); });
      if (lijst.length === 1) l.querySelector('[data-i]').click();
    } catch (e) { W.d.fout = e.message; l.innerHTML = stil ? '' : `<p class="msg err">${esc(e.message)}</p>`; }
  };
  $('wZoek').onclick = () => zoek(false);
  let klaar = '';
  const auto = () => { const sleutels = W.d.kind === 'tuya' ? ['wA', 'wS'] : ['wH', 'wK'];
    const ok = sleutels.every(id => new RegExp($(id).dataset.p).test($(id).value.trim())); const k = sleutels.map(id => $(id).value.trim()).join('|');
    if (ok && k !== klaar) { klaar = k; zoek(true); } };
  $('wizB').querySelectorAll('input[data-p]').forEach(i => {
    i.addEventListener('input', auto);
    i.addEventListener('paste', e => { const t = (e.clipboardData || window.clipboardData)?.getData('text'); if (verdeel(t)) { e.preventDefault(); $('wizB').querySelectorAll('input[data-p]').forEach(x => x.dispatchEvent(new Event('blur'))); auto(); } });
  });
}

// ---- Action (LSC): makkelijk met een timer, of volledig automatisch ----
const sLscKeuze = () => ({ t: 'Hoe wil je het doen?', p: 'Je kunt op drie manieren kiezen. De eerste is de makkelijkste die vanzelf gaat.', opts: [
  { i: '🗣️', l: 'Vanzelf, via de app Alexa (aanrader)', s: 'Alles op je telefoon. Geen codes, geen computer. Kost ongeveer 10 minuten. Gratis.', go: () => { W.d.merkApp = W.d.lsc ? 'LSC Smart Connect' : 'Smart Life'; W.d.kind = 'webhook'; W.d.alexa = true; go(sAlexa1); } },
  ...(W.d.lsc ? [{ i: '⏱️', l: 'Zelf een timer zetten', s: 'Je krijgt elke dag een bericht met de goedkoopste tijden. Die zet je zelf in de LSC-app. Klaar in 2 minuten.', go: () => { W.d.kind = ''; W.d.alexa = false; go(sLscTimer); } }] : []),
  { i: '🔧', l: 'Vanzelf, via Tuya (voor gevorderden)', s: (W.d.lsc ? 'Verhuis je stekker naar de app Smart Life. ' : '') + 'Kost ongeveer 20 minuten op een computer.', go: () => { W.d.kind = 'tuya'; W.d.alexa = false; go(sTuya); } },
] });

// ---- Via Alexa: Stroomwekker drukt op een "knop" bij Voice Monkey, Alexa zet je stekker aan of uit ----
// Heel kleine stappen, één ding per scherm. Elke stap: wat je doet, en hoe je weet dat het gelukt is.
const AX = 7;
const appNaam = () => W.d.merkApp || 'de app van je stekker';
const sAlexa1 = () => stap('Wat heb je nodig?', [
  `Je telefoon.`,
  `Je slimme stekker. Hij moet al werken in <b>${appNaam()}</b>: je kunt hem daar aan en uit zetten.`,
  `Een account bij Amazon. Heb je er nog geen? Die maak je gratis aan in stap 1.`,
  `Je hebt <b>geen</b> Amazon-speaker nodig, en ook geen computer.`,
  `Het is gratis voor 1 apparaat. Wil je er meer, dan kost Voice Monkey een paar euro per maand.`,
], AX, () => sAlexa2());
const sAlexa2 = () => stap('Stap 1: installeer de app Alexa', [
  'Open de <b>App Store</b> (iPhone) of <b>Play Store</b> (Android).',
  'Zoek op <b>Amazon Alexa</b>. Het pictogram is een blauw rondje met een wit tekstballonnetje.',
  'Tik op <b>Installeren</b> (of <b>Downloaden</b>) en open de app.',
  'Log in met je Amazon-account. Heb je er geen? Tik op <b>Nieuw account maken</b> en volg de stappen.',
  'Vraagt de app om een taal? Kies <b>Nederlands</b>. Vraagt hij om een speaker in te stellen? Tik op <b>Overslaan</b> of <b>Later</b>.',
  '<b>Gelukt</b> als je het beginscherm van de Alexa-app ziet.',
], AX, () => sAlexa3());
const sAlexa3 = () => stap('Stap 2: zet je stekker in Alexa', [
  'Tik in de Alexa-app onderin op <b>Meer</b> (de drie streepjes).',
  'Tik op <b>Skills en games</b>.',
  `Tik op het vergrootglas en typ: <b>${W.d.merkApp || 'de naam van de app van je stekker'}</b>.`,
  'Tik op het resultaat en dan op <b>Inschakelen voor gebruik</b> (of <b>Inschakelen</b>).',
  `Log in met hetzelfde account als in <b>${appNaam()}</b>. Tik op <b>Autoriseren</b> of <b>Toestaan</b>.`,
  'Alexa zoekt nu je apparaten. Tik op <b>Apparaten zoeken</b> als hij het vraagt.',
  '<b>Gelukt</b> als je stekker in de Alexa-app staat onder <b>Apparaten</b>. Tik erop: kun je hem aan en uit zetten? Mooi.',
], AX, () => sAlexa4());
const sAlexa4 = () => { const x = stap('Stap 3: maak een gratis account bij Voice Monkey', [
  'Voice Monkey is een gratis hulpje. Het maakt een "knop" waarmee Stroomwekker een opdracht aan Alexa kan geven.',
  'Tik hieronder op <b>Open Voice Monkey</b>. Tik daar op <b>Sign up</b> of <b>Login with Amazon</b>, en log in met <b>hetzelfde Amazon-account</b> als in de Alexa-app.',
  'Ga terug naar de Alexa-app. Tik op <b>Meer</b>, dan <b>Skills en games</b>, en zoek op <b>Voice Monkey</b>.',
  'Tik op <b>Inschakelen voor gebruik</b> en log weer in met hetzelfde Amazon-account.',
  '<b>Gelukt</b> als de Alexa-app zegt dat Voice Monkey is gekoppeld.',
], AX, () => sAlexa5()); x.html += '<p style="margin-top:14px"><a class="btn btn-line" href="https://voicemonkey.io" target="_blank" rel="noopener">Open Voice Monkey</a></p>'; return x; };
const sAlexa5 = () => stap('Stap 4: maak twee knoppen', [
  'Ga terug naar Voice Monkey (de website die je net opende).',
  'Tik op <b>Devices</b> (apparaten) en dan op <b>Add Device</b> of het plusje.',
  'Kies <b>Routine Trigger</b>. Geef hem de naam: <b>Stroomwekker aan</b>. Tik op <b>Save</b> (opslaan).',
  'Doe het nog een keer, met de naam: <b>Stroomwekker uit</b>.',
  'Ga naar de Alexa-app. Tik onderin op <b>Apparaten</b>, dan op het plusje en <b>Apparaat toevoegen</b>, en laat Alexa zoeken. Of trek het scherm omlaag.',
  '<b>Gelukt</b> als je in de Alexa-app twee nieuwe apparaten ziet: <b>Stroomwekker aan</b> en <b>Stroomwekker uit</b>. Alexa noemt ze soms een deurbel. Dat is goed.',
], AX, () => sAlexa6());
const sAlexa6 = () => stap('Stap 5: maak twee routines in Alexa', [
  'Een routine is een regel: "als dit gebeurt, doe dan dat". Je maakt er twee.',
  'Tik in de Alexa-app op <b>Meer</b> en dan op <b>Routines</b>. Tik op het <b>plusje</b>.',
  'Tik op <b>Wanneer dit gebeurt</b>, kies <b>Slim huis</b> en kies <b>Stroomwekker aan</b>.',
  'Tik op <b>Actie toevoegen</b>, kies <b>Slim huis</b>, kies je <b>stekker</b> en kies <b>Aan</b>. Tik op <b>Opslaan</b>.',
  'Maak nog een routine, precies hetzelfde, maar nu met <b>Stroomwekker uit</b> en je stekker op <b>Uit</b>.',
  '<b>Gelukt</b> als je onder <b>Routines</b> twee routines ziet.',
], AX, () => sAlexa7());
const VMRE = /https:\/\/api-v\d\.voicemonkey\.io\/trigger\?[^\s"'<>]+/g;
const sAlexa7 = () => ({ t: 'Stap 6: plak twee links hier', of: AX,
  p: 'Nu vertel je Stroomwekker welke knop hij moet indrukken.',
  html: '<ol class="kstap">' + [
    'Tik hieronder op <b>Open de link-maker</b>. Je komt bij de <b>API Playground</b> van Voice Monkey.',
    'Kies bij <b>Device</b> de knop <b>Stroomwekker aan</b>. Tik op <b>Copy</b> (kopiëren) bij de link. De link begint met <i>https://api-v3.voicemonkey.io/trigger</i>.',
    'Kom terug naar Stroomwekker en plak hem in het eerste vak.',
    'Doe hetzelfde voor <b>Stroomwekker uit</b> en plak die link in het tweede vak.',
  ].map(x => `<li><span>${x}</span></li>`).join('') + '</ol>'
    + `<p><a class="btn btn-line" href="https://voicemonkey.io/docs/api/playground" target="_blank" rel="noopener">Open de link-maker</a></p>`
    + veldHTML('wOn', 'Link om AAN te zetten', 'De link van de knop "Stroomwekker aan".', 'In Voice Monkey, bij API Playground. Kies "Stroomwekker aan" en kopieer de link.', 'https://api-v3.voicemonkey.io/trigger?…', '^https://api-v\\d\\.voicemonkey\\.io/trigger\\?\\S+$')
    + veldHTML('wOff', 'Link om UIT te zetten', 'De link van de knop "Stroomwekker uit".', 'Op dezelfde plek. Kies nu "Stroomwekker uit".', 'https://api-v3.voicemonkey.io/trigger?…', '^https://api-v\\d\\.voicemonkey\\.io/trigger\\?\\S+$')
    + '<p class="hint">Gaat de stekker niet aan bij de test? Kijk dan in de Alexa-app of je routine aan staat, en of je de goede link in het goede vak plakte.</p>'
    + '<p class="hint" style="margin-top:12px">Tik op <b>Test: zet aan</b>. Binnen een paar seconden gaat je stekker aan. Dan werkt alles.</p>' + testRow,
  after: () => {
    wireVelden();
    $('wizB').querySelectorAll('#wOn, #wOff').forEach(i => i.addEventListener('paste', e => {
      const t = (e.clipboardData || window.clipboardData)?.getData('text') || '', l = t.match(VMRE) || [];
      if (l.length >= 2) { e.preventDefault(); $('wOn').value = l[0]; $('wOff').value = l[1]; $('wizB').querySelectorAll('input[data-p]').forEach(x => x.dispatchEvent(new Event('blur'))); }
      else if (l.length === 1) { e.preventDefault(); i.value = l[0]; i.dispatchEvent(new Event('blur')); }
    }));
    wireTest();
  } });
function timerBlok(uren) {
  if (!data?.quarters) return null;
  const n = Math.max(1, Math.round(uren * 4)), nu = Date.now(), vd = nlDayBounds(nu), tm = nlDayBounds(vd.end + 60e3);
  const morgen = inRange(data.quarters, tm.start, tm.end).length >= 92;
  const b = morgen ? cheapestBlock(data.quarters, tm.start, tm.end, n) : cheapestBlock(data.quarters, Math.max(vd.start, quarterStart(nu)), vd.end, n);
  return b ? { ...b, dag: morgen ? 'morgen' : 'vandaag' } : null;
}
const sLscTimer = () => {
  const p = PRESETS[W.d.preset || 'anders'], uren = p.rule.hours || 2, b = timerBlok(uren);
  const nu = b ? `<div class="timerkaart"><small>${p.name}, ${b.dag}</small><b>Aan om ${nlTime(b.start)}<br>Uit om ${nlTime(b.end)}</b><small>Dan is stroom het goedkoopst</small></div>` : '';
  return { t: 'Zet een timer in de LSC-app', of: 4,
    html: nu + '<ol class="kstap">' + [
      'Open de app <b>LSC Smart Connect</b> en tik op je stekker.',
      'Tik onderin op <b>Schema</b> of <b>Timer</b> (de naam verschilt per versie van de app).',
      `Voeg een tijd toe om hem <b>aan</b> te zetten en een tijd om hem <b>uit</b> te zetten${b ? ', zoals hierboven' : ''}. Kies bij Herhalen: <b>alleen één keer</b>.`,
      `Elke middag, zodra de prijzen van morgen bekend zijn, sturen wij je een bericht met de goedkoopste ${uren} uur van morgen. Dan pas je de tijden aan. Dat duurt een halve minuut.`,
    ].map(x => `<li><span>${x}</span></li>`).join('') + '</ol><p class="hint">Liever helemaal automatisch, zonder timer? Kies dan op het vorige scherm voor <b>Volledig automatisch</b>.</p>',
    opts: [{ i: '🔔', l: 'Stuur mij elke dag de tijden', go: async () => { addAlert({ type: 'timer', hours: uren, name: p.name }); await enablePush(); go(sKlaarBericht); } }] };
};

// ---- Tuya / Action: kleine stappen, één ding per scherm ----
const sTuya = () => W.d.lsc ? sTuya1() : sTuya2();
const sTuya1 = () => stap('Stap 1: zet je stekker in de app Smart Life', [
  'Met de app van de Action (LSC Smart Connect) lukt het niet. Smart Life is dezelfde techniek, maar werkt wel.',
  'Open de app <b>LSC Smart Connect</b>. Tik op je stekker, dan rechtsboven op het potloodje, en kies <b>Apparaat verwijderen</b>.',
  'Download de gratis app <b>Smart Life</b> in de App Store of Google Play en maak een account.',
  'Tik in Smart Life op <b>+</b> en voeg je stekker toe, net zoals je in de LSC-app deed. Gaat het lampje van de stekker niet knipperen? Houd het knopje op de stekker 5 seconden ingedrukt.',
], W.d.lsc ? 8 : 7, () => sTuya2());
const sTuya2 = () => stap(`Stap ${W.d.lsc ? 2 : 1}: maak een gratis Tuya-account`, [
  'Dit doe je het makkelijkst op een <b>computer</b>. Tuya is het bedrijf achter Smart Life.',
  'Ga naar <b>platform.tuya.com</b> en klik op <b>Sign Up</b> (aanmelden). Vul je e-mailadres in en kies een wachtwoord.',
  'Vraagt de site wat voor account je wilt? Kies dan <b>Individual Developer</b> (privépersoon).',
], W.d.lsc ? 8 : 7, () => sTuya3(), SCH.aanmelden());
const sTuya3 = () => stap(`Stap ${W.d.lsc ? 3 : 2}: maak een project`, [
  'Klik links in het menu op <b>Cloud</b> en dan op <b>Development</b>.',
  'Klik op de blauwe knop <b>Create Cloud Project</b>.',
  'Vul bij <b>Project Name</b> iets in, bijvoorbeeld <i>Stroomwekker</i>. Kies bij <b>Industry</b>: <i>Smart Home</i>. Kies bij <b>Development Method</b>: <i>Smart Home</i>.',
  'Kies bij <b>Data Center</b>: <b>Central Europe Data Center</b>. Klik op <b>Create</b>.',
  'Krijg je een lijst met diensten (API services)? Klik gewoon op <b>Authorize</b>.',
], W.d.lsc ? 8 : 7, () => sTuya4(), SCH.project());
const sTuya4 = () => stap(`Stap ${W.d.lsc ? 4 : 3}: koppel je Smart Life-app`, [
  'Klik in je project bovenaan op het tabblad <b>Devices</b>, dan op <b>Link App Account</b> en op <b>Add App Account</b>. Er verschijnt een QR-code.',
  'Open op je telefoon de app <b>Smart Life</b>. Tik onderin op <b>Ik</b> en dan rechtsboven op het <b>scan-knopje</b>.',
  'Scan de QR-code op je computerscherm en tik op <b>Bevestigen</b>.',
  'Je stekker staat nu in de lijst op de website. Zie je hem niet? Ververs de pagina.',
], W.d.lsc ? 8 : 7, () => sTuyaVerleng(), SCH.koppel());
const sTuyaVerleng = () => stap(`Stap ${W.d.lsc ? 5 : 4}: verleng de gratis periode naar 6 maanden`, [
  'Tuya geeft je eerst maar <b>1 maand</b> gratis. Verleng dat nu meteen, dan hoef je er lang niet aan te denken.',
  'Klik links in het menu op <b>Cloud</b>, dan op <b>Cloud Services</b>. Zoek <b>IoT Core</b> en klik op <b>View Details</b>.',
  'Klik op <b>Extend Trial Period</b>. Kies <b>6 months</b>, vul bij de vragen in dat je het voor thuis gebruikt (<i>personal smart home</i>, minder dan 50 apparaten) en verstuur.',
  'Meestal is het binnen een dag goedgekeurd. Het blijft gratis. Is het over 6 maanden weer verlopen? Dan stuurt Stroomwekker je een bericht en verleng je het op dezelfde manier.',
], W.d.lsc ? 8 : 7, () => sTuyaCodes(), SCH.verleng());
const sTuyaCodes = () => ({ t: `Stap ${W.d.lsc ? 6 : 5}: neem 2 codes over`, of: W.d.lsc ? 8 : 7,
  p: 'Kopieer de 2 codes van de Tuya-website en plak ze hieronder. Daarna zoeken wij zelf je stekker op.',
  html: SCH.codes() + veldHTML('wA', '1. Access ID', 'Het "gebruikersnummer" van je project.', 'Op de Tuya-website, in je project, tabblad <b>Overview</b>. Staat bij <i>Access ID/Client ID</i>.', 'bijv. k8xq3m7rw2c9vn5tyhpe', '^[a-zA-Z0-9]{16,32}$')
    + veldHTML('wS', '2. Access Secret', 'Het "wachtwoord" van je project. Deel het met niemand anders.', 'Ook bij <b>Overview</b>, onder de Access ID, bij <i>Access Secret/Client Secret</i>. Klik op het oogje om hem te zien.', 'bijv. 4f9c2a7e…  (32 tekens)', '^[a-zA-Z0-9]{24,40}$')
    + '<p class="hint">Tip: heb je beide codes samen gekopieerd? Plak ze gewoon in één vak. Wij zetten ze zelf op de goede plek.</p>'
    + zoekHTML.replace('__VELD__', veldHTML('wD', 'Device ID', 'Het nummer van je stekker.', 'Tabblad <b>Devices</b>, dan <b>All Devices</b>. Staat in de kolom <i>Device ID</i>.', 'bijv. bf3a1c9e8d7f6a5b4c', '^[a-zA-Z0-9]{10,32}$'))
    + '<p class="hint" style="margin-top:12px">Gekozen? Tik op <b>Test: zet aan</b>. Gaat je stekker aan? Dan klopt alles.</p>' + testRow,
  after: () => { wireVelden(); wireZoek(); wireTest(); } });

// ---- Easee-laadpaal: inloggen, laadpaal kiezen, testen ----
const sEasee = () => ({ t: 'Koppel je Easee-laadpaal', of: 3,
  p: 'Log in met je Easee-account (hetzelfde als in de Easee-app). Wij bewaren je wachtwoord niet: we krijgen van Easee alleen een sleutel om laden te pauzeren en te hervatten.',
  html: `<label class="veld">E-mailadres of telefoonnummer van je Easee-account<input id="eUser" autocomplete="username"></label>
    <label class="veld">Wachtwoord<input id="ePass" type="password" autocomplete="current-password"></label>
    <button class="btn" type="button" id="eLogin">Koppelen</button><p class="msg" id="eMsg" role="status"></p>
    <div id="eLijst" class="opts"></div><input type="hidden" id="wD">
    <div id="eTest" hidden><p class="hint" style="margin-top:12px">Zit je auto aan de laadpaal? Tik op <b>Test: zet aan</b>. De laadpaal begint dan te laden (of blijft laden).</p>${testRow}</div>`,
  after: () => {
    const zeg = (t, ok) => { $('eMsg').textContent = t; $('eMsg').className = 'msg ' + (ok ? 'ok' : 'err'); if (!ok) W.d.fout = t; };
    $('eLogin').onclick = async () => {
      zeg('Even geduld…', true);
      try {
        const r = await api({ action: 'easee-login', user: $('eUser').value.trim(), password: $('ePass').value });
        $('ePass').value = '';
        W.d.easee = { eAccess: r.eAccess, eRefresh: r.eRefresh, eExp: r.eExp };
        if (!r.chargers.length) { zeg('We vonden geen laadpaal bij dit account.'); return; }
        zeg('✓ Gekoppeld. Tik op je laadpaal:', true);
        $('eLijst').innerHTML = r.chargers.map((c, i) => `<button class="opt" type="button" data-i="${i}"><span>${svg('car')}</span><div><b>${esc(c.name)}</b><small>${esc(c.id)}</small></div></button>`).join('');
        $('eLijst').querySelectorAll('[data-i]').forEach(b => b.onclick = () => { $('wD').value = r.chargers[+b.dataset.i].id; $('eLijst').querySelectorAll('.opt').forEach(o => o.classList.toggle('sel', o === b)); $('eTest').hidden = false; });
        if (r.chargers.length === 1) $('eLijst').querySelector('[data-i]').click();
      } catch (e) { zeg(e.message); }
    };
    wireTest();
  } });
const sLaadAnders = () => ({ t: 'Andere laadpaal of Tesla', of: 3, html: '<ol class="kstap">' + [
  'Kijk eerst in de app van je laadpaal of auto. Veel laadpalen en Tesla hebben zelf een stand voor <b>slim laden</b> of <b>dynamisch tarief</b>. Zet die aan: dat is het makkelijkst.',
  'Heb je Homey, Home Assistant of IFTTT? Dan kun je je laadpaal koppelen met een eigen link. Stroomwekker roept die link aan als laden goedkoop is.',
  'Laad je met een gewone stekker of een laadkabel in het stopcontact? Kies dan je slimme stekker. Let op: een slimme stekker kan meestal maximaal 3.680 watt aan.',
].map(x => `<li><span>${x}</span></li>`).join('') + '</ol>', opts: [
  { i: '⚙️', l: 'Ik heb Homey, Home Assistant of IFTTT', go: () => { wizClose(); openMeer(); openDev(null); $('dName').value = 'Auto laden'; $('dKind').value = 'webhook'; $('dRule').value = 'cheapest'; $('dHrs').value = '6'; kindUI(); ruleUI(); $('apparaten').scrollIntoView({ behavior: 'smooth' }); } },
  { i: '🔌', l: 'Ik laad met een slimme stekker', go: () => { W.d.preset = 'auto'; go(() => ({ ...sStekker(), opts: sStekker().opts.filter(o => !/Easee|Andere laadpaal/.test(o.l)) })); } },
] });

// ---- Shelly ----
const sShelly = () => stap('Stap 1: zoek je Shelly-gegevens op', [
  'Open de <b>Shelly-app</b> (Shelly Smart Control) op je telefoon.',
  'Tik onderin op <b>Instellingen</b> (het tandwieltje) en dan op <b>Gebruikersinstellingen</b>.',
  'Tik op <b>Autorisatie cloud-sleutel</b> en dan op <b>Sleutel ophalen</b>. Je ziet nu een <b>servernaam</b> en een lange <b>sleutel</b>.',
  'Houd deze app open. In de volgende stap neem je de gegevens over.',
], 3, () => sShellyCodes());
const sShellyCodes = () => ({ t: 'Stap 2: neem 2 gegevens over', of: 3,
  p: 'Kopieer de gegevens uit de Shelly-app en plak ze hieronder. Daarna zoeken wij zelf je stekker op.',
  html: veldHTML('wH', '1. Servernaam', 'Het adres van de Shelly-server waar jouw account op staat.', 'In de Shelly-app bij <b>Autorisatie cloud-sleutel</b>. Begint met <i>shelly-</i> en eindigt op <i>shelly.cloud</i>.', 'bijv. shelly-49-eu.shelly.cloud', '^(https?://)?shelly-\\d{1,3}-[a-z]{2,4}\\.shelly\\.cloud/?$')
    + veldHTML('wK', '2. Cloud-sleutel', 'De sleutel waarmee wij je Shelly mogen schakelen. Deel hem met niemand anders.', 'Op dezelfde plek, onder de servernaam. Een lange code van letters en cijfers.', 'bijv. MTc4ZjN1aWQ…', '^\\S{20,}$')
    + '<p class="hint">Tip: plak je servernaam en sleutel samen in één vak? Dan zetten wij ze zelf op de goede plek.</p>'
    + zoekHTML.replace('__VELD__', veldHTML('wD', 'Device ID', 'Het nummer van je Shelly-stekker.', 'Tik in de app op je stekker, dan op <b>Instellingen</b> en <b>Apparaatinformatie</b>. Staat bij <i>Apparaat-ID</i>.', 'bijv. b48a0a1cd978', '^[a-zA-Z0-9]{6,20}$'))
    + '<p class="hint" style="margin-top:12px">Gekozen? Tik op <b>Test: zet aan</b>. Gaat je stekker aan? Dan klopt alles.</p>' + testRow,
  after: () => { wireVelden(); wireZoek(); wireTest(); } });
const sKlaarApparaat = () => {
  const p = PRESETS[W.d.preset || 'anders'];
  if (W.d.rule?.type === 'warmte') return { t: 'Klaar', of: 4, html: `<div class="bigok">${svg("check")}</div><p>Vanaf nu mag je warmtepomp alleen draaien als stroom goedkoper verwarmt dan gas. Is gas goedkoper, dan neemt je cv-ketel het over.</p>`, opts: [{ i: '✅', l: 'Klaar', go: wizClose }] };
  return { t: 'Klaar', of: 4, html: `<div class="bigok">${svg("check")}</div><p>Je ${W.d.rule?.type === 'battery' ? 'batterij laadt' : p.name.toLowerCase() + ' gaat'} vanaf nu vanzelf aan <b>${W.d.rule?.type === 'battery' ? 'als stroom het goedkoopst is' : p.uitleg}</b>. Je hoeft niets meer te doen.</p>`,
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
  ['gasmorgen', '🔥', 'Als gas morgen veel goedkoper of duurder wordt', {}],
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
  const mailKeuze = '<div class="mailalt"><p><b>Makkelijker: krijg elke ochtend één mail met de beste tijden.</b></p><div class="mailrij"><input id="wMail" type="email" autocomplete="email" placeholder="naam@voorbeeld.nl" aria-label="Je e-mailadres"><button class="btn btn-sm" id="wMailOk" type="button">Per e-mail</button></div><p class="msg" id="wMailMsg" role="status"></p></div>';
  const html = ios ? '<p><b>Nog één ding:</b> op een iPhone moet je Stroomwekker eerst op je beginscherm zetten. Tik onderin op <b>Deel</b> en kies <b>Zet op beginscherm</b>. Open de app daarna via je beginscherm en zet berichten aan.</p>' + mailKeuze
    : perm === 'granted' ? '<div class="bigok">'+svg('bell')+'</div><p>Je krijgt vanaf nu een bericht op dit apparaat. Ook als de site dicht is.</p>'
    : '<p>Je browser staat berichten nog niet toe. Tik op het slotje naast het webadres en zet <b>Meldingen</b> aan. Probeer het daarna opnieuw.</p>' + mailKeuze;
  return { t: perm === 'granted' && !ios ? 'Klaar' : 'Bijna klaar', of: 3, html, opts: [{ i: '✅', l: 'Sluiten', go: wizClose }],
    after: () => { $('wMailOk') && ($('wMailOk').onclick = () => slaMailOp($('wMail').value.trim(), true, $('wMailMsg'))); } };
};
function addAlert(a, quiet) {
  if (!alerts.some(x => x.type === a.type && (a.type !== 'timer' || x.name === a.name))) alerts.push({ id: crypto.randomUUID(), value: 0, hours: 1, ...a });
  if (!quiet) { renderAlerts(); sync().catch(() => {}); }
}

// ---- Verwarmen: hybride warmtepomp of cv-ketel ----
const sWarmte = () => ({ t: 'Hoe verwarm je je huis?', opts: [
  { i: '♨️', l: 'Met een hybride warmtepomp', s: 'Een warmtepomp samen met een cv-ketel op gas', go: () => go(sHybride) },
  { i: '🔥', l: 'Alleen met een cv-ketel op gas', s: 'Krijg een bericht als gas morgen veel goedkoper of duurder wordt', go: async () => { addAlert({ type: 'gasmorgen' }); await enablePush(); go(sKlaarBericht); } },
] });
function warmteUitleg() {
  const cur = data && current(data.quarters, Date.now()), w = cur && warmte(cur, settings);
  return w ? `<div class="timerkaart"><small>Nu, met de prijzen van vandaag</small><b>${w.beter === 'stroom' ? 'Stook met stroom' : 'Stook op gas'}</b><small>${w.temp != null ? `Buiten is het nu ${String(w.temp).replace('.', ',')} °C, dus je warmtepomp maakt ongeveer ${String(w.cop).replace('.', ',')} kWh warmte van 1 kWh stroom. ` : ''}Warmte uit stroom: ${ct(w.stroom)} cent per kWh. Uit gas: ${ct(w.gas)} cent per kWh. Stroom wint zolang hij onder ${ct(w.grens)} cent blijft.</small></div>` : '';
}
const sHybride = () => ({ t: 'Gas of stroom: wij rekenen het uit', html: warmteUitleg() + '<p>Een warmtepomp is bijna altijd goedkoper dan gas. Maar bij een dynamisch contract is stroom soms zó duur, vaak tussen 17:00 en 20:00, dat je cv-ketel dan goedkoper stookt. Heeft je warmtepomp zelf een stand voor dynamische prijzen? Zet die dan aan. Dat is het makkelijkst.</p>', opts: [
  { i: '🔔', l: 'Stuur mij een bericht als ik beter op gas kan stoken', s: 'En weer als de warmtepomp goedkoper is', go: async () => { addAlert({ type: 'warmte', value: COP }); await enablePush(); go(sKlaarBericht); } },
  { i: '🔌', l: 'Vanzelf omschakelen', s: 'Met een Shelly-schakelaar of Homey, Home Assistant of IFTTT. Laat een installateur dit aansluiten.', go: () => go(sHybrideAuto) },
] });
const sHybrideAuto = () => ({ t: 'Vanzelf omschakelen', of: 4, html: '<ol class="kstap">' + [
  'Veel hybride warmtepompen hebben een aansluiting om de warmtepomp tijdelijk te blokkeren (soms "SG Ready" of "externe vrijgave" genoemd). Een installateur kan daar een slimme schakelaar op zetten, zoals een <b>Shelly 1</b>.',
  'Stroomwekker zet die schakelaar <b>aan</b> als stroom goedkoper verwarmt dan gas, en <b>uit</b> als gas goedkoper is. Je cv-ketel neemt het dan over.',
  'Werk nooit zelf in je warmtepomp of meterkast. Laat dit altijd door een installateur doen. Schakelen via Stroomwekker is op eigen risico: controleer bij je installateur of je warmtepomp hiervoor geschikt is.',
].map(x => `<li><span>${x}</span></li>`).join('') + '</ol>', opts: [
  { i: '🔵', l: 'Ik heb een Shelly-schakelaar', go: () => { W.d.kind = 'shelly'; W.d.preset = 'anders'; W.d.name = 'Warmtepomp'; W.d.rule = { type: 'warmte', cop: COP }; go(sShelly); } },
  { i: '⚙️', l: 'Ik heb Homey, Home Assistant of IFTTT', go: () => { wizClose(); openMeer(); openDev(null); $('dName').value = 'Warmtepomp'; $('dKind').value = 'webhook'; $('dRule').value = 'warmte'; kindUI(); ruleUI(); $('apparaten').scrollIntoView({ behavior: 'smooth' }); } },
] });

const sAutoStart = () => { W.d.preset = 'auto'; return sStekker(); };
const FLOWS = { auto: sAutoStart, warmte: sWarmte, apparaat: sApparaat, batterij: sBatterij, zon: sZon, bericht: sBerichtKies };
document.querySelectorAll('[data-flow]').forEach(b => b.onclick = () => wizOpen(FLOWS[b.dataset.flow]));
{ const st = new URLSearchParams(location.search).get('start'); if (FLOWS[st]) { history.replaceState(null, '', location.pathname); setTimeout(() => wizOpen(FLOWS[st]), 300); } }
function openMeer() { $('meer').open = true; }
$('navStart') && ($('navStart').onclick = e => { e.preventDefault(); scrollTo({ top: 0, behavior: 'smooth' }); });
$('footMeer') && ($('footMeer').onclick = e => { e.preventDefault(); openMeer(); $('meer').scrollIntoView({ behavior: 'smooth' }); });
$('navMeer') && ($('navMeer').onclick = e => { e.preventDefault(); openMeer(); $('meer').scrollIntoView({ behavior: 'smooth' }); });
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

// ---------- Menu rechtsboven: doelen op deze pagina openen ----------
function naarDoel() {
  const h = location.hash;
  if (!h) return;
  const m = document.querySelector('.hmenu'); if (m) m.open = false;
  if (h === '#instellingen' || h === '#inloggen') { openMeer(); if (h === '#inloggen') { const d = $('loginMail')?.closest('details'); if (d) d.open = true; } }
  if (h === '#installeren') { installeer(); return; }
  const doel = h === '#inloggen' ? $('loginMail') : document.querySelector(h);
  if (doel) setTimeout(() => doel.scrollIntoView({ behavior: 'smooth', block: h === '#inloggen' ? 'center' : 'start' }), 50);
}
addEventListener('hashchange', naarDoel); setTimeout(naarDoel, 400);
document.querySelectorAll('.hmenu a').forEach(a => a.addEventListener('click', ev => { const m = a.closest('.hmenu'); if (m) m.open = false;
  const u = new URL(a.href); if (u.pathname === location.pathname && u.searchParams.get('start') && FLOWS[u.searchParams.get('start')]) { a.blur(); ev.preventDefault(); wizOpen(FLOWS[u.searchParams.get('start')]); }
  else if (u.pathname === location.pathname && u.hash && u.hash === location.hash) naarDoel(); }));
addEventListener('click', e => { const m = document.querySelector('.hmenu[open]'); if (m && !m.contains(e.target)) m.open = false; });
addEventListener('keydown', e => { if (e.key === 'Escape') { const m = document.querySelector('.hmenu[open]'); if (m) { m.open = false; m.querySelector('summary').focus(); } } });
