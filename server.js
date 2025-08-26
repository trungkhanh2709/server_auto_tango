import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";

const app = express();
app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json());

async function waitForInputByPlaceholder(page, placeholder, timeout = 30000) {
  const start = Date.now();
  placeholder = placeholder.toLowerCase();

  while (Date.now() - start < timeout) {
    const inputHandle = await page.evaluateHandle((text) => {
      const inputs = Array.from(document.querySelectorAll("input, textarea"));
      return (
        inputs.find(
          (el) => el.placeholder && el.placeholder.toLowerCase().includes(text)
        ) || null
      );
    }, placeholder);

    const input = inputHandle.asElement();
    if (input) return input;

    await page.waitForTimeout(500);
  }

  return null;
}

app.post("/run-tango", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).send("Missing URL");

  const logs = [];
  let steps = [];
  const browser = await puppeteer.launch({
    headless: false, // hiển thị browser
    slowMo: 500, // chậm lại để thấy hành động
    defaultViewport: null,
  });

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle2" });

  try {
    // Click link "Open" nếu có
    try {
      const openClicked = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll("a"));
        const openLink = anchors.find(
          (a) => a.innerText.trim().toLowerCase() === "open"
        );
        if (openLink) {
          openLink.click();
          return true;
        }
        return false;
      });
      logs.push(
        openClicked ? "Clicked on Open link ✅" : "No Open link found ❌"
      );
      await page.waitForTimeout(1000);
    } catch (err) {
      logs.push("ERROR clicking Open link: " + err.message);
    }

    // Lấy step từ workflow
    steps = await page.evaluate(() => {
      const stepElements = document.querySelectorAll(
        '[data-testid="workflowEdit.navigation.stepTitle"]'
      );
      return Array.from(stepElements).map((el) => el.innerText.trim());
    });
    logs.push("Steps detected: " + steps.join(", "));

    // Thực hiện từng step
    for (const step of steps) {
      const stepText = step.replace(/^\d+\.\s*/, "").trim(); // loại bỏ số thứ tự

      console.log("Processing step:", stepText);
      logs.push("Processing step: " + stepText);

      if (stepText.startsWith("Click on")) {
        let text = stepText
          .replace(/^Click on\s*/, "")
          .replace(/\.\.\.$/, "")
          .trim();

        console.log("Looking for element with placeholder/text:", text);
        logs.push("Looking for element with placeholder/text: " + text);

      const inputSelector = 'input[placeholder*="Type here"], textarea[placeholder*="Type here"]';

// đợi input xuất hiện và visible
await page.waitForSelector(inputSelector, { timeout: 30000, visible: true });

const input = await page.$(inputSelector);

if (input) {
  // scroll vào view
  await page.evaluate(el => el.scrollIntoView({ block: "center", behavior: "smooth" }), input);

  // click wrapper (Ant Design)
  const wrapper = await page.evaluateHandle(el => el.closest('.ant-input') || el, input);
  await wrapper.asElement().click({ clickCount: 1 });

  // focus input
  await input.focus();

  console.log(`Focused on input with placeholder: Type here ✅`);
  logs.push(`Focused on input with placeholder: Type here ✅`);
}

 else {
          // fallback tìm button
          const buttonHandle = await page.$x(
            `//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${text.toLowerCase()}')]`
          );
          if (buttonHandle.length > 0) {
            await buttonHandle[0].click();
            console.log(`Clicked button with text: ${text} ✅`);
            logs.push(`Clicked button with text: ${text} ✅`);
          } else {
            const errorMsg = `ERROR: Element not found -> ${text} ❌`;
            console.log(errorMsg);
            logs.push(errorMsg);
          }
        }

        await page.waitForTimeout(500);
      }

      if (stepText.startsWith("Type")) {
        // dùng stepText, không phải step
        const match = stepText.match(/Type "(.*)"/);
        if (match) {
          const inputText = match[1];
          console.log("Typing text:", inputText);
          logs.push("Typing text: " + inputText);
          await page.keyboard.type(inputText, { delay: 100 });
          console.log(`Typed: ${inputText} ✅`);
          logs.push(`Typed: ${inputText} ✅`);
          await page.waitForTimeout(500);
        }
      }
    }
  } catch (err) {
    logs.push("ERROR main: " + err.message);
  }

  // Không đóng browser luôn, để bạn nhìn quá trình

  res.json({ steps, logs });
});

app.listen(4000, () => console.log("Server running on port 4000"));
