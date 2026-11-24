// /api/vastetijd?uren=2 : de beste vaste tijd voor een dagelijkse timer (afgelopen 4 weken)
import { vasteTijd } from '../lib/vastetijd.mjs';

export default async (req) => {
  const uren = Number(new URL(req.url).searchParams.get('uren')) || 2;
  try {
    return Response.json(await vasteTijd(uren), { headers: { 'Cache-Control': 'public, max-age=600', 'Netlify-CDN-Cache-Control': 'public, s-maxage=3600' } });
  } catch {
    return Response.json({ error: 'De prijzen zijn even niet bereikbaar.' }, { status: 502 });
  }
};

export const config = { path: '/api/vastetijd' };
