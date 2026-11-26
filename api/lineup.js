import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.STORAGE_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.STORAGE_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

const LINEUP_KEY = 'miko_chotu_sangeet_lineup_v1';
const ADMIN_PIN = process.env.ADMIN_PIN || '2026';

function normalizeSide(rawSide) {
  if (rawSide === "Groom's Side" || rawSide === 'Team Groom') return "Groom's Side";
  return "Bride's Side";
}

function isAuthorizedAdmin(req) {
  const providedPin = req.headers['x-admin-pin'];
  return Boolean(providedPin && String(providedPin) === String(ADMIN_PIN));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    // 1. GET — Public read-only fetch of the live lineup
    if (req.method === 'GET') {
      const raw = await redis.get(LINEUP_KEY);
      const entries = Array.isArray(raw) ? raw : [];
      return res.status(200).json({ entries });
    }

    // 2. POST — Public registration only (appends a new act)
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

      // Verify Admin PIN endpoint check
      if (body?.action === 'verify_admin') {
        if (isAuthorizedAdmin(req)) {
          return res.status(200).json({ authorized: true });
        }
        return res.status(401).json({ error: 'Invalid Admin PIN' });
      }

      if (!body || !body.name || !String(body.name).trim()) {
        return res.status(400).json({ error: 'Performer name is required' });
      }

      const format = body.format === 'Group' ? 'Group' : 'Solo';
      const minutes = [10, 15, 20].includes(Number(body.minutes)) ? Number(body.minutes) : 10;

      const newEntry = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        category: ['Sing', 'Dance', 'Act'].includes(body.category) ? body.category : 'Dance',
        side: normalizeSide(body.side),
        name: String(body.name).trim().slice(0, 120),
        duration: `${minutes}m`,
        minutes,
        sideMen: Math.min(50, Math.max(0, parseInt(body.sideMen, 10) || 0)),
        sideWomen: Math.min(50, Math.max(0, parseInt(body.sideWomen, 10) || 0)),
        format,
        groupSize: format === 'Group' ? Math.min(100, Math.max(2, parseInt(body.groupSize, 10) || 5)) : 1,
      };

      const raw = await redis.get(LINEUP_KEY);
      const entries = Array.isArray(raw) ? raw : [];
      entries.push(newEntry);

      await redis.set(LINEUP_KEY, entries);
      return res.status(200).json({ entries, entry: newEntry });
    }

    // 3. PUT — Admin-only modifications (Delete, Clear All, Reorder)
    if (req.method === 'PUT') {
      if (!isAuthorizedAdmin(req)) {
        return res.status(401).json({ error: 'Admin authorization required' });
      }

      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const entries = Array.isArray(body?.entries) ? body.entries : [];

      await redis.set(LINEUP_KEY, entries);
      return res.status(200).json({ entries });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Sangeet API Error:', error);
    return res.status(500).json({ error: 'Database sync failed' });
  }
}
