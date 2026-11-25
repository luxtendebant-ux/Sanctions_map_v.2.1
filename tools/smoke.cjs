// Run with Playwright installed. Optional local keys are read only from CM_KEY_DIR.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const documentPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
const keyDir = process.env.CM_KEY_DIR;
const channel = process.env.CM_BROWSER_CHANNEL;
const wrongPassword = 'smoke-test-invalid-input';

async function run() {
  const html = await fs.readFile(documentPath);
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (['/', '/index.html'].includes(pathname)) {
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}).end(html);
    } else if (pathname === '/favicon.ico') {
      res.writeHead(204).end();
    } else if (/^\/(?:assets\/[\w.\/-]+\.(?:webp|jpg|png|css|js)|screen-index\.json)$/.test(pathname) && !pathname.includes('..')) {
      try {
        const file = await fs.readFile(path.join(path.dirname(documentPath), pathname));
        const type = {webp:'image/webp',jpg:'image/jpeg',png:'image/png',css:'text/css',js:'text/javascript',json:'application/json'}[path.extname(pathname).slice(1)];
        res.writeHead(200, {'Content-Type':type}).end(file);
      } catch { res.writeHead(404).end(); }
    } else { res.writeHead(404).end(); }
  });
  await new Promise((ok, fail) => server.once('error', fail).listen(0,'127.0.0.1',ok));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch(channel ? {channel} : {});
    const context = await browser.newContext({viewport:{width:1440,height:960}, serviceWorkers:'block'});
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      return u.origin === origin || ['blob:', 'data:'].includes(u.protocol) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.name));
    page.setDefaultTimeout(12000);
    const loc = selector => page.locator(selector);
    const visible = selector => loc(selector).first().waitFor({state:'visible'});
    async function tab(name) {
      await page.waitForTimeout(60);
      const button = loc('.tabbtn[data-view="' + name + '"]');
      if (!(await button.isVisible())) {
        const menuOpen = await loc('#viewTabs').evaluate(el => el.classList.contains('open'));
        if (!menuOpen) await loc('#tabMenuBtn').click();
        await button.waitFor({state:'visible'});
      }
      await button.click({force:true});
    }
    await page.goto(origin);
    const cards = loc('#sectionsContainer .card[data-sec]');
    await cards.first().waitFor();
    const total = await cards.count();
    await loc('#searchInput').fill('zzzzzz-test-no-results');
    assert.equal(await cards.count(), 0);
    await loc('#btnSearchClear').click();
    assert.equal(await cards.count(), total);
    await loc('#filterToggle').click();
    await loc('#jurChips button').first().click();
    assert.ok((await cards.count()) > 0 && (await cards.count()) < total);
    await loc('#clearFilters').click();
    assert.equal(await cards.count(), total);
    await cards.first().locator('h4, h3').first().click();
    await visible('#modalTitle');
    assert.ok((await loc('#modalSource a').count()) > 0);
    await loc('#modalClose').click();
    for (const [name, selector] of [['guide','#viewGuide'],['export','#viewExport'],['ru','#viewRu'],['justice','#viewJustice'],['fatca','#viewFatca'],['workplace','#wsLock'],['events','#evLock']]) {
      await tab(name); await visible(selector);
    }
    await tab('justice');
    const justiceCards = loc('#justiceContainer .card[data-justicesec]');
    assert.ok(await justiceCards.count() >= 15, 'bringing-to-justice cards are missing');
    await loc('#justiceSearchInput').fill('Суворов');
    assert.equal(await justiceCards.count(), 1);
    await justiceCards.first().click(); await visible('#modalTitle');
    assert.ok((await loc('#modalSource a').count()) > 0); await loc('#modalClose').click();
    await loc('#btnJusticeSearchClear').click();
    await tab('fatca');
    const fatcaUpdateCard = loc('#fatcaCardsContainer .card[data-fatcasec]');
    assert.equal(await fatcaUpdateCard.count(), 1);
    await tab('map');
    const badChangeLinks = await page.evaluate(() => [...document.querySelectorAll('#changelogList button.lnk,#changelogRest button.lnk')].filter(b => !openCardByRef(b.dataset.refGroup,b.dataset.refSec,b.dataset.refTitle)).map(b => `${b.dataset.refGroup}/${b.dataset.refSec}/${b.dataset.refTitle}`));
    assert.deepEqual(badChangeLinks, [], 'changelog contains a link to a missing card');
    await loc('#modalClose').click();
    console.log('PASS open tabs, search, filters, card and source (' + total + ' initial cards)');

    async function gate(input, button, error, keyFile, success) {
      await loc(input).fill(wrongPassword);
      await loc(button).click();
      await visible(error);
      assert.match(await loc(error).innerText(), /неверн/i);
      if (keyDir) {
        const password = (await fs.readFile(path.join(keyDir, keyFile),'utf8')).trim();
        // No tracing, console logging of input, or network beyond the local test server.
        await loc(input).fill(password);
        await loc(button).click();
        await visible(success);
      }
    }
    await tab('events');
    await gate('#evPassInput','#evPassSubmit','#evPassError','cm-events-key.txt','#evApp');
    if (keyDir) {
      for(let i=0; i<8; i++) await loc('#evApp .ev-nav button').nth(i).click();
      await page.getByRole('button',{name:'Администратор',exact:true}).click();
      await gate('#evAdm1','.ev-modal .ev-btn:not(.ghost)','.ev-modal .err','cm-events-key-admin.txt','.ev-admin');
      await page.getByRole('button',{name:'Закрыть раздел',exact:true}).click();
      await visible('#evLock');
    }
    await tab('workplace');
    await gate('#wsPassInput','#wsPassSubmit','#wsPassError','cm-key.txt','#wsApp');
    if (keyDir) {
      for(const name of ['queue','party','mail','ai','ask']) {
        await loc('#wsNav button[data-t="' + name + '"]').click();
        await visible('#wsApp section[data-p="' + name + '"]');
      }
      await loc('#wsClose').click();
      await visible('#wsLock');
    }
    await tab('restricted');
    await gate('#restrictedAuthPasswordInput','#restrictedAuthSubmit','#restrictedAuthError','cm-key.txt','#viewRestricted .card');
    if (!keyDir) await loc('#restrictedAuthClose').click();
    await tab('map');
    await loc('#btnAuth').click();
    await gate('#authPasswordInput','#authSubmit','#authError','cm-digest-key.txt','#authStatus:not(:empty)');
    if (!keyDir) await loc('#authClose').click();
    console.log(keyDir ? 'PASS wrong and correct keys, including event administrator; workplace and event tabs' : 'PASS access gates reject wrong keys (private positive tests require CM_KEY_DIR)');
    await page.reload();
    assert.equal(await loc('#authStatus').innerText(), '');
    assert.equal(await loc('#evApp').innerHTML(), '');
    assert.equal(await loc('#wsApp').innerHTML(), '');
    const pixelsChange = await page.evaluate(async () => {
      const canvas = document.getElementById('waterBG');
      if (!canvas || canvas.width < 10 || canvas.height < 10) return false;
      const sample = () => {
        const tiny = document.createElement('canvas'); tiny.width = 64; tiny.height = 48;
        tiny.getContext('2d').drawImage(canvas,0,0,64,48); return tiny.toDataURL();
      };
      const first = sample(); await new Promise(resolve => setTimeout(resolve,450)); return first !== sample();
    });
    assert.ok(pixelsChange, 'background animation changes rendered pixels');
    const iceMotion = await page.evaluate(() => {
      const before = getComputedStyle(document.body,'::before');
      const after = getComputedStyle(document.body,'::after');
      return [before.animationName,before.animationPlayState,after.animationName,after.animationPlayState];
    });
    assert.notEqual(iceMotion[0], 'none'); assert.equal(iceMotion[1], 'running');
    assert.notEqual(iceMotion[2], 'none'); assert.equal(iceMotion[3], 'running');
    await page.setViewportSize({width:390,height:844});
    await tab('guide'); await visible('#viewGuide');
    await tab('map'); await visible('#viewMap');
    const sizes = await page.evaluate(() => [document.documentElement.scrollWidth,window.innerWidth]);
    assert.ok(sizes[0] <= sizes[1] + 1, 'mobile document overflows horizontally: ' + sizes);
    assert.deepEqual(errors, [], 'unhandled page errors');
    console.log('PASS session reset, animated canvas, 390px navigation and overflow, no uncaught browser errors');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error.message.replace(/filling "[^"]*"/g,'filling [redacted]')); process.exitCode=1; });
