import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { LinkJourneyDto, RecordEventDto } from '../src/funnel/funnel.controller';
import { FunnelService } from '../src/funnel/funnel.service';
import { script as landingScript } from '../src/landing/script';

const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const body = (metatype: new () => object) => ({ type: 'body' as const, metatype });

// ---------------------------------------------------------------------------------------------
// Harness: executa o script REAL da Landing num sandbox (sem navegador) e captura o que ele faz.
// ---------------------------------------------------------------------------------------------
type Stored = Map<string, string>;
const storage = (m: Stored) => ({
  getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
  setItem: (k: string, v: string) => void m.set(k, String(v)),
});
const fakeElement = (): unknown => new Proxy(function () {}, {
  get: (_t, p) => (p === 'then' ? undefined : p === 'textContent' ? '' : p === 'dataset' ? {} : fakeElement()),
  apply: () => fakeElement(),
  set: () => true,
});

function runLanding(opts: { search: string; referrer?: string; local: Stored; session: Stored; cookie?: string; fetchThrows?: boolean }) {
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const link = {
    href: '',
    dataset: { track: 'hero_cta_click' } as Record<string, string>,
    listeners: {} as Record<string, () => void>,
    addEventListener(type: string, fn: () => void) { this.listeners[type] = fn; },
  };
  const dataLayer: unknown[] = [];
  const doc = {
    cookie: opts.cookie ?? '',
    referrer: opts.referrer ?? '',
    getElementById: (id: string) => (id === 'landing-config'
      ? { textContent: JSON.stringify({ checkoutUrl: 'https://panzerirun.example.com/', results: [] }) }
      : fakeElement()),
    querySelectorAll: (sel: string) => (sel === '[data-checkout]' ? [link] : []),
  };
  const sandbox: Record<string, unknown> = {
    document: doc,
    location: { search: opts.search, origin: 'https://landing.example.com', href: 'https://landing.example.com/' + opts.search },
    localStorage: storage(opts.local),
    sessionStorage: storage(opts.session),
    crypto: { randomUUID },
    fetch: (url: string, init: { body: string }) => {
      if (opts.fetchThrows) throw new Error('rede indisponivel');
      posts.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve({});
    },
    URL, URLSearchParams, JSON, Object, Math, Date, String, Number,
    addEventListener: () => undefined,
    scrollY: 0,
    dataLayer,
  };
  sandbox.window = sandbox;
  // O modulo exporta o codigo como string de template: `(()=>{...})();`
  runInNewContext(landingScript, sandbox);
  return { posts, link, dataLayer };
}

describe('Landing: identidade e persistencia (script real executado em sandbox)', () => {
  const UTM = '?utm_source=instagram&utm_medium=story&utm_campaign=teste_jornada&utm_content=teste_longitudinal';

  it('A/B/C/D — landing_view persistido com journeyId e a origem completa (incl. utm_content)', () => {
    const { posts } = runLanding({ search: UTM, local: new Map(), session: new Map() });
    const view = posts.find((p) => p.body.event === 'landing_view');
    expect(view).toBeDefined();
    expect(view!.url).toBe('/analytics/event');
    expect(view!.body.journeyId).toMatch(/^[0-9a-f-]{36}$/);
    expect(view!.body.metadata).toMatchObject({
      source: 'instagram', medium: 'story', campaign: 'teste_jornada', content: 'teste_longitudinal',
    });
  });

  it('journeyId e sessionId sao identidades DIFERENTES (nunca sinonimos)', () => {
    const { posts } = runLanding({ search: UTM, local: new Map(), session: new Map() });
    const b = posts.find((p) => p.body.event === 'landing_view')!.body;
    expect(b.sessionId).toBeTruthy();
    expect(b.sessionId).not.toBe(b.journeyId);
  });

  it('E/F — o clique Landing -> Panzeri Run e um evento SEPARADO (landing_cta_click) e preserva journeyId; nao e payment_started', () => {
    const { posts, link } = runLanding({ search: UTM, local: new Map(), session: new Map() });
    const journeyId = posts.find((p) => p.body.event === 'landing_view')!.body.journeyId;
    link.listeners.click();
    const click = posts.find((p) => p.body.event === 'landing_cta_click');
    expect(click).toBeDefined();
    expect(click!.body.journeyId).toBe(journeyId);
    expect(click!.body.metadata).toMatchObject({ source: 'instagram', content: 'teste_longitudinal', cta: 'hero_cta_click' });
    expect(posts.some((p) => p.body.event === 'payment_started')).toBe(false);
  });

  it('G — o link para o Panzeri Run carrega journey_id + UTMs (elo deterministico Landing -> PWA)', () => {
    const { posts, link } = runLanding({ search: UTM, local: new Map(), session: new Map() });
    const journeyId = posts.find((p) => p.body.event === 'landing_view')!.body.journeyId as string;
    const url = new URL(link.href);
    expect(url.searchParams.get('journey_id')).toBe(journeyId);
    expect(url.searchParams.get('utm_content')).toBe('teste_longitudinal');
    expect(url.searchParams.get('utm_medium')).toBe('story');
  });

  it('K — retorno no mesmo navegador: MESMA jornada, NOVA sessao, cada visita com a origem da propria visita', () => {
    const local: Stored = new Map();
    const first = runLanding({ search: UTM, local, session: new Map() });
    const second = runLanding({ search: '', referrer: 'https://www.google.com/search?q=x', local, session: new Map() });
    const v1 = first.posts.find((p) => p.body.event === 'landing_view')!.body;
    const v2 = second.posts.find((p) => p.body.event === 'landing_view')!.body;
    expect(v2.journeyId).toBe(v1.journeyId);
    expect(v2.sessionId).not.toBe(v1.sessionId);
    // 2a visita nao tinha UTM: nada e inventado — so o referrer real.
    expect(v2.metadata).toEqual({ referrer: 'https://www.google.com/search?q=x' });
  });

  it('O/27 — visita direta sem UTM e sem referrer: origem ausente continua ausente', () => {
    const { posts } = runLanding({ search: '', local: new Map(), session: new Map() });
    expect(posts.find((p) => p.body.event === 'landing_view')!.body.metadata).toEqual({});
  });

  it('dedupeKey por SESSAO: recarregar a mesma sessao nao duplica; nova sessao gera nova visita', () => {
    const session: Stored = new Map();
    const local: Stored = new Map();
    const a = runLanding({ search: UTM, local, session }).posts.find((p) => p.body.event === 'landing_view')!.body;
    const b = runLanding({ search: UTM, local, session }).posts.find((p) => p.body.event === 'landing_view')!.body;
    expect(a.dedupeKey).toBe(b.dedupeKey); // mesma sessao -> mesma chave (o banco descarta a repetida)
    const c = runLanding({ search: UTM, local, session: new Map() }).posts.find((p) => p.body.event === 'landing_view')!.body;
    expect(c.dedupeKey).not.toBe(a.dedupeKey);
  });

  it('privacidade: cookies Meta (_fbp/_fbc) e fbclid nao vao para os eventos internos alem do que ja era atribuicao', () => {
    const { posts } = runLanding({ search: UTM, local: new Map(), session: new Map(), cookie: '_fbp=fb.1.123.456; _fbc=fb.1.1.abc' });
    const meta = JSON.stringify(posts.map((p) => p.body.metadata));
    expect(meta).not.toContain('_fbp');
    expect(meta).not.toContain('fb.1.123.456');
  });

  it('Meta: o click continua repassando _fbp/_fbc ao PWA (CAPI existente nao foi quebrado)', () => {
    const { link } = runLanding({ search: UTM + '&fbclid=ABC', local: new Map(), session: new Map(), cookie: '_fbp=fb.1.123.456' });
    link.listeners.click();
    const url = new URL(link.href);
    expect(url.searchParams.get('_fbp')).toBe('fb.1.123.456');
    expect(url.searchParams.get('_fbc')).toMatch(/^fb\.1\.\d+\.ABC$/);
  });

  it('dataLayer existente continua recebendo landing_view (GTM/pixel nao quebrados)', () => {
    const { dataLayer } = runLanding({ search: UTM, local: new Map(), session: new Map() });
    expect(dataLayer).toContainEqual({ event: 'landing_view' });
  });

  it('falha de analytics nao impede a Landing (fetch lancando nao propaga e o resto da pagina carrega)', () => {
    let result: ReturnType<typeof runLanding> | undefined;
    expect(() => {
      result = runLanding({ search: UTM, local: new Map(), session: new Map(), fetchThrows: true });
    }).not.toThrow();
    // o script chegou ao fim: o dataLayer registrou landing_view e o link do CTA foi montado
    expect(result!.dataLayer).toContainEqual({ event: 'landing_view' });
    expect(new URL(result!.link.href).searchParams.get('journey_id')).toBeTruthy();
    expect(() => result!.link.listeners.click()).not.toThrow();
  });
});

describe('Funil: validacao, idempotencia e vinculo de identidade', () => {
  it('aceita o payload completo da Landing (journeyId + dedupeKey + origem em metadata)', async () => {
    await expect(pipe.transform({
      sessionId: 's-1', journeyId: 'j-1', event: 'landing_view', dedupeKey: 's-1:landing_view',
      metadata: { source: 'instagram', medium: 'story', campaign: 'c', content: 'x' },
    }, body(RecordEventDto))).resolves.toMatchObject({ event: 'landing_view', journeyId: 'j-1' });
  });

  it('service grava journeyId/dedupeKey e ignora violacao de dedupeKey (P2002) sem propagar', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce({ id: '1' })
      .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    const service = new FunnelService({ funnelEvent: { create } } as never, {} as never);
    const params = { sessionId: 's', journeyId: 'j', event: 'landing_view', dedupeKey: 's:landing_view' };
    await service.record(params);
    await expect(service.record(params)).resolves.toBeUndefined();
    expect(create.mock.calls[0][0].data).toMatchObject({ journeyId: 'j', dedupeKey: 's:landing_view', userId: null });
  });

  it('I/J — linkJourney grava um evento journey_linked (userId + journeyId) e nunca reescreve eventos anonimos', async () => {
    const create = jest.fn().mockResolvedValue({});
    const update = jest.fn();
    const updateMany = jest.fn();
    const service = new FunnelService({ funnelEvent: { create, update, updateMany } } as never, {} as never);
    await service.linkJourney('user-1', 'journey-1', 'sess-1', 'signup');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      event: 'journey_linked', userId: 'user-1', journeyId: 'journey-1', sessionId: 'sess-1',
      dedupeKey: 'journey_linked:user-1:journey-1', metadata: { via: 'signup' },
    });
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled(); // historico anonimo permanece intacto
  });

  it('linkJourney sem sessionId usa fallback backend:<userId>', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = new FunnelService({ funnelEvent: { create } } as never, {} as never);
    await service.linkJourney('user-9', 'journey-9', undefined, 'login');
    expect(create.mock.calls[0][0].data.sessionId).toBe('backend:user-9');
  });

  it('LinkJourneyDto: o userId NAO pode vir no corpo (vem do JWT) e journeyId e validado', async () => {
    await expect(pipe.transform({ journeyId: 'abc-123_XYZ', via: 'signup' }, body(LinkJourneyDto))).resolves.toBeDefined();
    await expect(pipe.transform({ journeyId: 'abc-123', userId: 'outro-usuario' }, body(LinkJourneyDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ journeyId: 'com espaco!' }, body(LinkJourneyDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ journeyId: 'ok-id', via: 'hack' }, body(LinkJourneyDto))).rejects.toBeInstanceOf(BadRequestException);
  });
});
