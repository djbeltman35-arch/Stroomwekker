export default async () => Response.json({ key: process.env.VAPID_PUBLIC_KEY || null },
  { headers: { 'Cache-Control': 'public, max-age=3600' } });

export const config = { path: '/api/vapid' };
