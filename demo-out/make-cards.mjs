// Render relay-branded intro/outro title cards (1920x1080 PNG) for the demo video.
// Run: node demo-out/make-cards.mjs
const { chromium } = await import('file:///C:/Users/sghar/AppData/Roaming/npm/node_modules/playwright/index.mjs');
const OUT = 'C:/Users/sghar/CascadeProjects/relay/demo-out';

// A simple "relay" mark: two linked rings (handing off).
const MARK = `<svg width="132" height="132" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="25" cy="32" r="15" fill="none" stroke="#5b9cff" stroke-width="3.4"/>
  <circle cx="39" cy="32" r="15" fill="none" stroke="#49e0a0" stroke-width="3.4"/></svg>`;

const shell = (inner) => `<!doctype html><html><body style="margin:0;width:1920px;height:1080px;
  background:radial-gradient(circle at 50% 36%, #0d1526 0%, #070b16 72%);color:#eef3ff;
  display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
  font-family:Georgia,'Times New Roman',serif;">${inner}</body></html>`;
const mono = "font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;";

const intro = shell(`
  <div style="margin-bottom:28px;">${MARK}</div>
  <div style="${mono}letter-spacing:.5em;font-size:20px;color:#6b82ab;text-transform:uppercase;margin-bottom:26px;">Aurora&nbsp;DSQL · Active-Active · Living&nbsp;Continuity</div>
  <h1 style="font-weight:600;font-size:108px;margin:0 0 32px;letter-spacing:.01em;">Relay</h1>
  <div style="font-family:Helvetica,Arial,sans-serif;font-size:33px;color:#cfe0f5;max-width:1180px;line-height:1.55;">
    Standby access for the people who'll need it —<br/>handed over the moment you can't be there.</div>`);

const outro = shell(`
  <div style="margin-bottom:28px;">${MARK}</div>
  <h1 style="font-weight:600;font-size:100px;margin:0 0 20px;">Relay</h1>
  <div style="font-family:Helvetica,Arial,sans-serif;font-size:36px;color:#5b9cff;margin-bottom:44px;">Set it up in fifteen minutes.</div>
  <div style="${mono}letter-spacing:.18em;font-size:25px;color:#eef3ff;margin-bottom:18px;">relay-three-henna.vercel.app</div>
  <div style="${mono}letter-spacing:.18em;font-size:17px;color:#6b82ab;">Built on Amazon Aurora DSQL · #H0Hackathon</div>`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const [name, html] of [['intro-card', intro], ['outro-card', outro]]) {
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('wrote', name + '.png');
}
await browser.close();
