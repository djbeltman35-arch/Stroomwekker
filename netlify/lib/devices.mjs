// Apparaten schakelen via de cloud: Shelly Cloud of een webhook (IFTTT, Home Assistant, Homey, Smart Life via IFTTT, ...).

// Tuya Cloud (ook LSC Smart Connect van Action, Smart Life, Hema, Calex, Nedis, ...)
const TUYA_HOSTS = { eu: 'openapi.tuyaeu.com', weu: 'openapi-weaz.tuyaeu.com', us: 'openapi.tuyaus.com', cn: 'openapi.tuyacn.com', in: 'openapi.tuyain.com' };
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async txt => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)));
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg))).toUpperCase();
}
async function tuyaRequest(d, method, path, body, token = '') {
  const t = String(Date.now()), nonce = crypto.randomUUID().replace(/-/g, '');
  const raw = body ? JSON.stringify(body) : '';
  const stringToSign = [method, await sha256(raw), '', path].join('\n');
  const sign = await hmac(d.accessSecret, d.accessId + token + t + nonce + stringToSign);
  const headers = { client_id: d.accessId, sign, t, nonce, sign_method: 'HMAC-SHA256', 'Content-Type': 'application/json' };
  if (token) headers.access_token = token;
  const r = await fetch(`https://${TUYA_HOSTS[d.region] || TUYA_HOSTS.eu}${path}`, { method, headers, body: raw || undefined, signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  if (!j.success) {
    const m = String(j.msg || '');
    const verlopen = /expire|subscription|quota|trial/i.test(m) || j.code === 28841002 || j.code === 28841105;
    const nl = verlopen ? 'De gratis Tuya-koppeling (IoT Core) is verlopen. Verleng hem op platform.tuya.com: Cloud, Cloud Services, IoT Core, View Details, Extend Trial Period (kies 6 maanden)'
      : /clientId/i.test(m) ? 'De Access ID klopt niet' : /sign/i.test(m) ? 'De Access Secret klopt niet'
      : /offline/i.test(m) ? 'De stekker is offline. Staat hij aan en heeft hij wifi?'
      : /permission|not exist|no permissions/i.test(m) ? 'Deze stekker hoort niet bij je Tuya-project, of de gratis IoT Core-periode is verlopen'
      : m || 'fout ' + (j.code || r.status);
    throw new Error('Tuya: ' + nl);
  }
  return j.result;
}
async function tuyaSwitch(d, on) {
  const tok = await tuyaRequest(d, 'GET', '/v1.0/token?grant_type=1');
  await tuyaRequest(d, 'POST', `/v1.0/iot-03/devices/${d.deviceId}/commands`, { commands: [{ code: d.code || 'switch_1', value: !!on }] }, tok.access_token);
}

// ---------- Easee-laadpaal (rechtstreeks via de Easee-cloud) ----------
// We bewaren nooit het wachtwoord, alleen de sleutels (tokens) die Easee teruggeeft. Een refresh-token werkt één keer:
// na elke verversing bewaren we de nieuwe (het apparaat-object wordt aangepast en daarna opgeslagen).
const EASEE = 'https://api.easee.com/api';
async function easeeJSON(pad, opt = {}) {
  const r = await fetch(EASEE + pad, { ...opt, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opt.headers || {}) }, signal: AbortSignal.timeout(10000) });
  const t = await r.text(); let j = {}; try { j = t ? JSON.parse(t) : {}; } catch { /* geen JSON */ }
  if (!r.ok) throw new Error(r.status === 401 || r.status === 400 ? 'Easee: inloggen lukt niet (klopt je e-mailadres en wachtwoord?)' : `Easee antwoordde ${r.status}`);
  return j;
}
export async function easeeLogin(userName, password) {
  const j = await easeeJSON('/accounts/login', { method: 'POST', body: JSON.stringify({ userName, password }) });
  const tok = { eAccess: j.accessToken, eRefresh: j.refreshToken, eExp: Date.now() + (Number(j.expiresIn) || 3600) * 1000 };
  const lijst = await easeeJSON('/chargers', { headers: { Authorization: 'Bearer ' + tok.eAccess } });
  return { ...tok, chargers: (Array.isArray(lijst) ? lijst : []).map(c => ({ id: c.id, name: c.name || c.id })) };
}
async function easeeToken(d) {
  if (d.eAccess && d.eExp > Date.now() + 120e3) return d.eAccess;
  const j = await easeeJSON('/accounts/refresh_token', { method: 'POST', body: JSON.stringify({ accessToken: d.eAccess, refreshToken: d.eRefresh }) }).catch(() => {
    throw new Error('Easee: de koppeling is verlopen. Koppel je laadpaal opnieuw in Stroomwekker.'); });
  d.eAccess = j.accessToken; d.eRefresh = j.refreshToken; d.eExp = Date.now() + (Number(j.expiresIn) || 3600) * 1000;
  return d.eAccess;
}

// ---------- Stekkers opzoeken bij een account (zodat niemand een apparaatnummer hoeft over te typen) ----------
export async function listDevices(d) {
  if (d.kind === 'tuya') {
    const tok = (await tuyaRequest(d, 'GET', '/v1.0/token?grant_type=1')).access_token;
    let lijst = [];
    try {
      const r = await tuyaRequest(d, 'GET', '/v2.0/cloud/thing/device?page_size=20', null, tok);
      lijst = (Array.isArray(r) ? r : r?.list || []).map(x => ({ id: x.id, name: x.customName || x.name, online: x.isOnline }));
    } catch (e) {
      if (/verlopen|Access/.test(e.message)) throw e;
      const r = await tuyaRequest(d, 'GET', '/v1.0/iot-01/associated-users/devices?size=50', null, tok);
      lijst = (r?.devices || []).map(x => ({ id: x.id, name: x.name, online: x.online }));
    }
    return lijst.filter(x => x.id).slice(0, 30);
  }
  if (d.kind === 'shelly') {
    const post = async pad => {
      const r = await fetch(`https://${d.host}${pad}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'auth_key=' + encodeURIComponent(d.key), signal: AbortSignal.timeout(8000) });
      if (r.status === 401) throw new Error('Shelly: de cloud-sleutel klopt niet of hoort bij een andere server');
      const j = await r.json().catch(() => ({}));
      if (!j.isok) throw new Error('Shelly: ' + (Object.values(j.errors || {})[0] || 'de gegevens kloppen niet'));
      return j.data || {};
    };
    const st = (await post('/device/all_status')).devices_status || {};
    let namen = {};
    try { namen = (await post('/interface/device/get_all_lists')).devices || {}; } catch { /* namen zijn een extraatje */ }
    return Object.entries(st).map(([id, x]) => {
      const sw = x['switch:0'] || x.relays?.[0];
      return { id, name: namen[id]?.name || 'Shelly ' + (x._dev_info?.code || ''), online: x._dev_info?.online ?? x.cloud?.connected, aan: sw ? !!(sw.output ?? sw.ison) : null };
    }).slice(0, 30);
  }
  return [];
}

// ---------- Verbruik meten (alleen stekkers met energiemeter) ----------
// Geeft { w, totalWh, est } terug, of null als de stekker geen verbruik meet.
export async function readMeter(d, cache = {}) {
  if (d.kind === 'shelly') {
    const r = await fetch(`https://${d.host}/v2/devices/api/get?auth_key=${encodeURIComponent(d.key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [d.deviceId], select: ['status'] }), signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error('Shelly antwoordde ' + r.status);
    const j = await r.json(); const st = (Array.isArray(j) ? j[0] : j)?.status || {};
    const ch = d.channel || 0;
    const g2 = st['switch:' + ch] || st['pm1:' + ch];
    if (g2 && typeof g2.apower === 'number') return { w: g2.apower, totalWh: g2.aenergy?.total ?? null, est: g2.aenergy?.total == null };
    const g1 = st.meters?.[ch] || st.emeters?.[ch];
    if (g1 && typeof g1.power === 'number') return { w: g1.power, totalWh: typeof g1.total === 'number' ? (st.emeters ? g1.total : g1.total / 60) : null, est: typeof g1.total !== 'number' };
    return null;
  }
  if (d.kind === 'tuya') {
    const tok = (await tuyaRequest(d, 'GET', '/v1.0/token?grant_type=1')).access_token;
    const list = await tuyaRequest(d, 'GET', `/v1.0/iot-03/devices/${d.deviceId}/status`, null, tok);
    const p = (list || []).find(x => x.code === 'cur_power');
    if (!p) return null;
    if (cache.scale == null) {
      cache.scale = 1;
      try {
        const spec = await tuyaRequest(d, 'GET', `/v1.0/iot-03/devices/${d.deviceId}/specification`, null, tok);
        const v = JSON.parse((spec.status || []).find(x => x.code === 'cur_power')?.values || '{}');
        if (Number.isFinite(v.scale)) cache.scale = v.scale;
      } catch { /* standaard schaal 1 */ }
    }
    return { w: Number(p.value) / 10 ** cache.scale, totalWh: null, est: true };
  }
  return null; // eigen link: geen meting mogelijk
}

const SHELLY_HOST = /^shelly-\d{1,3}-[a-z]{2,4}\.shelly\.cloud$/;

function safeUrl(u) {
  let url;
  try { url = new URL(u); } catch { throw new Error('Ongeldige link'); }
  if (url.protocol !== 'https:') throw new Error('Link moet met https:// beginnen');
  const h = url.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^[\d.]+$/.test(h) || h.includes(':') || !h.includes('.'))
    throw new Error('Alleen openbare internetadressen zijn toegestaan');
  return url;
}

export function validateDevice(d) {
  if (!d || typeof d !== 'object') throw new Error('Geen apparaat');
  const name = String(d.name || '').slice(0, 40).trim() || 'Apparaat';
  const rule = d.rule || {};
  const cleanRule = rule.type === 'cheap' ? { type: 'cheap' }
    : rule.type === 'battery'
    ? { type: 'battery', hours: Math.max(0.25, Math.min(12, Number(rule.hours) || 3)) }
    : rule.type === 'warmte'
    ? { type: 'warmte', cop: Math.max(2, Math.min(6, Number(rule.cop) || 3.5)) }
    : rule.type === 'solar'
    ? { type: 'solar', limit: Math.max(-0.5, Math.min(0.2, Number(rule.limit) || 0)) }
    : rule.type === 'cheapest'
    ? { type: 'cheapest', hours: Math.max(0.25, Math.min(24, Number(rule.hours) || 1)), block: !!rule.block }
    : { type: 'below', on: Number(rule.on), off: rule.off === '' || rule.off == null ? Number(rule.on) : Number(rule.off) };
  if (cleanRule.type === 'below' && !Number.isFinite(cleanRule.on)) throw new Error('Vul een prijsgrens in');
  const base = { id: String(d.id || crypto.randomUUID()).slice(0, 40), name, rule: cleanRule, enabled: d.enabled !== false, notify: d.notify !== false };
  if (d.kind === 'shelly') {
    const host = String(d.host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!SHELLY_HOST.test(host)) throw new Error('Servernaam moet lijken op shelly-49-eu.shelly.cloud');
    const key = String(d.key || '').trim(), deviceId = String(d.deviceId || '').trim();
    if (key.length < 20) throw new Error('Cloud-sleutel lijkt niet compleet');
    if (!/^[a-zA-Z0-9]{6,20}$/.test(deviceId)) throw new Error('Device ID klopt niet');
    return { ...base, kind: 'shelly', host, key, deviceId, channel: Math.max(0, Math.min(3, parseInt(d.channel) || 0)) };
  }
  if (d.kind === 'easee') {
    const deviceId = String(d.deviceId || '').trim();
    if (!/^[A-Za-z0-9]{4,20}$/.test(deviceId)) throw new Error('Kies je laadpaal');
    if (!d.eRefresh || String(d.eRefresh).length < 10) throw new Error('Koppel eerst je Easee-account');
    return { ...base, kind: 'easee', deviceId, eAccess: String(d.eAccess || ''), eRefresh: String(d.eRefresh), eExp: Number(d.eExp) || 0 };
  }
  if (d.kind === 'tuya') {
    const region = TUYA_HOSTS[d.region] ? d.region : 'eu';
    const accessId = String(d.accessId || '').trim(), accessSecret = String(d.accessSecret || '').trim(), deviceId = String(d.deviceId || '').trim();
    if (!/^[a-z0-9]{16,32}$/i.test(accessId)) throw new Error('Access ID klopt niet (zie Tuya-project → Overview)');
    if (!/^[a-z0-9]{24,40}$/i.test(accessSecret)) throw new Error('Access Secret klopt niet');
    if (!/^[a-z0-9]{10,32}$/i.test(deviceId)) throw new Error('Device ID klopt niet (zie Tuya-project → Devices)');
    const code = /^[a-z0-9_]{3,20}$/.test(d.code || '') ? d.code : 'switch_1';
    return { ...base, kind: 'tuya', region, accessId, accessSecret, deviceId, code };
  }
  const onUrl = safeUrl(d.onUrl).href, offUrl = d.offUrl ? safeUrl(d.offUrl).href : '';
  const supplyUrl = cleanRule.type === 'battery' && d.supplyUrl ? safeUrl(d.supplyUrl).href : '';
  return { ...base, kind: 'webhook', onUrl, offUrl, supplyUrl, method: d.method === 'GET' ? 'GET' : 'POST' };
}

export async function switchDevice(d, on) {
  if (d.kind === 'easee') {
    const tok = await easeeToken(d);
    await easeeJSON(`/chargers/${d.deviceId}/commands/${on ? 'resume_charging' : 'pause_charging'}`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok } });
    return 'ok';
  }
  if (d.kind === 'tuya') { await tuyaSwitch(d, on); return 'ok'; }
  if (d.kind === 'shelly') {
    const r = await fetch(`https://${d.host}/v2/devices/api/set/switch?auth_key=${encodeURIComponent(d.key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: d.deviceId, channel: d.channel || 0, on }),
      signal: AbortSignal.timeout(8000),
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`Shelly antwoordde ${r.status}: ${txt.slice(0, 120)}`);
    return 'ok';
  }
  // on: true = aan/laden, false = uit/stoppen, 'supply' = batterij levert stroom
  const url = on === 'supply' ? d.supplyUrl : on ? d.onUrl : d.offUrl;
  if (!url) return 'geen uit-link';
  safeUrl(url);
  const r = await fetch(url, {
    method: d.method || 'POST', redirect: 'manual', signal: AbortSignal.timeout(8000),
    headers: d.method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: d.method === 'GET' ? undefined : JSON.stringify({ state: on === 'supply' ? 'supply' : on ? 'on' : 'off', source: 'stroomwekker' }),
  });
  if (r.status >= 400) throw new Error(`Link antwoordde ${r.status}`);
  return 'ok';
}
