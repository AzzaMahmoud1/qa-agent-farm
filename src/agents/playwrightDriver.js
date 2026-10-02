/**
 * Playwright adapter for the live Author (src/agents/liveAuthor.js).
 * Playwright is optional: install it only if you use live authoring.
 *   npm i -D playwright && npx playwright install chromium
 */

const INTERACTIVE = "a,button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=tab],[contenteditable=true]";

export async function createPlaywrightDriver({ headless = true, timeoutMs = 10_000 } = {}) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("Playwright is not installed — run `npm i -D playwright && npx playwright install chromium` to enable live authoring");
  }
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();
  page.setDefaultTimeout(timeoutMs);
  const target = (ref) => page.locator(`[data-qa-ref="${String(ref).replace(/[^a-z0-9_-]/gi, "")}"]`).first();

  return {
    async goto(url) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    },
    async snapshot() {
      const data = await page.evaluate((selector) => {
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
        };
        const elements = [];
        document.querySelectorAll(selector).forEach((el, i) => {
          if (!visible(el)) return;
          const ref = `e${i}`;
          el.setAttribute("data-qa-ref", ref);
          const name = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.innerText || el.getAttribute("name") || el.getAttribute("value") || "").trim().slice(0, 80);
          const role = el.getAttribute("role") || (el.tagName === "INPUT" ? `input:${el.type || "text"}` : el.tagName.toLowerCase());
          elements.push({ ref, role, name });
        });
        return { title: document.title, text: (document.body?.innerText || "").slice(0, 6000), elements };
      }, INTERACTIVE);
      return { url: page.url(), ...data };
    },
    async act({ type, ref, value }) {
      const loc = target(ref);
      if (type === "click") await loc.click();
      else if (type === "fill") await loc.fill(String(value ?? ""));
      else if (type === "press") await loc.press(String(value || "Enter"));
      else if (type === "select") await loc.selectOption(String(value ?? ""));
      else throw new Error(`unsupported action ${type}`);
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    },
    async screenshot() {
      try {
        return (await page.screenshot({ type: "jpeg", quality: 50 })).toString("base64");
      } catch {
        return null;
      }
    },
    async close() {
      await browser.close();
    },
  };
}
