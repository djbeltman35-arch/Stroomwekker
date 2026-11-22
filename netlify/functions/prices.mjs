import { loadPrices } from '../lib/data.mjs';

export default async () => {
  try {
    const data = await loadPrices();
    return Response.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=60',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
      },
    });
  } catch (e) {
    return Response.json({ error: 'Prijzen tijdelijk niet beschikbaar' }, { status: 502 });
  }
};

export const config = { path: '/api/prices' };
