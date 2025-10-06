import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());

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
    const data = await response.json();
    let leaderboard = data.affiliates.map(entry => ({
      name: maskUsername(entry.username),
      wager: parseFloat(entry.wagered_amount)
    }));
    leaderboard.sort((a, b) => b.wager - a.wager);
    leaderboard = leaderboard.slice(0, 10);
    const prizes = [
      220, 170, 120, 50, 40, 0, 0, 0, 0, 0
    ].map((reward, i) => ({ position: i + 1, reward }));
    res.json({
      leaderboard,
      prizes,
      startTime: START_TIME.toISOString(),
      endTime: END_TIME.toISOString()
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard data' });
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
    const data = await response.json();
    let leaderboard = data.affiliates.map(entry => ({
      name: maskUsername(entry.username),
      wager: parseFloat(entry.wagered_amount)
    }));
    leaderboard.sort((a, b) => b.wager - a.wager);
    leaderboard = leaderboard.slice(0, 10);
    const prizes = [
      220, 170, 120, 50, 40, 0, 0, 0, 0, 0
    ].map((reward, i) => ({ position: i + 1, reward }));
    res.json({
      leaderboard,
      prizes,
      startTime: PREV_START_TIME.toISOString(),
      endTime: PREV_END_TIME.toISOString()
    });
  } catch (error) {
    console.error('Error fetching previous leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch previous leaderboard data' });
  }
});

// === /api/countdown/rainbet ===
app.get('/api/countdown/rainbet', (req, res) => {
  const now = new Date();
  const total = END_TIME - START_TIME;
  const remaining = END_TIME - now;
  const percentageLeft = Math.max(0, Math.min(100, (remaining / total) * 100));
  res.json({ percentageLeft: parseFloat(percentageLeft.toFixed(2)) });
});

// === BETBOLT HELPER (with logging) ===
async function fetchBetboltLeaderboard(from, to) {
  const url = new URL('https://openapi.betbolt.com/v1/referral/leaderboard');
  url.searchParams.append('limit', 100);
  url.searchParams.append('offset', 0);
  url.searchParams.append('start_date', from.toISOString());
  url.searchParams.append('end_date', to.toISOString());
  url.searchParams.append('sort_by', 'wager');
  url.searchParams.append('sort_order', 'desc');
  url.searchParams.append('categories', '');

  const response = await fetch(url, {
    headers: {
      'Authorization': '0199b8fe743b74779b3623aaa7fbbda30d449aee4d8043c6' // <-- Replace with your Betbolt Secret!
    }
  });

  console.log(`[BETBOLT API] Called: ${url}`);
  console.log(`[BETBOLT API] Status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    throw new Error('Betbolt fetch failed: ' + response.statusText);
  }

  const result = await response.json();

  if (result && Array.isArray(result.data)) {
    console.log(`[BETBOLT API] Received ${result.data.length} results.`);
    // Uncomment line below for more output:
    // console.log(JSON.stringify(result.data.slice(0,3), null, 2));
  } else {
    console.log('[BETBOLT API] No data property in result:', result);
  }

  return result;
}

// === /api/leaderboard/betbolt ===
app.get('/api/leaderboard/betbolt', async (req, res) => {
  try {
    const [START_TIME, END_TIME] = getCurrentMonthRangeUTC();
    const data = await fetchBetboltLeaderboard(START_TIME, END_TIME);

    let leaderboard = data.data.map(entry => ({
      name: maskUsername(entry.username),
      wager: parseFloat(entry.wagered)
    }));
    leaderboard.sort((a, b) => b.wager - a.wager);
    leaderboard = leaderboard.slice(0, 10);

    const prizes = [
      1000, 550, 275, 125, 50, 0, 0, 0, 0, 0
    ].map((reward, i) => ({ position: i + 1, reward }));

    res.json({
      leaderboard,
      prizes,
      startTime: START_TIME.toISOString(),
      endTime: END_TIME.toISOString()
    });
  } catch (error) {
    console.error('Error fetching Betbolt leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch Betbolt leaderboard data' });
  }
});

// === /api/prev-leaderboard/betbolt ===
app.get('/api/prev-leaderboard/betbolt', async (req, res) => {
  try {
    const [PREV_START_TIME, PREV_END_TIME] = getPreviousMonthRangeUTC();
    const data = await fetchBetboltLeaderboard(PREV_START_TIME, PREV_END_TIME);

    let leaderboard = data.data.map(entry => ({
      name: maskUsername(entry.username),
      wager: parseFloat(entry.wagered)
    }));
    leaderboard.sort((a, b) => b.wager - a.wager);
    leaderboard = leaderboard.slice(0, 10);

    const prizes = [
      1000, 550, 275, 125, 50, 0, 0, 0, 0, 0
    ].map((reward, i) => ({ position: i + 1, reward }));

    res.json({
      leaderboard,
      prizes,
      startTime: PREV_START_TIME.toISOString(),
      endTime: PREV_END_TIME.toISOString()
    });
  } catch (error) {
    console.error('Error fetching previous Betbolt leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch previous Betbolt leaderboard data' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
