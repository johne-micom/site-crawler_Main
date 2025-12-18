
const { chromium } = require('playwright');

async function crawlSite(baseUrl, maxDepth) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const visited = new Set();
  const pages = [];

  async function crawl(url, depth) {
    if (depth > maxDepth || visited.has(url)) return;
    visited.add(url);

    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {
      await page.close();
      return;
    }

    // Extract meta tags, titles, descriptions, canonical links
    const meta = await page.evaluate(() => ({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      canonical: document.querySelector('link[rel="canonical"]')?.href || '',
      viewport: document.querySelector('meta[name="viewport"]')?.content || '',
      robots: document.querySelector('meta[name="robots"]')?.content || ''
    }));

    // Extract all forms and their fields/validation
    const forms = await page.$$eval('form', forms => forms.map(form => {
      const fields = Array.from(form.elements).map(el => ({
        name: el.name || el.id || '',
        type: el.type || el.tagName.toLowerCase(),
        required: el.required || false,
        minLength: el.minLength || null,
        maxLength: el.maxLength || null,
        pattern: el.pattern || null,
        placeholder: el.placeholder || ''
      }));
      const validations = [];
      fields.forEach(f => {
        if (f.required) validations.push('required');
        if (f.minLength && f.minLength > 0) validations.push('minLength:' + f.minLength);
        if (f.maxLength && f.maxLength > 0) validations.push('maxLength:' + f.maxLength);
        if (f.pattern) validations.push('pattern:' + f.pattern);
      });
      return { fields, validations };
    }));

    // Extract all buttons and clickable elements
    const buttons = await page.$$eval('button, [role="button"], input[type="button"], input[type="submit"]', btns =>
      btns.map(btn => ({
        text: btn.innerText || btn.value || '',
        enabled: !btn.disabled,
        id: btn.id || '',
        classes: btn.className || ''
      }))
    );

    // Extract all links
    const links = await page.$$eval('a[href]', as =>
      as.map(a => a.href).filter(href => href.startsWith('http'))
    );

    // Extract ARIA roles and accessibility info
    const accessibility = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img')).map(img => ({
        src: img.src,
        alt: img.alt
      }));
      const aria = Array.from(document.querySelectorAll('[aria-label], [role]')).map(el => ({
        role: el.getAttribute('role'),
        label: el.getAttribute('aria-label')
      }));
      return { images, aria };
    });

    // Extract visible text content
    const visibleText = await page.evaluate(() => document.body.innerText);

    // Extract error messages (common patterns)
    const errorMessages = await page.$$eval('.error, .alert, .validation-error', els =>
      els.map(el => el.innerText)
    );

    // Extract performance metrics
    const perf = await page.evaluate(() => {
      if (window.performance && window.performance.timing) {
        const t = window.performance.timing;
        return {
          navigationStart: t.navigationStart,
          domContentLoaded: t.domContentLoadedEventEnd - t.navigationStart,
          loadEvent: t.loadEventEnd - t.navigationStart
        };
      }
      return {};
    });

    // Extract all scripts and third-party resources
    const scripts = await page.$$eval('script[src]', scripts => scripts.map(s => s.src));
    const thirdParty = scripts.filter(src => {
      try {
        return (new URL(src)).hostname !== window.location.hostname;
      } catch {
        return false;
      }
    });

    // Extract cookies
    const cookies = await context.cookies(url);

    // Add all extracted info to your page object
    pages.push({
      url,
      meta,
      forms,
      buttons,
      links,
      visibleText,
      errorMessages,
      accessibility,
      perf,
      scripts,
      thirdParty,
      cookies
    });

    // Crawl further
    for (const link of links) {
      if (link.startsWith(baseUrl)) {
        await crawl(link, depth + 1);
      }
    }
    await page.close();
  }

  await crawl(baseUrl, 5);
  await browser.close();
  return { pages };
}

module.exports = { crawlSite };

