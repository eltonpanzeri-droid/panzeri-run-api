const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
async function run() {
  const { default: lighthouse } = await import(
    pathToFileURL(
      path.resolve(
        'tmp/lighthouse-cache/_npx/0f94ee7615faf582/node_modules/lighthouse/core/index.js',
      ),
    ).href
  );
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--remote-debugging-port=9222'],
  });
  try {
    for (const mode of ['mobile', 'desktop']) {
      const options = { port: 9222, output: ['html', 'json'], logLevel: 'error' };
      if (mode === 'desktop') options.preset = 'desktop';
      const result = await lighthouse('http://127.0.0.1:4173/', options);
      const prefix = path.resolve('tmp/landing-preview/lighthouse-' + mode);
      fs.writeFileSync(prefix + '.html', result.report[0]);
      fs.writeFileSync(prefix + '.json', result.report[1]);
      console.log(
        JSON.stringify({
          mode,
          scores: Object.fromEntries(
            Object.entries(result.lhr.categories).map(([k, v]) => [k, v.score * 100]),
          ),
          failures: Object.entries(result.lhr.audits)
            .filter(
              ([, v]) => v.score !== null && v.score < 1 && v.scoreDisplayMode !== 'informative',
            )
            .map(([k, v]) => ({ id: k, title: v.title })),
          runtimeError: result.lhr.runtimeError,
        }),
      );
    }
  } finally {
    await browser.close();
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
