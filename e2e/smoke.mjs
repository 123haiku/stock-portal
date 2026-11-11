import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// End-to-end smoke test: login -> search -> quote -> mobile viewport screenshot.
// Serves as the documented "happy path" proof for the demo.

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'docs', 'screens');
mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const results = [];

function step(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  step('page loads', (await page.title()).includes('Stock'), await page.title());

  await page.waitForSelector('form.card', { timeout: 10000 });
  step('login form rendered', true);

  await page.screenshot({ path: join(outDir, '01-login.png'), fullPage: true });

  await page.fill('input[type="email"]', 'admin@portal.local');
  await page.fill('input[type="password"]', 'demo1234');
  await page.click('button[type="submit"]');

  await page.waitForSelector('table thead', { timeout: 15000 });
  step('login succeeded, product table visible', true);

  await page.waitForFunction(
    () => document.querySelectorAll('tbody tr').length > 3,
    { timeout: 10000 },
  );
  const rowCount = await page.locator('tbody tr').count();
  step('products loaded from API', rowCount > 3, `${rowCount} rows`);

  await page.screenshot({ path: join(outDir, '02-products.png'), fullPage: true });

  // Search filters down to matching SKU
  await page.fill('input[placeholder="Search SKU or product name"]', 'drill');
  await page.click('button.btn-primary');
  await page.waitForFunction(
    () => document.querySelectorAll('tbody tr').length === 1,
    { timeout: 10000 },
  );
  const searchRow = await page.locator('tbody tr').first().innerText();
  step('SKU search filters correctly', searchRow.includes('PT-0101'), searchRow.split('\n')[0]);

  // Low stock filter
  await page.click('text=Reset');
  await page.waitForTimeout(400);
  await page.click('text=Low stock only');
  await page.waitForFunction(
    () => document.querySelectorAll('tbody tr').length > 0 && document.querySelectorAll('tbody tr').length < 5,
    { timeout: 10000 },
  );
  const lowRows = await page.locator('tbody tr').count();
  step('low stock filter works', lowRows === 3, `${lowRows} rows`);
  await page.screenshot({ path: join(outDir, '03-low-stock.png'), fullPage: true });

  // Quotation tab
  await page.click('nav button:has-text("Quotation")');
  await page.waitForSelector('input[placeholder="e.g. drill, PT-0101"]', { timeout: 10000 });
  step('quotation builder opened', true);

  await page.fill('input[placeholder="e.g. drill, PT-0101"]', 'drill');
  await page.waitForTimeout(400);
  await page.click('li:has-text("PT-0101") button:has-text("Add")');
  await page.fill('input[placeholder="e.g. Acme Hardware Sdn Bhd"]', 'E2E Test Customer Sdn Bhd');
  await page.waitForTimeout(300);

  const summary = await page.locator('aside dl').innerText();
  step('summary recalculates subtotal', summary.includes('289.00'), summary.replace(/\n/g, ' | '));
  await page.screenshot({ path: join(outDir, '04-quote-builder.png'), fullPage: true });

  await page.click('button:has-text("Generate quotation")');
  await page.waitForSelector('aside .card:has-text("Q-")', { timeout: 15000 });
  const quoteCard = await page.locator('aside .card').last().innerText();
  const quoteNo = quoteCard.match(/Q-\d{8}-\d{4}/)?.[0];
  step('quotation created via API', Boolean(quoteNo), quoteNo || quoteCard.slice(0, 40));
  await page.screenshot({ path: join(outDir, '05-quote-created.png'), fullPage: true });

  // Mobile viewport - same build, different form factor
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('form.card', { timeout: 10000 });
  await mobile.screenshot({ path: join(outDir, '06-mobile-login.png'), fullPage: true });

  await mobile.fill('input[type="email"]', 'sales@portal.local');
  await mobile.fill('input[type="password"]', 'demo1234');
  await mobile.click('button[type="submit"]');
  // On mobile the table is hidden and the card list is rendered instead.
  await mobile.waitForSelector('ul.md\\:hidden li', { timeout: 15000 });
  const mobileCards = await mobile.locator('ul.md\\:hidden li').count();
  const tableHidden = await mobile.locator('table').isHidden();
  step('mobile card list replaces table', mobileCards > 3 && tableHidden, `${mobileCards} cards, table hidden=${tableHidden}`);
  await mobile.waitForTimeout(600);
  await mobile.screenshot({ path: join(outDir, '07-mobile-products.png'), fullPage: true });

  await mobile.click('nav button:has-text("Quotation")');
  await mobile.waitForSelector('input[placeholder="e.g. drill, PT-0101"]', { timeout: 10000 });
  await mobile.waitForTimeout(500);
  await mobile.screenshot({ path: join(outDir, '08-mobile-quote.png'), fullPage: true });
  step('mobile quotation view rendered', true);

  const viewportWidth = await mobile.evaluate(() => document.documentElement.clientWidth);
  const bodyScroll = await mobile.evaluate(() => document.body.scrollWidth);
  step('mobile view renders (no page-level overflow)', viewportWidth === bodyScroll, `${viewportWidth}px viewport`);
  await mobile.close();

  step('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');
} catch (err) {
  step('e2e run', false, err.message);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
