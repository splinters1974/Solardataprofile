/**
 * Save a chart on screen as a PNG, white background, at twice screen
 * resolution so it stays sharp in a proposal. Works for our own SVG charts
 * and for recharts (the first <svg> inside the element given).
 */
export async function downloadChartPng(el: Element | null, filename: string) {
  const svg = el instanceof SVGSVGElement ? el : el?.querySelector('svg');
  if (!svg) return;
  const box = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(box.width));
  clone.setAttribute('height', String(box.height));
  // Inline the computed font so text renders the same off-screen.
  clone.setAttribute('style', `font-family:${getComputedStyle(svg).fontFamily};font-size:12px`);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('Could not draw the chart.')); img.src = url; });
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(box.width * scale);
    canvas.height = Math.round(box.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const chartFileName = (site: string, chart: string) =>
  `${site}-${chart}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
