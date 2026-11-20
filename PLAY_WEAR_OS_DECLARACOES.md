# Wear OS na Play — respostas prontas para as declarações (20/11/2026)

Rascunhos para Elton colar no Play Console. Eu (Claude) atuo como revisor jurídico por ordem de Elton, mas isto NÃO substitui advogado. Onde houver dúvida real, está marcado com **ATENÇÃO**.
Onde ficam: Play Console > Panzeri Run > **Política e apps > Conteúdo do app**. Cada declaração vale para o app inteiro (celular + relógio), então as respostas abaixo precisam ser coerentes com as que já existem para o celular.

---

## 1. Declaração de permissões de serviço em primeiro plano
Tipos usados no relógio (serviço `WorkoutService`): **Saúde (health)** e **Localização (location)**.

**Descrição para o campo de texto:**
> O serviço só existe enquanto a pessoa está correndo. Ele começa quando ela toca em "Iniciar corrida" no relógio e termina quando ela toca em "Encerrar". Durante a corrida, lê a frequência cardíaca, a distância e a posição (GPS) pelo Health Services do Wear OS e mostra a atividade em andamento no mostrador. O app não coleta localização nem sensores fora do treino e não usa localização em segundo plano.

**Por que precisa ser em primeiro plano:**
> A corrida continua quando a tela do relógio apaga ou a pessoa usa outro app. Sem o serviço, o sistema encerraria a gravação e o treino seria perdido.

**Impacto para o usuário se o serviço for interrompido:** perda do treino gravado até o momento.

**Vídeo exigido (cerca de 1 minuto), roteiro:** (1) abrir o Panzeri Run no relógio e mostrar a lista da semana; (2) abrir o treino de corrida; (3) tocar em "Iniciar corrida"; (4) mostrar o pedido de permissão (GPS e sensores) e aceitar; (5) mostrar a corrida em andamento e a atividade no mostrador; (6) apagar a tela e voltar, mostrando que o tempo seguiu contando; (7) pausar, retomar e encerrar; (8) mostrar que, depois de encerrar, nada continua ligado. Dá para gravar no emulador (usar os dados sintéticos do README do Wear OS) ou no relógio real da Luara.

---

## 2. Declaração de permissão de localização
- **Localização em segundo plano:** NÃO usada (`ACCESS_BACKGROUND_LOCATION` não é solicitada no relógio). Marcar que o app acessa localização **somente em primeiro plano**.
- **Finalidade:** registrar o percurso, a distância e o ritmo da corrida que a pessoa inicia.
- **Quem decide:** a pessoa, tocando em "Iniciar corrida" e autorizando o percurso no Panzeri Run (grupo "Percurso GPS", opcional).

---

## 3. Segurança de dados (formulário de coleta e compartilhamento)
Se o celular já tem a declaração, **acrescentar** o que for novo e manter coerência.

| Dado | Coletado | Compartilhado | Finalidade | Opcional |
|---|---|---|---|---|
| Localização precisa (percurso GPS) | Sim | Sim: fornecedor de IA, só se a pessoa autorizar o uso pela IA | Funcionalidade do app; análise do treino | Sim |
| Frequência cardíaca | Sim | Idem | Funcionalidade do app; análise do treino | Sim |
| Informações de exercício (tempo, distância, ritmo) | Sim | Idem | Funcionalidade do app; análise do treino | Não (é o treino) |
| Identificadores (credencial do relógio) | Sim | Não | Autenticação | Não |

- Dados criptografados em trânsito: **Sim** (HTTPS).
- A pessoa pode pedir exclusão: **Sim** — retira cada autorização no Panzeri Run (os dados do grupo retirado são apagados), retira o relógio e pede a exclusão dos treinos recebidos; a exclusão da conta apaga tudo.
- **ATENÇÃO (lógica da Google):** enviar dado à IA do fornecedor pode ser tratado como "compartilhamento com terceiros". Por isso está marcado como compartilhado, por precaução. Se o celular declara de forma diferente, uniformize pelo mais restritivo.

---

## 4. Declaração de apps de saúde
O Wear OS grava dado de saúde (frequência cardíaca). Em "Apps de saúde", se o celular já marcou **Saúde e fitness / atividade física**, mantenha e acrescente o relógio.
- **Não** declare que é app médico nem que diagnostica ou trata doença: o Panzeri Run orienta treino, não faz diagnóstico.
- Se a Google perguntar de dados de saúde: "dados de frequência cardíaca e atividade, coletados com autorização, usados no treino".

---

## 5. Tipo de app, público e classificação
Sem mudança: o relógio usa o mesmo app. Se pedirem classificação de conteúdo de novo, repetir as respostas do celular.

---

## 6. Antes de ir para produção (lembrete)
- [ ] Teste real da Luara no Galaxy Watch (ver `apps/wearos/PUBLICACAO_PLAY.md`, seção 6).
- [ ] Texto de consentimento do relógio (`apps/api/src/wear/wear-consent.ts`) e política: revisão pendente (advogado; enquanto isso, minha leitura).
- [ ] Capturas do relógio em **Presença na loja > Página principal da loja > Wear OS** (arquivos em `apps/wearos/capturas/`).
- [ ] Publicar o Wear OS no mesmo dia da aprovação da 1.0.5.

---

# Suporte a páginas de 16 KB (investigação de 20/11/2026)

## O que foi verificado (fato)
Analisei os arquivos `.aab` reais (leitura dos cabeçalhos de cada biblioteca nativa):
- **Panzeri Run 1.0.4 (versionCode 20) e 1.0.5 (versionCode 21):** as bibliotecas de **64 bits** (arm64-v8a e x86_64) estão todas alinhadas a 16 KB. As de 32 bits (armeabi-v7a e x86) estão em 4 KB, mas a exigência da Google de 16 KB vale só para 64 bits.
- **App do Wear OS (0.2.1):** 1 biblioteca nativa por arquitetura, todas alinhadas a 16 KB.
- Versões: Expo 54, React Native 0.81.5 (suportam 16 KB de fábrica).

## Interpretação (inferência)
O aviso "Seu app pode falhar em dispositivos de 16 KB" no painel da Play provavelmente vem de uma versão antiga ainda ativa na produção (anterior a 11/11) ou de uma análise genérica. Os `.aab` atuais não têm o problema.

## Desconhecido
Qual item exato a Play aponta. **Ação de Elton:** clicar em "Seu app pode falhar em dispositivos de 16 KB" no painel e mandar o print do detalhe (mostra a versão e a biblioteca).

## Cuidados para o próximo build
1. Depois de aprovar a 1.0.5, conferir se o aviso some. Se continuar, abrir o detalhe e me mandar.
2. Ao atualizar Expo, React Native ou bibliotecas nativas (RevenueCat, Health Connect, SVG), rodar de novo a conferência de alinhamento no `.aab` novo antes de enviar. O script usado está registrado no PRONTUARIO.
3. Não fixar a versão do NDK nem desligar o alinhamento no build do EAS.
4. No Wear OS, se subir o plugin do Android Gradle (hoje 8.5.2; o aviso do Gradle recomenda versão mais nova para compileSdk 35), conferir de novo o alinhamento do `.aab`.
