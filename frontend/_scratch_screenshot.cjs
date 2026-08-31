const { chromium } = require('playwright');

const OUT = 'C:/Users/brian/AppData/Local/Temp/claude/c--Users-brian-demo/2bd5f54f-2acc-47d3-b73f-5c1def03bd18/scratchpad';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });

  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.waitForSelector('.login-word-my', { timeout: 15000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/login-wordmark.png` });

  const cobrand = page.locator('.login-cobrand');
  await cobrand.screenshot({ path: `${OUT}/login-wordmark-closeup.png` });

  await browser.close();
})().catch((err) => { console.error('SCRIPT_FAILED:', err); process.exit(1); });
