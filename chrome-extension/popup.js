// Popup UI. Reads + writes chrome.storage.local config, shows status, and
// asks the background worker to sync / poll on demand.

const $ = (id) => document.getElementById(id);

function fmtRel(ts) {
  if (!ts) return "never";
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function renderStatus() {
  const cfg = await chrome.storage.local.get(["harbourUrl", "extToken", "lastSync", "lastSyncResult", "lastActionAt", "lastActionResult"]);
  $("harbourUrl").value = cfg.harbourUrl || "http://localhost:3000";
  $("extToken").value = cfg.extToken || "";

  const lines = [];
  const sr = cfg.lastSyncResult;
  if (!cfg.extToken) {
    lines.push(`<div class="status-line"><span class="dot idle"></span>No token configured.</div>`);
  } else if (!sr) {
    lines.push(`<div class="status-line"><span class="dot idle"></span>Waiting for first sync…</div>`);
  } else if (sr.ok) {
    lines.push(`<div class="status-line"><span class="dot ok"></span>Cookies synced ${fmtRel(cfg.lastSync)} · ${sr.cookieCount || "?"} cookies.</div>`);
  } else {
    lines.push(`<div class="status-line"><span class="dot err"></span>Cookie sync failed ${fmtRel(cfg.lastSync)}.</div>`);
    lines.push(`<div class="error-block">${escapeHtml(sr.error || "unknown error")}</div>`);
  }

  const ar = cfg.lastActionResult;
  if (cfg.extToken) {
    if (!ar) {
      lines.push(`<div class="status-line"><span class="dot idle"></span>No actions polled yet.</div>`);
    } else if (ar.skipped) {
      lines.push(`<div class="status-line"><span class="dot warn"></span>Action poll skipped: ${escapeHtml(ar.skipped)}</div>`);
    } else if (ar.ok) {
      if ((ar.actionCount || 0) === 0) {
        lines.push(`<div class="status-line"><span class="dot idle"></span>No pending actions ${fmtRel(cfg.lastActionAt)}.</div>`);
      } else {
        lines.push(`<div class="status-line"><span class="dot ok"></span>Sent ${ar.sent}/${ar.actionCount} actions ${fmtRel(cfg.lastActionAt)}.</div>`);
      }
    } else {
      lines.push(`<div class="status-line"><span class="dot err"></span>Action poll error ${fmtRel(cfg.lastActionAt)}.</div>`);
      if (ar.error) lines.push(`<div class="error-block">${escapeHtml(ar.error)}</div>`);
    }
  }
  $("status").innerHTML = lines.join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("save").addEventListener("click", async () => {
  const harbourUrl = ($("harbourUrl").value || "").trim().replace(/\/$/, "");
  const extToken = ($("extToken").value || "").trim();
  await chrome.storage.local.set({ harbourUrl, extToken });
  $("saveStatus").textContent = "Saved. Click 'Sync cookies now' to test.";
  setTimeout(() => { $("saveStatus").textContent = ""; }, 4000);
  renderStatus();
});

$("sync").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ cmd: "sync-now" });
  setTimeout(renderStatus, 800);
});

$("poll").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ cmd: "poll-now" });
  setTimeout(renderStatus, 800);
});

renderStatus();
setInterval(renderStatus, 10_000);
