import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Cache for Betbolt data (5 requests/hour for both endpoints = 30 min cache to stay under limit)
const betboltCache = {
  current: { data: null, timestamp: 0 },
  previous: { data: null, timestamp: 0 }
};
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds

// Get current month start and end (UTC)
function getCurrentMonthRangeUTC() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));
  return [start, end];
}

// Get previous month start and end (UTC)
function getPreviousMonthRangeUTC() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const start = new Date(Date.UTC(prevYear, prevMonth, 1, 0, 0, 0));
  const end = new Date(Date.UTC(prevYear, prevMonth + 1, 0, 23, 59, 59));
  return [start, end];
}

// Mask usernames (first 2 letters + *** + last 2)
function maskUsername(username) {
  if (!username || typeof username !== 'string') return username;
  if (username.length <= 4) return username;
  return username.slice(0, 2) + '***' + username.slice(-2);
}

const [START_TIME, END_TIME] = getCurrentMonthRangeUTC();
const START_DATE = START_TIME.toISOString().split('T')[0];
const END_DATE = END_TIME.toISOString().split('T')[0];

const RAINBET_API_URL = `https://services.rainbet.com/v1/external/affiliates?start_at=${START_DATE}&end_at=${END_DATE}&key=2PdNm6HABPKuyW0jRXJismvlZ9b3Rils`;

// === /api/leaderboard/rainbet ===
app.get('/api/leaderboard/rainbet', async (req, res) => {
  try {
    const response = await fetch(RAINBET_API_URL);
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }
    const data = await response.json();
    const affiliates = Array.isArray(data.affiliates) ? data.affiliates : [];
    let leaderboard = affiliates.map(entry => ({
      name: maskUsername(entry.username),
      wager: parseFloat(entry.wagered_amount) || 0
    }));
    leaderboard.sort((a, b) => b.wager - a.wager);
    leaderboard = leaderboard.slice(0, 10);
    const prizes = [220, 170, 120, 50, 40, 0, 0, 0, 0, 0].map((reward, i) => ({ position: i + 1, reward }));
    res.json({
      leaderboard,
      prizes,
      startTime: START_TIME.toISOString(),
      endTime: END_TIME.toISOString()
    });
  } catch (error) {
    console.error('Error fetching rainbet leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch rainbet leaderboard data' });
  }
});

// === /api/prev-leaderboard/rainbet ===
app.get('/api/prev-leaderboard/rainbet', async (req, res) => {
  try {
    const [PREV_START_TIME, PREV_END_TIME] = getPreviousMonthRangeUTC();
    const PREV_START_DATE = PREV_START_TIME.toISOString().split('T')[0];
    const PREV_END_DATE = PREV_END_TIME.toISOString().split('T')[0];
    const PREV_API_URL = `https://services.rainbet.com/v1/external/affiliates?start_at=${PREV_START_DATE}&end_at=${PREV_END_DATE}&key=2PdNm6HABPKuyW0jRXJismvlZ9b3Rils`;
    const response = await fetch(PREV_API_URL);
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }
    const data = await response.json();
    const affiliates = Array.isArray(data.affiliates) ? data.affiliates : [];
    let leaderboard = affiliates.map(entry => ({
      name: maskUsername(entry.username),
      wager: parseFloat(entry.wagered_amount) || 0
    }));
    leaderboard.sort((a, b) => b.wager - a.wager);
    leaderboard = leaderboard.slice(0, 10);
    const prizes = [220, 170, 120, 50, 40, 0, 0, 0, 0, 0].map((reward, i) => ({ position: i + 1, reward }));
    res.json({
      leaderboard,
      prizes,
      startTime: PREV_START_TIME.toISOString(),
      endTime: PREV_END_TIME.toISOString()
    });
  } catch (error) {
    console.error('Error fetching previous rainbet leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch previous rainbet leaderboard data' });
  }
});

// === /api/countdown/rainbet ===
app.get('/api/countdown/rainbet', async (req, res) => {
  try {
    const now = Date.now();
    const totalDuration = END_TIME.getTime() - START_TIME.getTime();
    const elapsed = now - START_TIME.getTime();
    const percentageLeft = Math.max(0, Math.min(100, ((totalDuration - elapsed) / totalDuration) * 100));
    
    res.json({
      percentageLeft: parseFloat(percentageLeft.toFixed(2))
    });
  } catch (error) {
    console.error('Error calculating countdown:', error);
    res.status(500).json({ error: 'Failed to calculate countdown' });
  }
});

// === BETBOLT HELPER (with caching) ===
const BETBOLT_SECRET = process.env.BETBOLT_SECRET || 'bb_secret_key_0199b8fe743b74779b3623aaa7fbbda30d449aee4d8043c6';

async function fetchBetboltLeaderboard(from, to, options = {}) {
  const url = new URL('https://openapi.betbolt.com/v1/referral/leaderboard');
  url.searchParams.append('limit', options.limit ?? 100);
  url.searchParams.append('offset', options.offset ?? 0);
  url.searchParams.append('start_date', from.toISOString());
  url.searchParams.append('end_date', to.toISOString());
  url.searchParams.append('sort_by', options.sort_by ?? 'wager');
  url.searchParams.append('sort_order', options.sort_order ?? 'desc');
  if (options.categories) {
    url.searchParams.append('categories', options.categories);
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${BETBOLT_SECRET}`
    }
  });

  console.log(`[BETBOLT API] Called: ${url}`);
  console.log(`[BETBOLT API] Status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Betbolt fetch failed: ${response.status} ${text}`);
  }

  const result = await response.json();

  if (result && Array.isArray(result.data)) {
    console.log(`[BETBOLT API] Received ${result.data.length} results.`);
  } else {
    console.log('[BETBOLT API] Unexpected response:', result);
  }

  return result;
}

// === /api/leaderboard/betbolt (with cache) ===
app.get('/api/leaderboard/betbolt', async (req, res) => {
  try {
    const now = Date.now();
    
    // Check if cache is valid
    if (betboltCache.current.data && (now - betboltCache.current.timestamp) < CACHE_DURATION) {
      console.log('[BETBOLT] Serving from cache (current month)');
      return res.json(betboltCache.current.data);
    }

    // Fetch fresh data
    console.log('[BETBOLT] Cache expired or empty, fetching fresh data (current month)');
    const [START_TIME_LOCAL, END_TIME_LOCAL] = getCurrentMonthRangeUTC();
    const opts = {
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      sort_by: req.query.sort_by,
      sort_order: req.query.sort_order,
      categories: req.query.categories
    };
    const data = await fetchBetboltLeaderboard(START_TIME_LOCAL, END_TIME_LOCAL, opts);

    const entries = Array.isArray(data.data) ? data.data : [];
    let leaderboard = entries.map(entry => ({
      name: maskUsername(entry.username),
      wager: parseFloat(entry.wagered) || 0
    }));
    leaderboard.sort((a, b) => b.wager - a.wager);
    leaderboard = leaderboard.slice(0, 10);

    const prizes = [1000, 550, 275, 125, 50, 0, 0, 0, 0, 0].map((reward, i) => ({ position: i + 1, reward }));

    const responseData = {
      leaderboard,
      prizes,
      startTime: START_TIME_LOCAL.toISOString(),
      endTime: END_TIME_LOCAL.toISOString()
    };

    // Update cache
    betboltCache.current = {
      data: responseData,
      timestamp: now
    };

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching Betbolt leaderboard:', error);
    
    // If cache exists, serve stale data on error
    if (betboltCache.current.data) {
      console.log('[BETBOLT] Error occurred, serving stale cache');
      return res.json(betboltCache.current.data);
    }
    
    res.status(500).json({ error: error.message || 'Failed to fetch Betbolt leaderboard data' });
  }
});

// === /api/prev-leaderboard/betbolt (with cache) ===
app.get('/api/prev-leaderboard/betbolt', async (req, res) => {
  try {
    const now = Date.now();
    
    // Check if cache is valid
    if (betboltCache.previous.data && (now - betboltCache.previous.timestamp) < CACHE_DURATION) {
      console.log('[BETBOLT] Serving from cache (previous month)');
      return res.json(betboltCache.previous.data);
    }

    // Fetch fresh data
    console.log('[BETBOLT] Cache expired or empty, fetching fresh data (previous month)');
    const [PREV_START_TIME, PREV_END_TIME] = getPreviousMonthRangeUTC();
    const opts = {
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      sort_by: req.query.sort_by,
      sort_order: req.query.sort_order,
      categories: req.query.categories
    };
    const data = await fetchBetboltLeaderboard(PREV_START_TIME, PREV_END_TIME, opts);

    const entries = Array.isArray(data.data) ? data.data : [];
    let leaderboard = entries.map(entry => ({
      name: maskUsername(entry.username),
      wager: parseFloat(entry.wagered) || 0
    }));
    leaderboard.sort((a, b) => b.wager - a.wager);
    leaderboard = leaderboard.slice(0, 10);

    const prizes = [1000, 550, 275, 125, 50, 0, 0, 0, 0, 0].map((reward, i) => ({ position: i + 1, reward }));

    const responseData = {
      leaderboard,
      prizes,
      startTime: PREV_START_TIME.toISOString(),
      endTime: PREV_END_TIME.toISOString()
    };

    // Update cache
    betboltCache.previous = {
      data: responseData,
      timestamp: now
    };

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching previous Betbolt leaderboard:', error);
    
    // If cache exists, serve stale data on error
    if (betboltCache.previous.data) {
      console.log('[BETBOLT] Error occurred, serving stale cache');
      return res.json(betboltCache.previous.data);
    }
    
    res.status(500).json({ error: error.message || 'Failed to fetch previous Betbolt leaderboard data' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
  console.log(`📦 Betbolt cache duration: ${CACHE_DURATION / 60000} minutes`);
});
