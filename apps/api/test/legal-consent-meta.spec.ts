import { EventEmitter } from 'events';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const https = require('node:https') as { request: unknown };
import { AuthService } from '../src/auth/auth.service';
import { MetaCapiService } from '../src/meta/meta-capi.service';
import { LEGAL_UPDATED_LABEL, LEGAL_VERSION, PRIVACY_SECTIONS } from '../src/legal/legal-content';

// Ajustes finais do Bloco 3 (05/10/2026): versao juridica do aceite e descricao factual do Meta CAPI.

describe('versao juridica aceita no cadastro', () => {
  function build() {
    const created: Array<Record<string, any>> = [];
    const prisma = {
      user: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: { data: Record<string, any> }) => { created.push(data); return { id: 'u1', email: data.email, name: data.name, role: 'student' }; }),
        update: jest.fn(async () => ({})),
      },
    };
    const jwt = { signAsync: jest.fn(async () => 'jwt') };
    const config = { get: jest.fn(() => undefined) };
    const metaCapi = { sendEvent: jest.fn() };
    const service = new AuthService(prisma as never, jwt as never, config as never, metaCapi as never);
    return { service, created, prisma, metaCapi };
  }
  const dto = { email: 'Novo@Aluno.com', password: 'senha-12345', name: 'Novo', acceptedTerms: true, acceptedExerciseResponsibility: true } as never;

  it('novo cadastro grava LEGAL_VERSION junto com os timestamps ja existentes', async () => {
    const { service, created } = build();
    await service.register(dto);
    expect(created[0].acceptedTermsVersion).toBe(LEGAL_VERSION);
    expect(created[0].acceptedPrivacyVersion).toBe(LEGAL_VERSION);
    expect(created[0].acceptedTermsAt).toBeInstanceOf(Date);
    expect(created[0].acceptedPrivacyAt).toBeInstanceOf(Date);
  });

  it('LEGAL_VERSION e o mesmo valor impresso nos documentos publicados (versao dos textos exibidos no aceite)', () => {
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const alteracoes = PRIVACY_SECTIONS.find((s) => s.id === 'alteracoes')!.paragraphs.join(' ');
    expect(alteracoes).toContain(LEGAL_UPDATED_LABEL);
  });

  it('sem aceite continua recusando o cadastro e nada e criado', async () => {
    const { service, prisma } = build();
    await expect(service.register({ ...(dto as object), acceptedTerms: false } as never)).rejects.toThrow();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('usuarios antigos: colunas opcionais (null), sem backfill na migration e sem reaceite forcado no login/refresh', () => {
    const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');
    expect(schema).toMatch(/acceptedTermsVersion\s+String\?/);
    expect(schema).toMatch(/acceptedPrivacyVersion\s+String\?/);
    const migration = readFileSync(join(__dirname, '../prisma/migrations/20261005120000_add_accepted_legal_versions/migration.sql'), 'utf8');
    expect(migration).toContain('ADD COLUMN "acceptedTermsVersion" TEXT;');
    expect(migration).toContain('ADD COLUMN "acceptedPrivacyVersion" TEXT;');
    expect(migration).not.toMatch(/NOT NULL|DEFAULT|UPDATE\s/i);
    const auth = readFileSync(join(__dirname, '../src/auth/auth.service.ts'), 'utf8');
    expect(auth.match(/acceptedTermsVersion/g)).toHaveLength(1); // so' o cadastro escreve; login/refresh nao leem nem exigem
    expect(auth).not.toMatch(/acceptedTermsVersion\s*[!=]==?\s*LEGAL_VERSION/);
  });
});

describe('Meta CAPI — o que de fato e enviado', () => {
  const originalRequest = https.request;
  afterEach(() => { https.request = originalRequest; });

  function captureSend(params: Parameters<MetaCapiService['sendEvent']>[0]) {
    let body = '';
    let host = '';
    https.request = jest.fn((options: { hostname: string }) => {
      host = options.hostname;
      const req = new EventEmitter() as EventEmitter & { write: (v: string) => void; end: () => void };
      req.write = (v: string) => { body += v; };
      req.end = () => undefined;
      return req;
    });
    const config = { get: (name: string) => ({ META_PIXEL_ID: '123', META_ACCESS_TOKEN: 'segredo-de-teste' } as Record<string, string>)[name] };
    new MetaCapiService(config as never).sendEvent(params);
    return { payload: JSON.parse(body) as { data: Array<Record<string, any>> }, host };
  }

  it('evento de cadastro: so identificadores/conversao — e-mail em hash, fbp/fbc, IP, navegador, id do evento', () => {
    const { payload, host } = captureSend({
      eventName: 'CompleteRegistration', eventId: 'reg_u1', eventSourceUrl: 'https://site.example',
      userData: { em: 'Aluna@Exemplo.com ', _fbp: 'fb.1.x', _fbc: 'fb.1.y', clientIpAddress: '1.2.3.4', clientUserAgent: 'UA' },
    });
    expect(host).toBe('graph.facebook.com');
    const event = payload.data[0];
    expect(Object.keys(event).sort()).toEqual(['action_source', 'event_id', 'event_name', 'event_source_url', 'event_time', 'user_data']);
    expect(event.user_data.em).toEqual([createHash('sha256').update('aluna@exemplo.com').digest('hex')]);
    expect(Object.keys(event.user_data).sort()).toEqual(['client_ip_address', 'client_user_agent', 'em', 'fbc', 'fbp']);
    expect(JSON.stringify(payload)).not.toContain('aluna@exemplo.com');
  });

  it('evento de compra: valor e moeda; sem IP nem navegador', () => {
    const { payload } = captureSend({
      eventName: 'Purchase', eventId: 'purchase_p1', eventSourceUrl: 'https://site.example',
      userData: { em: 'a@b.com', _fbp: null, _fbc: null }, customData: { value: 24.9, currency: 'BRL' },
    });
    const event = payload.data[0];
    expect(event.custom_data).toEqual({ value: 24.9, currency: 'BRL' });
    expect(Object.keys(event.user_data)).toEqual(['em']);
  });

  it('sem META_PIXEL_ID/META_ACCESS_TOKEN nada e enviado (por isso a politica diz "quando configurado")', () => {
    const request = jest.fn();
    https.request = request;
    new MetaCapiService({ get: () => undefined } as never).sendEvent({ eventName: 'CompleteRegistration', eventId: 'x', userData: { em: 'a@b.com' } });
    expect(request).not.toHaveBeenCalled();
  });

  it('o cadastro envia ao CAPI exatamente os campos descritos: nenhum dado de saude, feedback ou treino', async () => {
    const prisma = {
      user: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: { data: Record<string, any> }) => ({ id: 'u1', email: data.email, name: data.name, role: 'student' })),
        update: jest.fn(async () => ({})),
      },
    };
    const metaCapi = { sendEvent: jest.fn() };
    const service = new AuthService(prisma as never, { signAsync: jest.fn(async () => 'j') } as never, { get: jest.fn() } as never, metaCapi as never);
    await service.register(
      { email: 'a@b.com', password: 'senha-12345', name: 'A', acceptedTerms: true, acceptedExerciseResponsibility: true, attribution: { _fbp: 'p', _fbc: 'c', source: 'ig' } } as never,
      '1.2.3.4', 'UA',
    );
    const params = metaCapi.sendEvent.mock.calls[0][0] as { eventName: string; userData: Record<string, unknown>; customData?: unknown };
    expect(params.eventName).toBe('CompleteRegistration');
    expect(Object.keys(params.userData).sort()).toEqual(['_fbc', '_fbp', 'clientIpAddress', 'clientUserAgent', 'em']);
    expect(params.customData).toBeUndefined();
  });

  it('so existem DOIS pontos de envio ao CAPI no codigo (cadastro e pagamento confirmado) — a politica descreve ambos', () => {
    const files: string[] = [];
    const walk = (dir: string) => readdirSync(dir).forEach((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full); else if (full.endsWith('.ts')) files.push(full);
    });
    walk(join(__dirname, '../src'));
    const callers = files.filter((f) => !f.endsWith('meta-capi.service.ts') && /metaCapi\.sendEvent\(/.test(readFileSync(f, 'utf8')));
    expect(callers.map((f) => f.split(/[\\/]/).slice(-2).join('/')).sort()).toEqual(['auth/auth.service.ts', 'billing/billing.service.ts']);
    const billing = readFileSync(callers.find((f) => f.endsWith('billing.service.ts'))!, 'utf8');
    expect(billing).toContain("eventName: 'Purchase'");
    const policy = PRIVACY_SECTIONS.find((s) => s.id === 'terceiros')!.paragraphs.join('\n');
    expect(policy).toContain('um ao criar a conta e outro quando um pagamento é confirmado (com valor e moeda)');
    expect(policy).toContain('não são enviados à Meta dados de saúde, feedbacks, relatos nem conteúdo ou métricas de treino');
    expect(policy).not.toMatch(/não compartilhamos dados com terceiros para (fins de )?publicidade/i);
  });
});
