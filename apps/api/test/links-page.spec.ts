import { LINKS_PAGE_HTML } from '../src/links-page';

describe('Gerador de Links Panzeri', () => {
  it('é uma página isolada, sem instrumentação da landing', () => {
    expect(LINKS_PAGE_HTML).toContain('name="robots" content="noindex,nofollow"');
    expect(LINKS_PAGE_HTML).not.toContain('googletagmanager.com');
    expect(LINKS_PAGE_HTML).not.toContain('clarity.ms');
    expect(LINKS_PAGE_HTML).not.toContain('landing_view');
    expect(LINKS_PAGE_HTML).not.toContain('/analytics/event');
  });

  it('gera UTMs com URLSearchParams e mantém histórico somente local', () => {
    // 13/11/2026: o gerador ganhou o destino (landing/Play/Apple): a URL base agora vem de bases[destinoValue].
    expect(LINKS_PAGE_HTML).toContain('const url=new URL(bases[destinoValue])');
    expect(LINKS_PAGE_HTML).toContain("url.searchParams.set('utm_source',sourceValue)");
    expect(LINKS_PAGE_HTML).toContain("localStorage.getItem(key)");
    expect(LINKS_PAGE_HTML).toContain('slice(0,10)');
    expect(LINKS_PAGE_HTML).toContain('const normalize=value=>');
  });
});
