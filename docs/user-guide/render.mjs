import { chromium } from 'playwright';
const dir = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.goto(`file://${dir}/guide-built.html`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: `${dir}/Ameresco-Data-Analyser-User-Guide.pdf`, format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: `<div style="width:100%;font-family:'Open Sans',sans-serif;font-size:7.5pt;color:#5b6774;padding:0 17mm;display:flex;justify-content:space-between">
    <span>Ameresco Data Analyser &middot; User guide &middot; Internal</span><span><span class="pageNumber"></span></span></div>`,
});
await browser.close();
