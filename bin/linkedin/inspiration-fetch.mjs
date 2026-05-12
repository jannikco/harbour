// Workflow gate for the Inspirations Processor agent.
// Reads the full /next payload on stdin. Expects payload.run.extra_instructions
// to be a JSON blob like {"inspiration_post_id":"...","url":"https://..."}.
//
// Launches a headless Chromium using the Harbour-managed LinkedIn storageState
// (synced from the Chrome extension), fetches the post, prints a JSON object
// of the extracted fields to stdout. The runner forwards stdout to the agent
// as workflow context. The agent then writes analysis + drafts back via
// PATCH /api/inspirations/:id.
//
// Conventions inherited from the other linkedin-* workflow scripts in this
// directory:
//   - read LINKEDIN_STORAGE_PATH or ~/.harbour/state/linkedin-storage.json
//   - honor LINKEDIN_KILL_SWITCH=1
//   - exit codes: 0 = success, 1 = generic failure, 2 = bad args/payload,
//     3 = no storage state, 4 = kill switch
//
// All stderr is captured by the runner and surfaced as run activity. Stdout
// is what the agent sees, so keep it strictly to the result JSON.

import { chromium } from "playwright";
import { existsSync, readFileSync } from "fs";

const STATE = process.env.LINKEDIN_STORAGE_PATH || `${process.env.HOME}/.harbour/state/linkedin-storage.json`;
const BROWSER_META = `${process.env.HOME}/.harbour/state/linkedin-browser.json`;

if (process.env.LINKEDIN_KILL_SWITCH === "1") {
  console.error("LINKEDIN_KILL_SWITCH=1 — halting");
  process.exit(4);
}
if (!existsSync(STATE)) {
  console.error(`no LinkedIn storage at ${STATE}. Connect via the /linkedin page first.`);
  process.exit(3);
}

let userAgent = null;
try {
  if (existsSync(BROWSER_META)) {
    const meta = JSON.parse(readFileSync(BROWSER_META, "utf-8"));
    if (meta && typeof meta.userAgent === "string") userAgent = meta.userAgent;
  }
} catch {
  // userAgent is optional — Playwright default is fine
}

async function readStdin() {
  let buf = "";
  process.stdin.setEncoding("utf-8");
  for await (const chunk of process.stdin) buf += chunk;
  return buf;
}

const stdinText = await readStdin();
let payload;
try {
  payload = JSON.parse(stdinText);
} catch (err) {
  console.error("failed to parse stdin payload JSON: " + (err?.message || err));
  process.exit(2);
}

const extra = payload?.run?.extra_instructions;
if (!extra || typeof extra !== "string") {
  console.error("no extra_instructions on run — nothing to fetch");
  process.exit(2);
}

let job;
try {
  job = JSON.parse(extra);
} catch (err) {
  console.error("extra_instructions is not JSON: " + (err?.message || err));
  process.exit(2);
}

const url = typeof job?.url === "string" ? job.url.trim() : "";
const inspirationPostId = typeof job?.inspiration_post_id === "string" ? job.inspiration_post_id : "";
if (!url || !inspirationPostId) {
  console.error("extra_instructions missing url or inspiration_post_id");
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const contextOpts = { storageState: STATE, locale: "en-US" };
if (userAgent) contextOpts.userAgent = userAgent;
const ctx = await browser.newContext(contextOpts);
const page = await ctx.newPage();

let extracted = null;
let loginWall = false;

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  // Wait a beat for client-rendered post bodies to attach.
  await page.waitForTimeout(2500);

  const finalUrl = page.url();
  if (/\/login|\/uas\/login|\/checkpoint\//i.test(finalUrl)) {
    loginWall = true;
  } else {
    // Trigger lazy-loaded content (some posts hold their body behind "see more")
    await page.evaluate(() => {
      const seeMore = document.querySelector(
        'button.feed-shared-inline-show-more-text__see-more-less-toggle, button[aria-label*="see more" i]'
      );
      if (seeMore) seeMore.click();
    }).catch(() => {});
    await page.waitForTimeout(800);

    extracted = await page.evaluate(() => {
      function textOf(el) {
        return (el?.textContent || "").trim().replace(/\s+/g, " ");
      }
      function firstText(selectors) {
        for (const s of selectors) {
          const el = document.querySelector(s);
          const t = textOf(el);
          if (t) return t;
        }
        return null;
      }
      function firstHref(selectors) {
        for (const s of selectors) {
          const el = document.querySelector(s);
          if (el && el.getAttribute("href")) {
            try {
              return new URL(el.getAttribute("href"), "https://www.linkedin.com").toString();
            } catch {
              return el.getAttribute("href");
            }
          }
        }
        return null;
      }

      const author = firstText([
        "a.update-components-actor__meta-link span.update-components-actor__title span[aria-hidden='true']",
        ".update-components-actor__title span[aria-hidden='true']",
        ".update-components-actor__title",
        ".feed-shared-actor__name span[aria-hidden='true']",
        ".feed-shared-actor__name",
      ]);
      const authorUrl = firstHref([
        "a.update-components-actor__meta-link",
        ".update-components-actor__container a[href*='/in/']",
        ".feed-shared-actor__container a[href*='/in/']",
        ".feed-shared-actor a[href*='/in/']",
      ]);
      const postedAtText = firstText([
        ".update-components-actor__sub-description span[aria-hidden='true']",
        ".update-components-actor__sub-description",
        ".feed-shared-actor__sub-description span[aria-hidden='true']",
        ".feed-shared-actor__sub-description",
      ]);

      // The post body lives in a few different containers depending on age of
      // the post and AB-test wave. Take the longest text we find.
      const bodyCandidates = Array.from(document.querySelectorAll([
        ".update-components-update-v2__commentary",
        ".feed-shared-update-v2__description",
        ".feed-shared-update-v2__commentary",
        ".update-components-text",
      ].join(", ")));
      let postText = "";
      for (const el of bodyCandidates) {
        const t = textOf(el);
        if (t.length > postText.length) postText = t;
      }

      const imgEls = Array.from(document.querySelectorAll(
        ".update-components-image img, img.update-components-image__image-link, .feed-shared-image img"
      ));
      const imageUrls = Array.from(new Set(
        imgEls.map(i => i.getAttribute("src")).filter(s => typeof s === "string" && s.startsWith("http"))
      )).slice(0, 8);

      const reactionsText = firstText([
        ".social-details-social-counts__reactions-count",
        "button[data-test-id='social-actions__reactions'] span",
      ]);
      const commentsText = firstText([
        ".social-details-social-counts__comments",
        "li.social-details-social-counts__item button",
      ]);

      function parseCount(t) {
        if (!t) return null;
        const cleaned = t.replace(/[, ]/g, "");
        const m = cleaned.match(/([\d.]+)([KMB]?)/i);
        if (!m) return null;
        const n = parseFloat(m[1]);
        if (!Number.isFinite(n)) return null;
        const mult = m[2] ? { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[m[2].toUpperCase()] : 1;
        return Math.round(n * mult);
      }

      return {
        author,
        author_url: authorUrl,
        posted_at_text: postedAtText,
        text: postText,
        image_urls: imageUrls,
        reactions: parseCount(reactionsText),
        comments: parseCount(commentsText),
      };
    });
  }
} catch (err) {
  console.error("fetch error: " + (err?.message || String(err)));
  await browser.close().catch(() => {});
  process.exit(1);
}

await browser.close().catch(() => {});

if (loginWall) {
  console.error("login wall — re-sync your LinkedIn session via the Chrome extension (visit /linkedin)");
  process.exit(1);
}

if (!extracted || (!extracted.author && !extracted.text)) {
  console.error("could not extract author or text from " + url + " — post may be deleted, private, or LinkedIn changed selectors");
  process.exit(1);
}

const result = {
  inspiration_post_id: inspirationPostId,
  url,
  author: extracted.author,
  author_url: extracted.author_url,
  posted_at_text: extracted.posted_at_text,
  text: extracted.text,
  image_urls: extracted.image_urls,
  reactions: extracted.reactions,
  comments: extracted.comments,
};

// Stdout = agent context. Keep it strictly the JSON payload.
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
process.exit(0);
