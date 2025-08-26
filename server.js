import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";

const app = express();
app.use(cors({
  origin: "http://localhost:3000",
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json());

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Click element helper (selector or xpath)
async function waitAndClick(page, selectorOrXpath, isXpath = false, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      let el;
      if (isXpath) {
        // Evaluate xpath manually
        const handles = await page.evaluateHandle((xp) => {
          const result = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return result.singleNodeValue;
        }, selectorOrXpath);
        el = handles.asElement();
      } else {
        el = await page.$(selectorOrXpath);
      }

      if (el) {
        await el.evaluate(e => e.scrollIntoView({behavior: "smooth", block: "center"}));
        try { await el.click({ clickCount: 1 }); } catch { await el.evaluate(e => e.click()); }
        await sleep(200);
        console.log(`DEBUG: waitAndClick resolved for ${selectorOrXpath}`);
        return el;
      }
    } catch (err) {
      console.log(`DEBUG: waitAndClick attempt ${i+1} failed for ${selectorOrXpath}: ${err.message}`);
    }
    await sleep(300);
  }
  console.log(`DEBUG: waitAndClick FAILED for ${selectorOrXpath}`);
  return null;
}


// Type into React input helper
async function typeReactInput(page, selector, text) {
  const el = await page.$(selector);
  if (!el) return false;

  await el.focus();

  // Set giá trị React-controlled
  await page.evaluate((el, val) => {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    nativeInputValueSetter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, el, text);

  await sleep(200);
  return true;
}



app.post("/run-tango", async (req, res) => {
  const { url } = req.body;
  const logs = [];
  let steps = [];

  const browser = await puppeteer.launch({ headless: false, slowMo: 200, defaultViewport: null });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle2" });

  try {
    await page.waitForSelector('[data-testid="workflowEdit.navigation.stepTitle"]', { timeout: 30000 });
    steps = await page.evaluate(() => 
      Array.from(document.querySelectorAll('[data-testid="workflowEdit.navigation.stepTitle"]')).map(e => e.innerText.trim())
    );
    logs.push("Steps detected: " + steps.join(", "));
    console.log("Steps:", steps);

    const [newPage] = await Promise.all([
      new Promise(resolve => { browser.once("targetcreated", async target => resolve(await target.page())); }),
      page.evaluate(() => {
        const openLink = Array.from(document.querySelectorAll("a"))
          .find(a => a.innerText.trim().toLowerCase() === "open");
        if(openLink) openLink.click();
      })
    ]);

    await newPage.bringToFront();
    await newPage.waitForSelector("body");
    console.log("Switched to target page:", await newPage.url());

    let lastClickedSelector = null;

    for (const step of steps) {
      const stepText = step.replace(/^\d+\.\s*/, "").trim();
      logs.push(`=== START step: ${stepText} ===`);
      console.log(`=== START step: ${stepText} ===`);

      if (stepText.startsWith("Click on")) {
        const text = stepText.replace(/^Click on\s*/, "").trim();
        const inputSelector = `input[placeholder*="${text}"], textarea[placeholder*="${text}"]`;
        const clickedInput = await waitAndClick(newPage, inputSelector);
        if (clickedInput) {
          lastClickedSelector = inputSelector;
          logs.push(`Clicked input: ${text}`);
          console.log(`Clicked input: ${text}`);
        } else {
          const btnXpath = `//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'), '${text.toLowerCase()}')]`;
          const clickedBtn = await waitAndClick(newPage, btnXpath, true);
          if (clickedBtn) {
            logs.push(`Clicked button: ${text}`);
            console.log(`Clicked button: ${text}`);
          } else {
            logs.push(`ERROR: Element not found -> ${text}`);
            console.log(`ERROR: Element not found -> ${text}`);
          }
        }
      }

      else if (stepText.startsWith("Type")) {
        const match = stepText.match(/Type "(.*)"/);
        if (match) {
          const textToType = match[1];
          let typed = false;

          if (lastClickedSelector) typed = await typeReactInput(newPage, lastClickedSelector, textToType);

          if (!typed) {
            typed = await newPage.evaluate((val) => {
              const el = document.activeElement;
              if (!el) return false;
              el.value = val;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            }, textToType);
          }

          if (typed) logs.push(`Typed: "${textToType}"`);
          else logs.push(`ERROR: Cannot type "${textToType}"`);
        }
      }

      logs.push(`=== DONE step: ${stepText} ===`);
      console.log(`=== DONE step: ${stepText} ===`);
      await sleep(300);
    }
      await sleep(2000);

    await browser.close();

  } catch (err) {
    logs.push("ERROR main: " + err.message);
    console.error(err);
  }

  res.json({ steps, logs });
});

app.listen(4000, () => console.log("Server running on port 4000"));
