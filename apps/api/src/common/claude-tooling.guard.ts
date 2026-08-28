import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

// 28/08: acesso permanente e' so' de LEITURA pra investigacao/diagnostico real (consultas diretas
// na producao, sem depender de token de sessao do navegador do treinador, que expira rapido e ja
// se mostrou pouco confiavel — ver bug real "sempre desloga ao recarregar a pagina"). So' nas
// rotas em coach-tools.controller.ts, escolhidas a dedo pra nunca gastar IA nem gravar dado real
// como efeito colateral de uma simples consulta (ver comentario la sobre por que GET
// /students/:id foi deixada de fora). A chave fica so' na variavel de ambiente
// CLAUDE_TOOLING_API_KEY, nunca no codigo nem no git — e' um segredo real (le CPF, endereco,
// historico de saude de todo mundo), guarda com o mesmo cuidado dado a qualquer outra chave de
// API do projeto.
@Injectable()
export class ClaudeToolingGuard implements CanActivate {
  private readonly logger = new Logger(ClaudeToolingGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expectedKey = this.config.get<string>('CLAUDE_TOOLING_API_KEY');
    if (!expectedKey) throw new UnauthorizedException('Acesso de ferramenta nao configurado.');

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; method: string; url: string }>();
    const providedKey = request.headers['x-tooling-key'];

    // Comparacao resistente a timing attack — mesmo padrao ja usado pro segredo do webhook da
    // Resend (messaging.controller.ts). Precisa dos dois buffers do mesmo tamanho antes de
    // comparar, senao timingSafeEqual lanca excecao em vez de so' retornar false.
    const expectedBuffer = Buffer.from(expectedKey);
    const providedBuffer = Buffer.from(providedKey ?? '');
    const isValid = providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
    if (!isValid) {
      // Nota honesta: isso so' ajuda a perceber tentativa de adivinhar a chave errada. Se a chave
      // certa algum dia vazar de verdade, o uso dela fica indistinguivel do uso legitimo — nao
      // existe rotacao nem escopo por chamada hoje pra alem disso.
      this.logger.warn(`Tentativa invalida de acesso via ferramenta: ${request.method} ${request.url}`);
      throw new UnauthorizedException('Chave de ferramenta invalida.');
    }

    this.logger.log(`Acesso via ferramenta: ${request.method} ${request.url}`);
    return true;
  }
}
