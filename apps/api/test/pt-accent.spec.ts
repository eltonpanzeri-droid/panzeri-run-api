import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { accentPt, localizeQuestion } from '../../mobile/src/ptAccent';

// Acentuação na EXIBIÇÃO (30/10/2026). Regressão do defeito em que as marcas de palavra (\b) viraram caracteres invisíveis e a correção nunca encontrava nenhuma palavra: o texto saía igual.

describe('acentuação na exibição', () => {
  it('corrige palavras sem acento que apareceram nas telas', () => {
    expect(accentPt('Recolher prescricao')).toBe('Recolher prescrição');
    expect(accentPt('O treino extra e o treino prescrito ja tem feedback: apague um dos dois antes de vincular.')).toBe('O treino extra e o treino prescrito já tem feedback: apague um dos dois antes de vincular.');
    expect(accentPt('Pace medio (calculado automaticamente ou edite)')).toBe('Pace médio (calculado automaticamente ou edite)');
    expect(accentPt('Em media, quantas horas voce dorme por mes?')).toBe('Em média, quantas horas você dorme por mês?');
    expect(accentPt('Nao consegui conectar. Experiencia com corrida')).toBe('Não consegui conectar. Experiência com corrida');
  });

  it('preserva maiúsculas, o "e" conjunção e o que não é palavra do dicionário', () => {
    expect(accentPt('Nao')).toBe('Não');
    expect(accentPt('NAO FAZER')).toBe('NÃO FAZER');
    expect(accentPt('Ritmo e distancia')).toBe('Ritmo e distância');
    expect(accentPt('Isso e importante')).toBe('Isso é importante');
    expect(accentPt('Apple_health')).toBe('Apple_health');
    expect(accentPt('Panzeri Run')).toBe('Panzeri Run');
    expect(accentPt('Já está acentuado: não muda.')).toBe('Já está acentuado: não muda.');
    expect(accentPt('')).toBe('');
  });

  it('é idempotente (aplicar duas vezes dá o mesmo resultado)', () => {
    const once = accentPt('Voce ja fez a avaliacao? Nao ha informacao.');
    expect(accentPt(once)).toBe(once);
    expect(once).toBe('Você já fez a avaliação? Não há informação.');
  });

  it('pergunta da entrevista: só o que é lido é acentuado; chave e VALOR da opção continuam os originais', () => {
    const question = localizeQuestion({ key: 'objective', module: 'Experiencia com corrida', prompt: 'Qual e seu objetivo?', options: ['Comecar a correr', { label: 'Nao sei', value: 'unknown' }] as unknown[] });
    expect(question.key).toBe('objective');
    expect(question.module).toBe('Experiencia com corrida'); // o módulo é usado em comparações: não muda
    expect(question.prompt).toBe('Qual é seu objetivo?');
    expect(question.options).toEqual([{ label: 'Começar a correr', value: 'Comecar a correr' }, { label: 'Não sei', value: 'unknown' }]);
  });
});

describe('arquivos de texto do aplicativo e da API', () => {
  // O defeito original: caractere de controle (backspace, 0x08) no lugar de \b dentro de uma expressão regular gerada por script.
  const roots = [join(__dirname, '..', '..', 'mobile', 'src'), join(__dirname, '..', '..', 'mobile', 'home'), join(__dirname, '..', 'src')];
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  };
  it('nenhum arquivo-fonte contém caracteres de controle invisíveis', () => {
    const offenders: string[] = [];
    for (const root of roots) for (const file of walk(root)) {
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(readFileSync(file, 'utf8'))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
