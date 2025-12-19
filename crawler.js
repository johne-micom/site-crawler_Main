
// crawler.js (CommonJS)
// Enhanced Playwright crawler with rich extraction & BFS crawl

const { chromium } = require('playwright');

const DEFAULTS = {
  maxDepth: 1,            // BFS depth limit
  maxPages: 100,          // global cap to avoid runaway crawls
  sameOriginOnly: true,   // restrict to baseUrl origin
  requestDelayMs: 250,    // polite delay between navigations
  navigationTimeoutMs: 30000,
  headless: true
};

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = ''; // ignore fragments for de-dupe
    if (!url.pathname) url.pathname = '/';
    return url.toString();
  } catch {
    return u;
  }
}

function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

function isCrawlable(href) {
  if (!href) return false;
  const h = href.toLowerCase();
  return !(h.startsWith('mailto:') || h.startsWith('tel:') || h.startsWith('javascript:'));
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function crawlSite(baseUrl, maxDepth) {
  const opts = {
    ...DEFAULTS,
    ...(typeof maxDepth === 'number' ? { maxDepth } : {})
  };

  const baseOrigin = new URL(baseUrl).origin;
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: opts.headless
  });
  const context = await browser.newContext();

  const visited = new Set();
  const pages = [];
  const queue = [{ url: baseUrl, depth: 0 }];
  let processed = 0;

  try {
    while (queue.length) {
      if (processed >= opts.maxPages) break;

      const { url, depth } = queue.shift();
      const normalized = normalizeUrl(url);

      // depth and de-dupe checks
      if (depth > opts.maxDepth || visited.has(normalized)) continue;
      if (opts.sameOriginOnly && !sameOrigin(url, baseOrigin)) continue;

      visited.add(normalized);
      processed++;

      if (opts.requestDelayMs) await delay(opts.requestDelayMs);

      const page = await context.newPage();
      let response, finalUrl, status;

      try {
        response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: opts.navigationTimeoutMs
        });
        status = response ? response.status() : null;
        finalUrl = page.url();
      } catch (e) {
        // Record minimal info and continue
        pages.push({
          urlRequested: url,
          urlFinal: page.url() || url,
          status: null,
          error: e.message
        });
        await page.close();
        continue;
      }

      // Current hostname (used outside page context)
      const currentHost = (() => {
        try { return new URL(finalUrl).hostname; } catch { return null; }
      })();

      // ---- Rich extraction in page context ----
      const details = await page.evaluate(() => {
        const $all = sel => Array.from(document.querySelectorAll(sel));

        const title = document.title || null;

        const meta = {
          description: document.querySelector('meta[name="description"]')?.content || null,
          keywords: document.querySelector('meta[name="keywords"]')?.content || null,
          canonical: document.querySelector('link[rel="canonical"]')?.href || null,
          viewport: document.querySelector('meta[name="viewport"]')?.content || null,
          robots: document.querySelector('meta[name="robots"]')?.content || null,
          hreflang: $all('link[rel="alternate"][hreflang]').map(l => ({
            lang: l.getAttribute('hreflang') || null,
            href: l.href || null
          }))
        };

        // Headings
        const headings = ['h1','h2','h3','h4','h5','h6']
          .flatMap(tag => $all(tag).map(el => ({ tag, text: (el.textContent || '').trim() })));

        // ARIA landmarks & roles
        const landmarks = [];
        ['header','nav','main','aside','footer','section','article','form'].forEach(tag => {
          $all(tag).forEach(el => {
            landmarks.push({
              tag,
              role: el.getAttribute('role') || null,
              ariaLabel: el.getAttribute('aria-label') || null
            });
          });
        });
        $all('[role]').forEach(el => {
          landmarks.push({
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') || null,
            ariaLabel: el.getAttribute('aria-label') || null
          });
        });

        // Images
        const images = $all('img').map(img => ({
          src: img.src || null,
          alt: img.getAttribute('alt') || null,
          width: img.getAttribute('width') || null,
          height: img.getAttribute('height') || null
        }));

        // Buttons
        const buttons = $all('button, [role="button"], input[type="button"], input[type="submit"]')
          .map(btn => ({
            text: (btn.innerText || btn.value || '').trim(),
            enabled: !btn.disabled,
            id: btn.id || null,
            classes: btn.className || null
          }));

        // Links (absolute)
        const links = $all('a[href]').map(a => {
          const href = a.getAttribute('href');
          try {
            const abs = new URL(href, location.href).href;
            return { href: abs, text: (a.textContent || '').trim(), rel: a.getAttribute('rel') || null };
          } catch {
            return null;
          }
        }).filter(Boolean);

        // Forms & fields with labels/validations
        const forms = $all('form').map((form, idx) => {
          const fields = Array.from(form.elements || []).map(el => {
            const type = (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase();
            const name = el.getAttribute('name') || el.id || null;
            const required = el.hasAttribute('required');
            const minLength = el.getAttribute('minlength');
            const maxLength = el.getAttribute('maxlength');
            const pattern = el.getAttribute('pattern');
            const placeholder = el.getAttribute('placeholder') || null;

            // labels: for=id OR ancestor <label>
            const id = el.id || null;
            let label = null;
            if (id) {
              const lab = document.querySelector(`label[for="${id}"]`);
              if (lab) label = (lab.textContent || '').trim();
            }
            if (!label) {
              const anc = el.closest('label');
              if (anc) label = (anc.textContent || '').trim();
            }

            const validations = [];
            if (required) validations.push('required');
            if (minLength) validations.push(`minlength:${minLength}`);
            if (maxLength) validations.push(`maxlength:${maxLength}`);
            if (pattern) validations.push(`pattern:${pattern}`);

            return { type, name, id, required, minLength, maxLength, pattern, placeholder, label, validations };
          });

          const unlabeledControls = fields.filter(f =>
            !f.label && ['text','email','password','search','tel','url','number'].includes(f.type)
          ).length;

          return {
            index: idx,
            action: form.getAttribute('action') ? new URL(form.getAttribute('action'), location.href).href : null,
            method: (form.getAttribute('method') || 'GET').toUpperCase(),
            fields,
            a11y: { unlabeledControls }
          };
        });

        // Visible text (for content indexing)
        const visibleText = document.body ? (document.body.innerText || '').trim() : '';

        // Error messages
        const errorMessages = $all('.error, .alert, .validation-error').map(el => (el.innerText || '').trim());

        // Performance (approx via Performance API)
        const perf = (() => {
          const t = performance?.timing;
          if (!t) return {};
          const base = t.navigationStart || 0;
          return {
            domContentLoadedMs: (t.domContentLoadedEventEnd || 0) - base || null,
            loadEventMs: (t.loadEventEnd || 0) - base || null
          };
        })();

        // OpenGraph / Twitter card
        const openGraph = {};
        $all('meta[property^="og:"]').forEach(m => { openGraph[m.getAttribute('property')] = m.getAttribute('content'); });
        const twitterCard = {};
        $all('meta[name^="twitter:"]').forEach(m => { twitterCard[m.getAttribute('name')] = m.getAttribute('content'); });

        // Scripts (absolute)
        const scripts = $all('script[src]').map(s => {
          try { return new URL(s.getAttribute('src'), location.href).href; } catch { return null; }
        }).filter(Boolean);

        // Schema.org JSON-LD
        const schemaOrg = $all('script[type="application/ld+json"]').map(s => {
          try {
            const obj = JSON.parse(s.textContent || '{}');
            return { '@type': obj['@type'] || null, name: obj['name'] || null, url: obj['url'] || null };
          } catch { return { '@type': null }; }
        });

        return { title, meta, headings, landmarks, images, buttons, links, forms, visibleText, errorMessages, perf, openGraph, twitterCard, scripts, schemaOrg };
      });

      // Third-party script classification (outside page context; avoid window)
      const thirdPartyScripts = (details.scripts || []).filter(src => {
        try { return new URL(src).hostname !== currentHost; } catch { return false; }
      });

      // Accessibility quick counts
      const missingAltCount = (details.images || []).filter(img => !img.alt || img.alt.trim().length === 0).length;

      // Cookies for this origin
      const cookies = await context.cookies(finalUrl);

      // Record page
      pages.push({
        urlRequested: url,
        urlFinal: finalUrl,
        status,
        title: details.title,
        meta: details.meta,
        openGraph: details.openGraph,
        twitterCard: details.twitterCard,
        schemaOrg: details.schemaOrg,
        headings: details.headings,
        landmarks: details.landmarks,
        images: details.images,
        buttons: details.buttons,
        links: details.links.map(l => ({ ...l, sameOrigin: sameOrigin(finalUrl, l.href) })),
        forms: details.forms,
        visibleText: details.visibleText,
        errorMessages: details.errorMessages,
        perf: details.perf,
        scripts: details.scripts,
        thirdParty: thirdPartyScripts,
        cookies,
        a11ySummary: {
          imagesMissingAlt: missingAltCount,
          unlabeledFormControls: details.forms.reduce((acc, f) => acc + (f.a11y?.unlabeledControls || 0), 0)
        }
      });

      // Enqueue BFS links within depth budget
      const nextDepth = depth + 1;
      if (nextDepth <= opts.maxDepth) {
        for (const l of details.links) {
          if (!isCrawlable(l.href)) continue;
          if (opts.sameOriginOnly && !sameOrigin(l.href, baseOrigin)) continue;
          const norm = normalizeUrl(l.href);
          if (!visited.has(norm)) queue.push({ url: l.href, depth: nextDepth });
        }
      }

      await page.close();
    }

    return {
      baseUrl,
      maxDepth: opts.maxDepth,
      maxPages: opts.maxPages,
      pages,
      stats: { uniqueVisited: visited.size, processed }
    };

  } finally {
    await browser.close();
  }
}


