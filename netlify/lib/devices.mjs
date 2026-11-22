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
    const nl = /clientId/i.test(m) ? 'De Access ID klopt niet' : /sign/i.test(m) ? 'De Access Secret klopt niet'
      : /offline/i.test(m) ? 'De stekker is offline. Staat hij aan en heeft hij wifi?'
      : /permission|not exist|no permissions/i.test(m) ? 'Deze stekker hoort niet bij je Tuya-project, of de gratis IoT Core-periode is verlopen'
      : /expire/i.test(m) ? 'Je Tuya-proefperiode is verlopen. Verleng IoT Core op platform.tuya.com' : m || 'fout ' + (j.code || r.status);
    throw new Error('Tuya: ' + nl);
  }
  return j.result;
}
async function tuyaSwitch(d, on) {
  const tok = await tuyaRequest(d, 'GET', '/v1.0/token?grant_type=1');
  await tuyaRequest(d, 'POST', `/v1.0/iot-03/devices/${d.deviceId}/commands`, { commands: [{ code: d.code || 'switch_1', value: !!on }] }, tok.access_token);
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
  const cleanRule = rule.type === 'battery'
    ? { type: 'battery', hours: Math.max(0.25, Math.min(12, Number(rule.hours) || 3)) }
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
