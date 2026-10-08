/**
 * PRAFLIX — Cloudflare Worker & Scheduled 24-Hour Catalog Sync
 * A PRAVERSE Company
 *
 * Cloudflare Worker entry point:
 * - Serves frontend static assets from ./dist via env.ASSETS.fetch(request)
 * - Executes automated 24-hour scheduled synchronization via triggers.crons (0 0 * * *)
 * - Dispatches daily Telegram reports securely using env.TELEGRAM_BOT_TOKEN and env.TELEGRAM_CHANNEL_ID
 */

const PROVIDERS = ['HDHub4u', '10Moviez', 'HDWall'];

function formatDateTime(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${year}-${month}-${day} ${hours}:${mins} UTC`;
}

function formatTelegramReport(summary) {
  const syncTime = summary.formattedTime || formatDateTime(new Date());
  const provs = summary.providers;

  let text = '━━━━━━━━━━━━━━━━━━━━━━\n';
  text += '       PRAFLIX REPORT\n';
  text += '━━━━━━━━━━━━━━━━━━━━━━\n\n';
  text += '📅 DAILY CATALOG UPDATE\n';
  text += `🕐 Sync completed: ${syncTime}\n\n`;

  for (const prov of PROVIDERS) {
    const res = provs[prov];
    text += '━━━━━━━━━━━━━━━━━━━━━━\n';
    text += `${prov.toUpperCase()}\n`;
    text += '━━━━━━━━━━━━━━━━━━━━━━\n\n';

    if (res && res.failed) {
      text += '⚠️ Sync failed\n';
      text += '🎬 New Movies: —\n';
      text += '📺 New Series: —\n\n';
    } else if (res) {
      text += `🎬 New Movies: ${res.newMovies}\n`;
      text += `📺 New Series: ${res.newSeries}\n\n`;
    } else {
      text += '⚠️ Sync failed\n';
      text += '🎬 New Movies: —\n';
      text += '📺 New Series: —\n\n';
    }
  }

  const total = summary.totals || { moviesAdded: 0, seriesAdded: 0, totalTitlesAdded: 0 };
  text += '━━━━━━━━━━━━━━━━━━━━━━\n';
  text += 'TOTAL\n';
  text += '━━━━━━━━━━━━━━━━━━━━━━\n\n';
  text += `🎬 Movies Added: ${total.moviesAdded}\n`;
  text += `📺 Series Added: ${total.seriesAdded}\n`;
  text += `📦 Total Titles Added: ${total.totalTitlesAdded}\n\n`;

  if (total.totalTitlesAdded > 0) {
    text += '✅ PRAFLIX CATALOG UPDATED';
  } else {
    text += '✅ No new titles found today.';
  }

  return text;
}

async function sendTelegramReport(reportText, env) {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHANNEL_ID || env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.warn('[PRAFLIX Worker] Telegram credentials not configured in Worker environment.');
    return { success: false, error: 'Missing Worker credentials' };
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: reportText,
        parse_mode: 'HTML'
      })
    });

    const data = await res.json();
    return { success: data.ok, result: data.result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleScheduledSync(env) {
  const syncStartTime = new Date();
  const providerResults = {};

  for (const prov of PROVIDERS) {
    providerResults[prov] = {
      provider: prov,
      failed: false,
      newMovies: 0,
      newSeries: 0
    };
  }

  // HDWall Check
  try {
    const resp = await fetch('https://hdwall.xyz/page/1/', {
      headers: { 'User-Agent': 'PRAFLIX-Bot/1.0' }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  } catch (e) {
    providerResults['HDWall'].failed = true;
  }

  // 10Moviez Check
  try {
    const resp = await fetch('https://10moviez.biz/category/web-series/page/1/', {
      headers: { 'User-Agent': 'PRAFLIX-Bot/1.0' }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  } catch (e) {
    providerResults['10Moviez'].failed = true;
  }

  // HDHub4u Check
  try {
    const resp = await fetch('https://new1.hdhub4u.free/', {
      headers: { 'User-Agent': 'PRAFLIX-Bot/1.0' }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  } catch (e) {
    providerResults['HDHub4u'].failed = true;
  }

  let totalMovies = 0;
  let totalSeries = 0;
  for (const prov of PROVIDERS) {
    const r = providerResults[prov];
    if (!r.failed) {
      totalMovies += r.newMovies;
      totalSeries += r.newSeries;
    }
  }

  const summary = {
    syncTime: syncStartTime.toISOString(),
    formattedTime: formatDateTime(syncStartTime),
    providers: providerResults,
    totals: {
      moviesAdded: totalMovies,
      seriesAdded: totalSeries,
      totalTitlesAdded: totalMovies + totalSeries
    }
  };

  const reportText = formatTelegramReport(summary);
  await sendTelegramReport(reportText, env);
}

export default {
  /**
   * HTTP request router
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'PRAFLIX' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Default: Serve frontend static assets from ./dist
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('PRAFLIX Static Assets Not Bound', { status: 500 });
  },

  /**
   * 24-hour scheduled cron trigger handler
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduledSync(env));
  }
};
