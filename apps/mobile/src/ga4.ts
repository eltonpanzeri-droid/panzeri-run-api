const MEASUREMENT_ID = 'G-ZJXHZVSDL8';

type AnalyticsWindow = {
  location: { origin: string; pathname: string; search: string };
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  document: {
    referrer: string;
    createElement: (tag: string) => { async: boolean; src: string; id: string };
    head: { appendChild: (script: unknown) => void };
  };
};

let initialized = false;
let previousPage: string | null = null;

// Preserve attribution, but never send login tokens or arbitrary query values.
function safePageUrl(location: AnalyticsWindow['location']) {
  const params = new URLSearchParams(location.search);
  const attribution = new URLSearchParams();
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']) {
    const value = params.get(key);
    if (value) attribution.set(key, value);
  }
  return `${location.origin}${location.pathname}${attribution.size ? `?${attribution}` : ''}`;
}

// Called only by the Web UI after session restoration. No internal funnel calls.
export function trackWebPageView(screen: string, tab: string) {
  const browser = (globalThis as unknown as { window?: AnalyticsWindow }).window;
  if (!browser?.document || !browser.location) return;
  const page = `${safePageUrl(browser.location)}#/${screen === 'app' ? `app/${tab}` : 'login'}`;
  if (page === previousPage) return;
  try {
    if (!initialized) {
      browser.dataLayer = browser.dataLayer || [];
      browser.gtag = browser.gtag || function (...args: unknown[]) {
        browser.dataLayer!.push(args);
      };
      browser.gtag('js', new Date());
      browser.gtag('config', MEASUREMENT_ID, { send_page_view: false, page_location: page });
      const loader = browser.document.createElement('script');
      loader.id = 'panzeri-run-ga4';
      loader.async = true;
      loader.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
      browser.document.head.appendChild(loader);
      initialized = true;
    }
    let referrer = previousPage || '';
    if (!referrer && browser.document.referrer) {
      const source = new URL(browser.document.referrer);
      referrer = `${source.origin}${source.pathname}`;
    }
    browser.gtag!('event', 'page_view', {
      send_to: MEASUREMENT_ID,
      page_location: page,
      page_title: `Panzeri Run | ${screen === 'app' ? tab : 'login'}`,
      page_referrer: referrer,
    });
    previousPage = page;
  } catch {
    // Analytics must never interrupt authentication, navigation, or rendering.
  }
}
