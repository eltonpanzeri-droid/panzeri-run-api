# Relógio (Wear OS) — o que falta para publicar na Play (22/11/2026)

Estado: pacote 0.2.1 (versionCode 100003) em TESTE INTERNO. Textos prontos em `PLAY_WEAR_OS_DECLARACOES.md`; checklist técnico em `apps/wearos/PUBLICACAO_PLAY.md`. Leitura jurídica minha (revisor por ordem de Elton) NÃO substitui advogado.

## A. Só o Elton consegue (Play Console)
1. **Teste real da Luara** no Galaxy Watch: instalar pelo teste interno, parear, ver a semana, gravar uma corrida ao ar livre e ver no painel. Sem isso não subir para produção.
2. **Serviço em primeiro plano**: Política e apps > Conteúdo do app > Permissões de serviço em primeiro plano. Tipos: Saúde e Localização. Colar o texto da seção 1 de `PLAY_WEAR_OS_DECLARACOES.md` e anexar o **vídeo de ~1 minuto** (roteiro na mesma seção; pode ser gravado no relógio da Luara).
3. **Localização**: marcar só primeiro plano (o relógio não pede localização em segundo plano).
4. **Segurança de dados**: acrescentar ao que o celular já declara a tabela da seção 3 (localização precisa, frequência cardíaca, exercício, identificadores). Conferir que as respostas do celular também incluem agora a **gravação do Panzeri Run (GPS)** da 1.0.6.
5. **Apps de saúde**: manter "Saúde e fitness"; NÃO declarar app médico.
6. **Ficha da loja > Wear OS**: subir as capturas redondas 384x384 de `apps/wearos/capturas/` (`1-seus-treinos.png`, `2-treino.png`, `3-corrida-em-andamento.png`).
7. **Produção**: Testes > Produção > nova versão com o pacote 100003 e **faixa/formato Wear OS**. Com "Publicação gerenciada" ligada, ela só sai quando você clicar em "Publicar".

## B. Pendências de conteúdo e processo
- Texto de consentimento do relógio e política: advogado pendente.
- Se a Play pedir classificação de conteúdo de novo, repetir as respostas do celular.
- Aviso "página de 16 KB": conferido (64 bits alinhados); mandar print do detalhe se continuar aparecendo.

## C. Ordem sugerida
1. Luara testa (A1). 2. Elton grava o vídeo e preenche A2–A5. 3. Capturas (A6). 4. Nova versão em produção (A7), junto com a 1.0.5/1.0.6 do celular se quiser lançar tudo no mesmo clique.
