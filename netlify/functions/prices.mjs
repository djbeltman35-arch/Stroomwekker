import { getPrices } from '../lib/data.mjs';

export default async () => {
  try {
    const data = await getPrices();
    return Response.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=60',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600',
      },
    });
  } catch (e) {
    return Response.json({ error: 'Prijzen tijdelijk niet beschikbaar' }, { status: 502 });
  }
};

export const config = { path: '/api/prices' };
