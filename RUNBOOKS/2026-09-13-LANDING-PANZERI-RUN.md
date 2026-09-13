# Landing Panzeri Run — entrega local e validação

## Preparação sobre a versão atual do GitHub

Apenas o patch da landing foi aplicado, sem conflitos, sobre `f12e07f80a9100ba8fc03ccf3cc229e6494c3b59`, em cópia isolada. Build completo da API, typecheck e lint focal passaram após instalação local das dependências e geração do cliente Prisma. Nenhum banco, pagamento ou migração foi executado.

O comando oficial de testes falhou em 7 suítes antes de executar testes: configuração sem tipos Jest e teste antigo importando `buildWeeklyMethodologyDecision`, função ausente na própria base remota. Esses arquivos não foram alterados pela landing. A instalação também reportou 22 vulnerabilidades de dependências; não foram feitas atualizações automáticas fora do escopo. Envio/publicação ficam bloqueados conforme os gates do projeto. O código está preparado localmente, mas não foi enviado ao GitHub e não está liberado para deploy.

Data: 13/09/2026. Projeto canônico: Aplicativo Panzeri Run, em OneDrive/Documentos.
Status: implementada e validada em prévia isolada; não publicada, não enviada ao GitHub e não sincronizada com espelho. Alterações preexistentes do projeto foram preservadas.

## Atualização visual aprovada — família PANZ

Aplicada em 13/09/2026, status local/experimental até avaliação visual do usuário. Base branca e superfícies suaves; marinho `#071A3D` na leitura; azul `#1E90FF` apenas em detalhes; turquesa `#00E5BB` nos CTAs com texto marinho. Azul mais escuro `#075BA8` em pequenos textos para contraste. Hero conceitual agora claro, sem brilho e sem sombra nos CTAs. A logo v2 existente foi reutilizada sem edição, em PNG de 192 px, conferida por SHA256, no cabeçalho, rodapé e favicon. Aplicativos PANZ FIT e mobile Panzeri Run não foram modificados.

Backup imediatamente anterior a esta atualização: `tmp/landing-backup-panz-20260913`. Arquivos desta rodada: landing-page.ts, landing/styles.ts, app.controller.ts, scripts/landing-preview.cjs e novo asset panzeri-run-logo.png. Prints intactos.

Validação repetida: TypeScript focal e lint passaram; Chrome/Edge passaram nos oito tamanhos anteriores. Lighthouse desta versão: mobile desempenho 90; desktop 100; acessibilidade/boas práticas/SEO 100 nos dois. Estes resultados substituem as medições históricas dos pontos 12 e 13 abaixo; são medições locais sujeitas à variação e os relatórios correspondentes foram atualizados. API completa permanece bloqueada somente pela dependência local ausente `@nestjs/schedule`; Firefox/WebKit continuam indisponíveis. Sem publicação. Gatilho de revisão: feedback visual do usuário ou validação no ambiente real antes de release.

## Relatório solicitado — 16 pontos

1. **Arquivos modificados:** `apps/api/src/landing-page.ts` e `apps/api/src/app.controller.ts`. O controlador ganhou uma rota pública com lista fechada de imagens permitidas; autenticação, cobrança e treinamento não foram alterados por esta entrega.
2. **Arquivos novos:** `apps/api/src/landing/{data,styles,script}.ts`; `apps/api/public/landing/results/result-01.jpeg` até `result-21.jpeg` e `elton.jpeg`; ferramentas locais `scripts/{landing-preview,test-landing,audit-landing}.cjs`; este relatório. Relatórios e capturas de QA estão em `tmp/landing-preview`.
3. **Componentes/seções:** cabeçalho, hero, confiança, problema da planilha genérica, mudança de paradigma, funcionamento, experiência no app, adaptação à vida real, público, resultados, autoridade, inclusões, preço, FAQ, CTA final e rodapé. Galeria expansível, diálogo acessível e CTA fixo mobile. A representação do planejamento é conceitual e está identificada como tal, não como captura real do aplicativo.
4. **Remoções da página:** vídeos e referências a vídeos, arranjo antigo e CTAs divergentes. Arquivos de vídeo e rota antiga foram mantidos para compatibilidade e recuperação; não houve exclusão desses arquivos.
5. **Quantidade de resultados:** 21 prints reais; 6 inicialmente visíveis; expansão mostra os 21; recolhimento retorna aos 6.
6. **Seis destaques:** originais 21 (primeiros 5 km), 4 (primeiros 5 km), 11 (primeiros 10 km após 8 anos), 9 (10 km), 1 (percepção de evolução), 8 (recorde pessoal). Depoimentos são apresentados como resultados do método anterior ao aplicativo, sem atribuir esses resultados ao app novo.
7. **Privacidade:** por instrução posterior expressa do usuário, os 21 prints foram mantidos exatamente como recebidos, sem anonimização, remoção de nomes, perfis, telefones ou outros detalhes. As cópias foram conferidas por SHA256 e são idênticas aos originais. Esta decisão substitui a anonimização solicitada no texto inicial. Antes de publicação pública, revisar autorização dos titulares e exposição de dados pessoais.
8. **Destino do CTA:** configuração única `CHECKOUT_URL` em `data.ts`, atualmente `https://panzerirun.eltonpanzeripersonal.com.br`. É a entrada do app do aluno: a cobrança existente gera checkout individual por conta. Não foi inventada uma URL pública de fatura nem reutilizada cobrança de outra pessoa. UTMs, gclid e fbclid são preservados na sessão e propagados ao destino.
9. **Preço:** R$ 19,90/mês, conforme preço web existente no serviço de cobrança. Não houve alteração de preço no backend ou nas lojas; o valor das lojas pode diferir. As condições devem ser conferidas no fluxo real de contratação antes de publicar.
10. **Eventos:** `landing_view`, cliques de CTA por posição, `checkout_start`, navegação, abertura de FAQ, expansão de resultados, abertura de depoimento e visualizações de seções via observação de entrada na tela. Eventos vão para `dataLayer`; `InitiateCheckout` somente se `fbq` já estiver configurado. Nenhum evento `Purchase` é disparado por clique.
11. **Integrações preservadas:** arquitetura NestJS e página servida pela API, entrada existente do app e rotas legais. Não foram encontrados identificadores de GA/GTM/Meta no HTML anterior; nenhum identificador foi inventado e nenhum envio externo foi configurado. Recepção real dos eventos depende da configuração desses serviços.
12. **Lighthouse mobile:** desempenho 100, acessibilidade 100, boas práticas 100 e SEO 100. Relatório `tmp/landing-preview/lighthouse-mobile.html` e JSON correspondente.
13. **Lighthouse desktop:** desempenho 99, acessibilidade 100, boas práticas 100 e SEO 100. Relatório `tmp/landing-preview/lighthouse-desktop.html` e JSON correspondente. Ambos são testes de laboratório em localhost com Chrome headless, não métricas de produção nem garantia de resultados em todos os aparelhos.
14. **Problemas encontrados:** hierarquia de títulos na representação conceitual, diferença entre texto visível e nome acessível dos botões dos prints, ausência de favicon, captura de tela durante rolagem suave e carregamento tardio de imagens na captura de página inteira. A API completa também encontrou ausência local de `@nestjs/schedule`; Firefox e WebKit não estão instalados.
15. **Correções e testes:** corrigidos títulos, nomes acessíveis e favicon; ferramenta de capturas aguarda carregamento e usa rolagem imediata. Compilação TypeScript estrita dos arquivos da landing e lint dos arquivos alterados passaram. Chrome e Edge passaram em 360, 390, 430, 768, 1024, 1280, 1440 e 1920 px, sem transbordamento horizontal, erros JavaScript ou imagens faltantes. Menu, FAQ, expansão/recolhimento, setas, Escape, retorno de foco, 21 imagens e atribuição por UTM passaram. Ver `tmp/landing-preview/qa-report.json`. A prévia não inicia banco, agentes de treinamento, cobranças ou notificações.
16. **Pendências e limites:** restaurar a dependência local `@nestjs/schedule` e repetir build/typecheck completo da API; conferir a rota das imagens na execução real da API e no ambiente de hospedagem; testar Firefox/Safari e aparelhos reais; conferir checkout/cobrança de ponta a ponta com conta apropriada, configurações de analytics e autorização para prints. Publicação, commit/push e sincronização não foram executados. Arquivos JPEG originais foram preservados, sem conversão para WebP por respeito à instrução de manter os prints intactos.

## Backup e recuperação

Atualização editorial posterior (13/09/2026): FAQ de dor detalha diferentes questionários e revisão profissional, sem prometer diagnóstico ou atendimento de urgência; FAQ de mentoria diferencia a assinatura do acompanhamento individual de Elton; FAQ de IA assume seu uso e autoria dos critérios, sem superioridade não comprovada ou garantia de prescrição. Nova seção `#na-pratica` usa Marina, personagem expressamente fictícia, para explicar avaliação, execução e ajuste semanal com base no realizado. A chuva é um exemplo de contexto, não promessa de remanejamento instantâneo. Prints, preços, cobrança e lógica do aplicativo não foram alterados.

Os dois arquivos anteriores estão em `tmp/landing-backup-20260913/landing-page.ts` e `tmp/landing-backup-20260913/app.controller.ts`. Para voltar à versão anterior, restaurar apenas esses arquivos nos destinos correspondentes e repetir a compilação. Não reverter o repositório inteiro: há alterações do usuário em outras áreas.

## Avaliação visual

A prévia local usa `http://127.0.0.1:4173/`. Capturas mobile/desktop e resultados de testes estão em `tmp/landing-preview`. O servidor é exclusivamente local e deve ser reiniciado quando necessário; não substitui a API de produção.
