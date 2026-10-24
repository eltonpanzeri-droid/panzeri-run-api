import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

// 24/10/2026 — atualizacao automatica do PWA: a logica pura (nome do bundle e decisao) e' carregada do proprio arquivo do app; o hook e' validado estruturalmente.
const root = join(__dirname, '..', '..', 'mobile');
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

type Lib = {
  extractBundleName: (html: string) => string | null;
  bundleNameFromSrc: (src: string | null | undefined) => string | null;
  decideUpdateAction: (input: { running: string | null; published: string | null; isTyping: boolean; reloadedFor: string | null }) => 'none' | 'reload' | 'banner';
};
function loadLib(): Lib {
  const js = ts.transpileModule(read('src', 'appUpdate', 'bundleName.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  new Function('module', 'exports', js)(module, module.exports);
  return module.exports as unknown as Lib;
}
const lib = loadLib();

const html = (scripts: string) => `<!DOCTYPE html><html><head><title>x</title></head><body><div id="root"></div>${scripts}</body></html>`;
const BUNDLE = '<script src="/_expo/static/js/web/index-0535406a2c8ed5221901220f6b3be10f.js" defer></script>';

describe('nome do bundle publicado', () => {
  it('acha o hash do bundle principal no HTML', () => {
    expect(lib.extractBundleName(html(BUNDLE))).toBe('index-0535406a2c8ed5221901220f6b3be10f.js');
  });
  it('devolve null quando nao ha bundle (sem script, HTML vazio ou lixo)', () => {
    expect(lib.extractBundleName(html(''))).toBeNull();
    expect(lib.extractBundleName('')).toBeNull();
    expect(lib.extractBundleName('<html>pagina de erro 502</html>')).toBeNull();
  });
  it('ignora outros scripts e acha o bundle mesmo depois deles (aspas simples, query string)', () => {
    const other = '<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script><script src="/sw-register.js"></script><script>window.a=1</script>';
    expect(lib.extractBundleName(html(other))).toBeNull();
    expect(lib.extractBundleName(html(other + "<script src='/_expo/static/js/web/index-abc123.js?v=2' defer></script>"))).toBe('index-abc123.js');
  });
  it('nao confunde outros arquivos da mesma pasta (chunks) com o bundle principal', () => {
    expect(lib.extractBundleName(html('<script src="/_expo/static/js/web/chunk-aaa.js"></script>'))).toBeNull();
    expect(lib.bundleNameFromSrc('http://localhost:8081/apps/mobile/index.bundle?platform=web')).toBeNull(); // dev: sem hash, nao age
    expect(lib.bundleNameFromSrc('https://app.exemplo.com/_expo/static/js/web/index-ff00.js')).toBe('index-ff00.js'); // src absoluto do documento
    expect(lib.bundleNameFromSrc(null)).toBeNull();
  });
});

describe('decisao de atualizar', () => {
  const base = { running: 'index-a.js', published: 'index-b.js', isTyping: false, reloadedFor: null as string | null };
  it('versao diferente e aluna parada: recarrega', () => {
    expect(lib.decideUpdateAction(base)).toBe('reload');
  });
  it('aluna digitando: so avisa, nao recarrega', () => {
    expect(lib.decideUpdateAction({ ...base, isTyping: true })).toBe('banner');
  });
  it('nunca recarrega duas vezes para a mesma versao: se ja recarregou e ainda difere, so avisa', () => {
    expect(lib.decideUpdateAction({ ...base, reloadedFor: 'index-b.js' })).toBe('banner');
    // uma versao MAIS nova que a ja recarregada volta a poder recarregar uma vez
    expect(lib.decideUpdateAction({ ...base, published: 'index-c.js', reloadedFor: 'index-b.js' })).toBe('reload');
  });
  it('sem certeza (nome ausente) ou versoes iguais: nada', () => {
    expect(lib.decideUpdateAction({ ...base, published: 'index-a.js' })).toBe('none');
    expect(lib.decideUpdateAction({ ...base, published: null })).toBe('none');
    expect(lib.decideUpdateAction({ ...base, running: null })).toBe('none');
  });
});

describe('hook e ligacao no app', () => {
  const hook = read('src', 'appUpdate', 'useAppUpdate.ts');
  it('so age na web e nunca lanca por falha de rede', () => {
    expect(hook).toMatch(/Platform\.OS !== 'web'/);
    expect(hook).toMatch(/fetch\('\/', \{ cache: 'no-store' \}\)/);
    expect(hook).toMatch(/catch \{[^}]*\}/);
  });
  it('confere ao abrir, ao voltar do segundo plano (>= 30 s) e a cada 15 min; limpa os ouvintes', () => {
    expect(hook).toMatch(/MIN_BACKGROUND_MS = 30_000/);
    expect(hook).toMatch(/POLL_MS = 15 \* 60_000/);
    expect(hook).toMatch(/visibilitychange/);
    expect(hook).toMatch(/pageshow/);
    expect(hook).toMatch(/clearInterval/);
    expect(hook).toMatch(/removeEventListener\('visibilitychange'/);
  });
  it('grava a versao em sessionStorage antes de recarregar e decide pela funcao pura (sem laco)', () => {
    expect(hook).toMatch(/sessionStorage\.setItem\(RELOADED_KEY/);
    expect(hook).toMatch(/decideUpdateAction\(\{ running: runningBundleName\(\), published: name, isTyping: isTypingNow\(\), reloadedFor: readReloadedFor\(\) \}\)/);
  });
  it('a faixa so aparece na web com versao disponivel, com o texto em pt-BR, e esta ligada uma unica vez no App', () => {
    const banner = read('src', 'appUpdate', 'AppUpdateBanner.tsx');
    expect(banner).toMatch(/Platform\.OS !== 'web' \|\| !updateAvailable/);
    expect(banner).toMatch(/Nova versão disponível — Atualizar/);
    const app = read('App.tsx');
    expect(app.match(/<AppUpdateBanner \/>/g)).toHaveLength(1);
    expect(app).toMatch(/import \{ AppUpdateBanner \} from '\.\/src\/appUpdate\/AppUpdateBanner'/);
  });
});
