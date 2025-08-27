// server.js
import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";

const app = express();
app.use(cors({ origin: "*" }));

app.use(express.json());

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Click element helper
async function waitAndClick(
  page,
  selectorOrXpath,
  isXpath = false,
  retries = 5,
  log
) {
  for (let i = 0; i < retries; i++) {
    try {
      let el;
      if (isXpath) {
        const handle = await page.evaluateHandle((xp) => {
          const res = document.evaluate(
            xp,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          );
          return res.singleNodeValue;
        }, selectorOrXpath);
        el = handle.asElement();
      } else {
        el = await page.$(selectorOrXpath);
      }

      if (el) {
        await el.evaluate((e) =>
          e.scrollIntoView({ behavior: "smooth", block: "center" })
        );
        try {
          await el.click({ clickCount: 1 });
        } catch {
          await el.evaluate((e) => e.click());
        }
        await sleep(200);
        log(`DEBUG: waitAndClick resolved for ${selectorOrXpath}`);
        return el;
      }
    } catch (err) {
      log(
        `DEBUG: waitAndClick attempt ${i + 1} failed for ${selectorOrXpath}: ${
          err.message
        }`
      );
    }
    await sleep(300);
  }
  log(`DEBUG: waitAndClick FAILED for ${selectorOrXpath}`);
  return null;
}

// Type into React input helper
async function typeReactInput(page, selector, text, log) {
  const el = await page.$(selector);
  if (!el) return false;
  await el.focus();
  await page.evaluate(
    (el, val) => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      nativeInputValueSetter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    el,
    text
  );
  await sleep(200);
  log(`Typed: "${text}"`);
  return true;
}

app.get("/run-tango-sse", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const log = (msg) => res.write(`data: ${msg}\n\n`);
   if (res.flush) res.flush();

  const url = req.query.url;
  if (!url) {
    log("ERROR: Missing URL");
    res.end();
    return;
  }

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 200,
    defaultViewport: null,
  });
  const page = await browser.newPage();

  try {
    log("Opening page...");
    await page.goto(url, { waitUntil: "networkidle2" });
    log("Page loaded");

    await page.waitForSelector(
      '[data-testid="workflowEdit.navigation.stepTitle"]',
      { timeout: 30000 }
    );
    const steps = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          '[data-testid="workflowEdit.navigation.stepTitle"]'
        )
      ).map((e) => e.innerText.trim())
    );
    log("Steps: " + steps.join(", "));

    const [newPage] = await Promise.all([
      new Promise((resolve) =>
        browser.once("targetcreated", async (target) =>
          resolve(await target.page())
        )
      ),
      page.evaluate(() => {
        const openLink = Array.from(document.querySelectorAll("a")).find(
          (a) => a.innerText.trim().toLowerCase() === "open"
        );
        if (openLink) openLink.click();
      }),
    ]);

    await newPage.bringToFront();
    await newPage.waitForSelector("body");
    log("Switched to target page: " + (await newPage.url()));

    let lastClickedSelector = null;

    for (const step of steps) {
      const stepText = step.replace(/^\d+\.\s*/, "").trim();
      log(`=== START step: ${stepText} ===`);

      if (stepText.startsWith("Click on")) {
        const text = stepText.replace(/^Click on\s*/, "").trim();
        const inputSelector = `input[placeholder*="${text}"], textarea[placeholder*="${text}"]`;
        const clickedInput = await waitAndClick(
          newPage,
          inputSelector,
          false,
          5,
          log
        );
        if (clickedInput) {
          lastClickedSelector = inputSelector;
          log(`Clicked input: ${text}`);
        } else {
          const btnXpath = `//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'), '${text.toLowerCase()}')]`;
          const clickedBtn = await waitAndClick(
            newPage,
            btnXpath,
            true,
            5,
            log
          );
          if (clickedBtn) log(`Clicked button: ${text}`);
          else log(`ERROR: Element not found -> ${text}`);
        }
      } else if (stepText.startsWith("Type")) {
        const match = stepText.match(/Type "(.*)"/);
        if (match) {
          const textToType = match[1];
          let typed = false;
          if (lastClickedSelector)
            typed = await typeReactInput(
              newPage,
              lastClickedSelector,
              textToType,
              log
            );
          if (!typed) {
            typed = await newPage.evaluate((val) => {
              const el = document.activeElement;
              if (!el) return false;
              el.value = val;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              return true;
            }, textToType);
          }
          if (!typed) log(`ERROR: Cannot type "${textToType}"`);
        }
      }

      log(`=== DONE step: ${stepText} ===`);
      await sleep(300);
    }

    await sleep(2000);
    await browser.close();
    log("=== ALL STEPS DONE ===");
  } catch (err) {
    log("ERROR main: " + err.message);
    await browser.close();
  } finally {
    res.end();
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));