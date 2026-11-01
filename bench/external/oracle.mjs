import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(join(process.argv[2], 'package.json'));
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const response = await page.goto('http://127.0.0.1:4317');
  await page.locator('.new-todo').fill('Buy milk');
  await page.locator('.new-todo').press('Enter');
  await page.screenshot({ path: process.argv[3], fullPage: true });
  const labels = await page.locator('.todo-list label').allTextContents();
  const held = response.status() === 200 && labels.includes('Buy milk');
  console.log(JSON.stringify({ http_status: response.status(), labels, held }));
  process.exitCode = held ? 0 : 1;
} finally { await browser.close(); }
