// Harbour LinkedIn Bridge — background service worker.
//
// Two responsibilities:
//   1. COOKIE SYNC: every 5 minutes, read all linkedin.com cookies via
//      chrome.cookies.getAll (including httpOnly ones like li_at) and POST
//      them to Harbour so the Playwright fallback always has a fresh session.
//   2. ACTION PROXY: every 60 seconds, poll Harbour for pending DM send
//      actions. For each, call LinkedIn's Voyager API from this real
//      browser's origin (cookies attach automatically), then report
//      success/failure back to Harbour. Random 15-45s sleep between actions.

const ALARM_SYNC = "harbour-sync-cookies";
const ALARM_POLL = "harbour-poll-actions";
const COOKIE_SYNC_INTERVAL_MIN = 5;
const ACTION_POLL_INTERVAL_MIN = 1;

// ─── Storage helpers ──────────────────────────────────────────────────────

async function getConfig() {
  const d = await chrome.storage.local.get(["harbourUrl", "extToken", "userAgent", "lastSync", "lastSyncResult", "lastActionAt", "lastActionResult"]);
  return {
    harbourUrl: d.harbourUrl || "http://localhost:3000",
    extToken: d.extToken || "",
    userAgent: d.userAgent || navigator.userAgent,
    lastSync: d.lastSync || null,
    lastSyncResult: d.lastSyncResult || null,
    lastActionAt: d.lastActionAt || null,
    lastActionResult: d.lastActionResult || null,
  };
}

async function setStatus(patch) {
  await chrome.storage.local.set(patch);
}

// ─── Cookie sync ──────────────────────────────────────────────────────────

function cookieToPlaywright(c) {
  // chrome.cookies sameSite values: "no_restriction" | "lax" | "strict" | "unspecified"
  const sameMap = { no_restriction: "None", lax: "Lax", strict: "Strict", unspecified: "Lax" };
  return {
    name: c.name,
    value: c.value,
    domain: c.domain.startsWith(".") ? c.domain : `.${c.domain}`,
    path: c.path || "/",
    expires: c.session ? -1 : (c.expirationDate ? Math.round(c.expirationDate) : -1),
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: sameMap[c.sameSite] || "Lax",
  };
}

async function syncCookies() {
  const cfg = await getConfig();
  if (!cfg.extToken) {
    await setStatus({ lastSyncResult: { ok: false, error: "no token configured" } });
    return;
  }
  const cookies = await chrome.cookies.getAll({ domain: ".linkedin.com" });
  const cookiesRoot = await chrome.cookies.getAll({ domain: "linkedin.com" });
  const merged = [...cookies, ...cookiesRoot.filter((c) => !cookies.some((d) => d.name === c.name && d.path === c.path))];
  const pwCookies = merged.map(cookieToPlaywright);
  const hasLiAt = pwCookies.some((c) => c.name === "li_at");
  if (!hasLiAt) {
    await setStatus({
      lastSync: Date.now(),
      lastSyncResult: { ok: false, error: "no li_at cookie found — are you logged into LinkedIn in this Chrome profile?", cookieCount: pwCookies.length },
    });
    return;
  }

  try {
    const r = await fetch(`${cfg.harbourUrl}/api/linkedin/session-sync`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${cfg.extToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        cookies: pwCookies,
        origins: [],
        userAgent: navigator.userAgent,
      }),
    });
    const json = await r.json().catch(() => ({}));
    await setStatus({
      lastSync: Date.now(),
      lastSyncResult: r.ok
        ? { ok: true, cookieCount: pwCookies.length, status: r.status, body: json }
        : { ok: false, error: json.error || `HTTP ${r.status}`, status: r.status, cookieCount: pwCookies.length },
    });
  } catch (err) {
    await setStatus({
      lastSync: Date.now(),
      lastSyncResult: { ok: false, error: String(err).slice(0, 300), cookieCount: pwCookies.length },
    });
  }
}

// ─── Action proxy ─────────────────────────────────────────────────────────

async function readCsrfToken() {
  const cookie = await chrome.cookies.get({ url: "https://www.linkedin.com", name: "JSESSIONID" });
  if (!cookie?.value) return null;
  // JSESSIONID value is quoted like "ajax:1234567890" — Voyager wants it verbatim
  // including the quotes (that IS how the real LinkedIn web app sends it).
  return cookie.value;
}

async function executeSendDm(action) {
  const csrfToken = await readCsrfToken();
  if (!csrfToken) {
    return { ok: false, error: "no JSESSIONID cookie", linkedin_status: 0 };
  }
  const conversationUrn = encodeURIComponent(action.conversation_urn);
  const url = `https://www.linkedin.com/voyager/api/messaging/conversations/${conversationUrn}/events?action=create`;
  const body = {
    eventCreate: {
      value: {
        "com.linkedin.voyager.messaging.create.MessageCreate": {
          body: action.body,
          attachments: [],
          attributedBody: { text: action.body, attributes: [] },
          mediaAttachments: [],
        },
      },
    },
  };
  try {
    const r = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "csrf-token": csrfToken,
        "content-type": "application/json; charset=UTF-8",
        "accept": "application/vnd.linkedin.normalized+json+2.1",
        "x-li-lang": "en_US",
        "x-restli-protocol-version": "2.0.0",
      },
      body: JSON.stringify(body),
    });
    if (r.ok || r.status === 201) {
      const json = await r.json().catch(() => ({}));
      return { ok: true, linkedin_status: r.status, response: json };
    }
    const text = await r.text().catch(() => "");
    return { ok: false, linkedin_status: r.status, error: text.slice(0, 500) };
  } catch (err) {
    return { ok: false, linkedin_status: 0, error: String(err).slice(0, 500) };
  }
}

async function reportAction(actionId, result) {
  const cfg = await getConfig();
  try {
    await fetch(`${cfg.harbourUrl}/api/linkedin/extension/actions/${actionId}/report`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${cfg.extToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
  } catch (err) {
    console.error("[harbour] report failed:", err);
  }
}

function randomJitterMs(minSec, maxSec) {
  return (minSec + Math.floor(Math.random() * (maxSec - minSec))) * 1000;
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function pollAndExecute() {
  const cfg = await getConfig();
  if (!cfg.extToken) return;
  let actions = [];
  try {
    const r = await fetch(`${cfg.harbourUrl}/api/linkedin/extension/pending-actions`, {
      headers: { "Authorization": `Bearer ${cfg.extToken}` },
    });
    if (!r.ok) {
      await setStatus({ lastActionResult: { ok: false, error: `pending-actions HTTP ${r.status}` } });
      return;
    }
    const json = await r.json().catch(() => ({ actions: [] }));
    actions = json.actions || [];
    if (json.skip_reason) {
      await setStatus({ lastActionResult: { ok: true, skipped: json.skip_reason, actionCount: 0 } });
    }
  } catch (err) {
    await setStatus({ lastActionResult: { ok: false, error: String(err).slice(0, 300) } });
    return;
  }
  if (actions.length === 0) return;

  let sent = 0, failed = 0;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.kind !== "send_dm") continue;
    const result = await executeSendDm(a);
    await reportAction(a.id, result);
    if (result.ok) sent++; else failed++;
    if (i < actions.length - 1) {
      await sleep(randomJitterMs(15, 45));
    }
  }
  await setStatus({
    lastActionAt: Date.now(),
    lastActionResult: { ok: failed === 0, sent, failed, actionCount: actions.length },
  });
}

// ─── Alarms wiring ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_SYNC, { periodInMinutes: COOKIE_SYNC_INTERVAL_MIN, when: Date.now() + 2000 });
  chrome.alarms.create(ALARM_POLL, { periodInMinutes: ACTION_POLL_INTERVAL_MIN, when: Date.now() + 8000 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_SYNC, { periodInMinutes: COOKIE_SYNC_INTERVAL_MIN, when: Date.now() + 2000 });
  chrome.alarms.create(ALARM_POLL, { periodInMinutes: ACTION_POLL_INTERVAL_MIN, when: Date.now() + 8000 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_SYNC) await syncCookies();
  if (alarm.name === ALARM_POLL) await pollAndExecute();
});

// Manual triggers from the popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.cmd === "sync-now") { await syncCookies(); sendResponse({ ok: true }); return; }
    if (msg?.cmd === "poll-now") { await pollAndExecute(); sendResponse({ ok: true }); return; }
    if (msg?.cmd === "status") { sendResponse(await getConfig()); return; }
    sendResponse({ ok: false, error: "unknown cmd" });
  })();
  return true;
});
