import { chromium } from 'playwright';
const dir = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.goto(`file://${dir}/guide-built.html`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
// Keep each sub-section (an h2 and what follows it, up to the next heading)
// on one page: the browser moves it to the next page rather than split it.
// A sub-section taller than a page still flows.
await page.evaluate(() => {
  const style = document.createElement('style');
  style.textContent = '.keep { break-inside: avoid; }';
  document.head.appendChild(style);
  for (const h of [...document.querySelectorAll('h2')]) {
    const wrap = document.createElement('div');
    wrap.className = 'keep';
    h.before(wrap);
    let n = h;
    while (n && !(n !== h && /^H[12]$/.test(n.tagName ?? '')) && !n.matches?.('section')) {
      const next = n.nextSibling;
      wrap.appendChild(n);
      n = next;
    }
  }
});
await page.pdf({
  path: `${dir}/Ameresco-Data-Analyser-User-Guide.pdf`, format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: `<div style="width:100%;font-family:'Schibsted Grotesk','Liberation Sans',sans-serif;font-size:7.5pt;color:#5f6d74;padding:0 17mm;display:flex;justify-content:space-between">
    <span>Ameresco UK &middot; Data Analyser Standard and Advanced &middot; User guide &middot; Internal</span><span><span class="pageNumber"></span></span></div>`,
});
await browser.close();
