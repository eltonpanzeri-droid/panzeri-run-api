const { chromium, firefox, webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../tmp/landing-preview');
async function run() {
  const report = { browsers: {}, layouts: [], errors: [], assertions: [] };
  for (const [name, engine, options] of [
    ['chrome', chromium, { channel: 'chrome' }],
    ['edge', chromium, { channel: 'msedge' }],
    ['firefox', firefox, {}],
    ['webkit', webkit, {}],
  ]) {
    let browser;
    try {
      browser = await engine.launch({ headless: true, ...options });
    } catch (error) {
      report.browsers[name] = { available: false, reason: error.message.split('\n')[0] };
      continue;
    }
    try {
      const page = await browser.newPage();
      page.on('pageerror', (error) => report.errors.push(error.message));
      page.on('response', (response) => {
        if (response.status() >= 400) report.errors.push(response.status() + ' ' + response.url());
      });
      await page.goto('http://127.0.0.1:4173/?utm_source=qa&utm_campaign=landing&gclid=test', {
        waitUntil: 'networkidle',
      });
      assert.equal(await page.locator('video').count(), 0);
      assert.equal(await page.locator('.result-card:visible').count(), 6);
      const checkoutLinks = await page
        .locator('[data-checkout]')
        .evaluateAll((links) => links.map((link) => link.href));
      assert(
        checkoutLinks.every(
          (link) =>
            link.includes('utm_source=qa') &&
            link.includes('utm_campaign=landing') &&
            link.includes('gclid=test'),
        ),
      );
      await page.locator('#expandResults').click();
      assert.equal(await page.locator('.result-card:visible').count(), 21);
      await page.locator('#expandResults').click();
      assert.equal(await page.locator('.result-card:visible').count(), 6);
      await page.locator('.faq-trigger').first().click();
      assert.equal(
        await page.locator('.faq-trigger').first().getAttribute('aria-expanded'),
        'true',
      );
      await page.locator('[data-result-index="0"]').click();
      assert(await page.locator('#resultLightbox').evaluate((dialog) => dialog.open));
      await page.keyboard.press('ArrowRight');
      assert((await page.locator('#lightboxImage').getAttribute('src')).includes('result-04'));
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Escape');
      assert(!(await page.locator('#resultLightbox').evaluate((dialog) => dialog.open)));
      assert.equal(
        await page
          .locator('[data-result-index="0"]')
          .evaluate((button) => button === document.activeElement),
        true,
      );
      const missing = await page.evaluate(async () => {
        const imgs = [...document.querySelectorAll('.result-image-button img')];
        return (
          await Promise.all(imgs.map(async (img) => [img.src, (await fetch(img.src)).status]))
        ).filter(([, status]) => status !== 200);
      });
      assert.equal(missing.length, 0);
      for (const width of [360, 390, 430, 768, 1024, 1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
        const layout = await page.evaluate(() => ({
          width: innerWidth,
          overflow: document.documentElement.scrollWidth > innerWidth,
          ctas: [...document.querySelectorAll('[data-checkout]')].filter(
            (e) => e.getBoundingClientRect().width > 0,
          ).length,
        }));
        assert.equal(layout.overflow, false, name + ' overflow at ' + width);
        report.layouts.push({ browser: name, ...layout });
        if (width === 390) {
          await page.locator('#menuToggle').click();
          assert.equal(await page.locator('#menuToggle').getAttribute('aria-expanded'), 'true');
          await page.locator('#mobileMenu a').first().click();
          assert.equal(await page.locator('#menuToggle').getAttribute('aria-expanded'), 'false');
          await page.locator('#resultados').scrollIntoViewIfNeeded();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(output, name + '-mobile-results.png') });
          await page.evaluate(async () => {
            document.documentElement.style.scrollBehavior = 'auto';
            for (let y = 0; y < document.body.scrollHeight; y += 700) {
              window.scrollTo(0, y);
              await new Promise((r) => setTimeout(r, 60));
            }
            window.scrollTo(0, 0);
          });
          await page.screenshot({ path: path.join(output, name + '-mobile.png'), fullPage: true });
          await page.screenshot({ path: path.join(output, name + '-mobile-hero.png') });
        }
        if (width === 1440) {
          await page.screenshot({ path: path.join(output, name + '-desktop-hero.png') });
          await page.locator('#resultados').scrollIntoViewIfNeeded();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(output, name + '-desktop-results.png') });
          await page.evaluate(async () => {
            document.documentElement.style.scrollBehavior = 'auto';
            for (let y = 0; y < document.body.scrollHeight; y += 700) {
              window.scrollTo(0, y);
              await new Promise((r) => setTimeout(r, 60));
            }
            window.scrollTo(0, 0);
          });
          await page.screenshot({ path: path.join(output, name + '-desktop.png'), fullPage: true });
        }
      }
      report.browsers[name] = { available: true, passed: true };
      report.assertions.push(
        name +
          ': layouts, menu, FAQ, expand/collapse, lightbox, arrows, Escape, focus, assets and UTM passed',
      );
    } catch (error) {
      report.browsers[name] = { available: true, passed: false, reason: error.stack };
    } finally {
      await browser.close();
    }
  }
  fs.writeFileSync(path.join(output, 'qa-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (
    !report.assertions.length ||
    report.errors.length ||
    Object.values(report.browsers).some((b) => b.available && !b.passed)
  )
    process.exitCode = 1;
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
