import { getStore } from '@netlify/blobs';

const mem = new Map(); // alleen voor lokaal testen (DEV_MEMORY=1)
const memStore = {
  async get(k) { return mem.has(k) ? JSON.parse(mem.get(k)) : null; },
  async setJSON(k, v) { mem.set(k, JSON.stringify(v)); },
  async delete(k) { mem.delete(k); },
  async list({ prefix = '' } = {}) { return { blobs: [...mem.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
};
export const store = () => process.env.DEV_MEMORY ? memStore : getStore({ name: 'accounts', consistency: 'strong' });

// De sleutel van de gebruiker (lang, willekeurig, alleen in diens browser) wordt gehasht opgeslagen.
export async function keyFor(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) throw new Error('Ongeldige sleutel');
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return 'a/' + [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
