# Publicar o app do relógio (Wear OS) na Google Play — checklist e rascunhos

Preparado em 17/11/2026 pelo Claude. **Nada disso foi enviado à Google.** Os textos são rascunhos para Elton e o advogado revisarem; quem faz o envio é o Elton no Play Console.

## 1. O que já está pronto no projeto
- `./gradlew bundleRelease` gera `app/build/outputs/bundle/release/app-release.aab` (cerca de 3 MB; o APK de release tem 2,4 MB, reduzido pelo R8). A variante release fala só HTTPS com o servidor de produção (a debug aceita HTTP só para o servidor de teste local).
- `applicationId = com.panzerirun.app` (mesmo do app do celular) e `uses-feature android.hardware.type.watch`: o app entra na **mesma ficha** do Panzeri Run, numa faixa própria de **Wear OS**.
- `minSdk 30` (Wear OS 3, Galaxy Watch 4 em diante), `targetSdk 34`.
- O release foi instalado num emulador de Wear OS 5 (assinado só para o teste) e abriu sem erro, mostrando o código de pareamento.

## 2. O que só o Elton pode fazer
1. **Chave de assinatura.** Usar o Play App Signing e uma chave de envio. O Claude não cria nem guarda chave. A chave de envio assina o `.aab` (`bundleRelease` + assinatura no Android Studio ou `apksigner`/`jarsigner`).
2. **Número de versão.** O `versionCode` do relógio começa em 100002 (faixa separada do app do celular, para nunca colidir). Aumentar a cada envio.
3. **Faixa de relógio.** Play Console → Panzeri Run → Versão → Configurações avançadas → Fatores de forma → adicionar **Wear OS** → criar o lançamento nessa faixa. Começar por **teste interno** com a Luara (adicionar o e-mail Google dela como testadora; ela instala pela Play no celular, e o app aparece no relógio).
4. **Declarações do app** (Conteúdo do app): segurança de dados, declaração de serviço em primeiro plano, declaração de apps de saúde. Rascunhos nas seções 3 a 5.
5. **Imagens da ficha do relógio:** ícone 512×512 (o atual é provisório), capturas de tela redondas 384×384 (podem ser feitas no emulador), descrição curta e completa.

## 3. Declaração de serviço em primeiro plano (rascunho)
Tipos usados: **saúde (`health`)** e **localização (`location`)**, no serviço `WorkoutService`.

> **Descrição:** o serviço só existe enquanto o usuário está correndo. Ele começa quando o usuário toca em “Iniciar corrida” no relógio e termina quando o usuário toca em “Encerrar”. Durante a corrida ele lê a frequência cardíaca, a distância e a posição (GPS) pelo Health Services do Wear OS e mostra uma notificação de atividade em andamento. O app não coleta localização nem sensores fora do treino e não usa localização em segundo plano (`ACCESS_BACKGROUND_LOCATION` não é solicitada).
>
> **Por que precisa ser em primeiro plano:** a corrida continua quando a tela do relógio apaga ou o usuário usa outro app; sem o serviço, o sistema encerraria a gravação e o treino seria perdido.

**Roteiro do vídeo exigido pela Google (cerca de 1 minuto):** (1) abrir o app no relógio e mostrar a lista da semana; (2) abrir um treino de corrida e tocar em “Iniciar corrida”; (3) mostrar o pedido de permissão (GPS e sensores) e aceitar; (4) mostrar a corrida em andamento e a notificação/atividade em andamento no mostrador; (5) baixar o braço/apagar a tela e voltar mostrando que o tempo seguiu contando; (6) pausar, retomar e encerrar; (7) mostrar o resumo e que nada continua ligado depois de encerrar.

## 4. Segurança de dados (rascunho para o advogado revisar)
| Dado | Coletado | Compartilhado | Finalidade | Opcional |
|---|---|---|---|---|
| Localização precisa (percurso) | Sim | Sim, com o fornecedor de IA (Anthropic), só se a aluna autorizar o uso pela IA | Funcionalidade do app e análise do treino | Sim (grupo “Percurso GPS”) |
| Frequência cardíaca | Sim | Idem | Funcionalidade do app e análise do treino | Sim (grupo de frequência) |
| Informações de exercício (tempo, distância, ritmo) | Sim | Idem | Funcionalidade do app e análise do treino | Não (é o treino) |
| Identificadores (credencial do relógio) | Sim | Não | Autenticação | Não |

- **Criptografia em trânsito:** sim (HTTPS). **Exclusão:** a aluna retira cada autorização no Panzeri Run (apaga os dados do grupo retirado), retira o relógio e pede a exclusão dos treinos recebidos; a exclusão da conta apaga tudo.
- **Atenção:** se a Google considerar o envio ao fornecedor de IA como “compartilhamento”, marcar assim (já está marcado como compartilhado acima, por precaução).

## 5. Política de privacidade — trecho novo para o relógio (rascunho, NÃO publicado)
> **Aplicativo do relógio (Wear OS).** Se você instalar o Panzeri Run no seu relógio Wear OS e autorizar no celular, o relógio grava a sua corrida **somente enquanto você a mantém em andamento**: duração, distância, ritmo, frequência cardíaca e, se você autorizar, o percurso por GPS com altitude. Não coletamos localização fora do treino nem em segundo plano. Os dados são enviados ao Panzeri Run, vistos pelo seu treinador e, se você mantiver autorizado, usados em análises com inteligência artificial feitas com o fornecedor Anthropic, o que pode envolver transferência internacional de dados. Você pode desligar o uso pela inteligência artificial, retirar o grupo de percurso ou de frequência cardíaca (os dados do grupo retirado são apagados), retirar o relógio e pedir a exclusão dos treinos recebidos a qualquer momento no Panzeri Run. Não enviamos os seus dados a serviços de meteorologia nem a outros terceiros além do fornecedor de inteligência artificial e dos prestadores que mantêm o serviço no ar.

O texto de consentimento mostrado à aluna está em `apps/api/src/wear/wear-consent.ts` (versão 1.0, rascunho). Qualquer mudança nele muda a versão e exige que quem já autorizou confirme de novo.

## 6. Antes de dar “publicar”
- [ ] Texto de consentimento e trecho da política revisados pelo advogado e aprovados pelo Elton.
- [ ] API em produção com as rotas `/wear` e a tabela `WearDevice` (Deploy feito) e variável `WEAR_OS_EXTERNAL_AI_ENABLED=true`.
- [ ] Teste real com a Luara (Galaxy Watch): parear, ver a semana, gravar uma corrida ao ar livre, ver o treino no painel.
- [ ] Ícone oficial e capturas de tela.
