# Testes físicos, Lote 1: modelos científicos propostos

Data: 30/10/2026. Status: `proposed` (aguarda aprovação de Elton). Nada foi implementado.
Escopo: PWA e backend. Sem builds nativos.

## 0. Resumo para decisão

| Item | Proposta | Confiança |
|---|---|---|
| VO₂máx a partir dos 3 km | Equações de Daniels e Gilbert (1979): custo de oxigênio da velocidade + fração sustentável pelo tempo da prova | Moderada. É um índice de desempenho (VDOT), não VO₂ de laboratório |
| vVO₂máx a partir dos 3 km | Velocidade cujo custo de oxigênio iguala o VDOT (inversão da mesma equação) | Moderada |
| Teste incremental: vVO₂máx | Velocidade de pico, com a fração do último estágio (Kuipers et al., 2003) | Boa para a velocidade de pico |
| Teste incremental: VO₂máx | Custo de oxigênio de Daniels na velocidade de pico. **Não** usar a equação do ACSM | Moderada a baixa |
| FCmáx | FC observada no teste, quando informada como máxima. Sem ela: Tanaka (2001) para homens e Gulati (2010) para mulheres | Baixa a moderada (desvio individual de cerca de 10 bpm) |
| L1 e L2 (velocidade e FC) | Percentuais **medidos em laboratório** em 1.411 corredores (Esteve-Lanao et al., 2026), por sexo, aplicados à vVO₂máx e à FCmáx | Moderada para L2, baixa a moderada para L1 |
| Zonas | Derivadas de L1 e L2 (três zonas, modelo polarizado) e do ritmo de Daniels como conferência cruzada | Depende dos itens acima |

Há duas decisões suas na seção 7 (duração dos estágios e uma correção na estimativa que existe hoje no app).

## 1. Estado atual do código (achado importante)

`performance-calculations.ts` estima VO₂máx do teste de 3 km por `483 / tempo(min) + 3,5`.
Pesquisei a origem. Essa equação aparece como a do teste de 1,5 milha (ACSM), sem estudo de validação específico para 3 km. Há inclusive um artigo de 2023 dizendo que não há estudo demonstrando a acurácia dela. Ou seja, o que está em produção hoje é uma extrapolação. Para o mesmo tempo de 12:00, ela dá 43,8 e o modelo de Daniels dá 47,9.

Proposta: o novo motor de estimativas passa a usar Daniels e Gilbert. Os registros antigos em `FitnessTest` **não são alterados**. O valor antigo continua guardado como foi calculado, e o novo cálculo é gravado à parte, com a versão do modelo.

## 2. Teste de 3 km

### 2.1 Equações (Daniels e Gilbert, 1979, "Oxygen Power: Performance Tables for Distance Runners")

Com `v` em metros por minuto e `t` em minutos:

- Custo de oxigênio: `VO₂(v) = -4,60 + 0,182258·v + 0,000104·v²`
- Fração do VO₂máx sustentável em `t` minutos: `F(t) = 0,8 + 0,1894393·e^(-0,012778·t) + 0,2989558·e^(-0,1932605·t)`
- Índice: `VDOT = VO₂(v) / F(t)`, com `v = 3000 / t`
- Velocidade no VO₂máx: resolve-se `VO₂(v) = VDOT` para `v` (equação do segundo grau).

Observação de verificação: os coeficientes aparecem de forma consistente em várias fontes secundárias, mas não consegui abrir o livro original. Antes de implementar, vou conferi-los contra uma fonte primária ou contra tabelas publicadas, e o teste automatizado vai fixar valores de referência.

### 2.2 Exemplos calculados (conferidos por script)

| Tempo 3 km | Pace médio | VDOT | vVO₂máx | Estimativa atual no app (483/t+3,5) |
|---|---|---|---|---|
| 10:30 | 3:30/km | 55,7 | 17,07 km/h (3:31/km) | 49,5 |
| 12:00 | 4:00/km | 47,9 | 15,10 km/h (3:58/km) | 43,8 |
| 15:00 | 5:00/km | 37,0 | 12,27 km/h (4:53/km) | 35,7 |
| 18:00 | 6:00/km | 29,9 | 10,33 km/h (5:48/km) | 30,3 |

Um ponto de conferência: o tempo de 12:00 para 3 km dá VDOT 47,9 nas tabelas de Daniels, o que bate com o que comentários técnicos citam.

### 2.3 Condições de aplicação e limitações

- O VDOT mistura capacidade aeróbia **e** economia de corrida. Dois corredores com o mesmo VO₂máx de laboratório podem ter VDOT diferente. Deve ser rotulado como "estimativa pelo desempenho", nunca como VO₂ medido.
- Calor, vento, subidas, percurso mal aferido e ritmo mal distribuído distorcem o tempo. A tela precisa avisar isso.
- Foi construído com corredores. Menos adequado a quem nunca correu 3 km contínuos ou caminhou parte do percurso (nesse caso, o teste não deve gerar zonas, só ser guardado).
- A FC informada **não entra** no cálculo do VO₂ (ver seção 5). Ela só entra como FC registrada, com o tipo de medida.
- Alternativa que descartei: o modelo de 3 km de atletas de esportes aquáticos (2021, J Sports Med Phys Fitness) usa FC pós-esforço, massa corporal e sexo. É específico daquela população e a FC pós-esforço é o tipo de dado que não queremos exigir. Descartado como principal.

## 3. Teste incremental na esteira

### 3.1 Por que 1% de inclinação

Jones e Doust (1996, J Sports Sci 14:321-327): 1% de inclinação reproduz o custo energético de correr ao ar livre entre 2,92 e 5,0 m/s (10,5 a 18 km/h), compensando a ausência de resistência do ar. Uso: inclinação fixa de 1%.

### 3.2 Estágios: duas decisões que dependem de você

A literatura mostra que a duração do estágio muda a velocidade final. Kuipers et al. (2003, Int J Sports Med 24:486-491) encontraram velocidade máxima de 18,3 km/h com estágios de 1 min, 17,1 com 3 min e 15,1 com 6 min. Para determinar a velocidade de pico em corredores recreativos, um estudo de 2015 recomenda incrementos de 1 km/h com estágios de 3 min como padrão, e um trabalho de 2021 (Frontiers in Physiology) reporta boa confiabilidade desse formato (1 km/h a cada 3 min) em qualquer nível.

Seu pedido é de estágios de 2 minutos. É um meio-termo defensável, mas **não é o formato com maior respaldo**. Duas opções:

- A) 2 minutos, como você pediu. Menos tempo total, menos desgaste. A velocidade de pico fica um pouco superior à de um protocolo de 3 min, e o resultado **não é comparável** com estudos de 3 min. Registro o formato junto do resultado.
- B) 3 minutos, 1 km/h por estágio (mais respaldo).

Recomendação: **B**, se a prioridade for defensabilidade científica. **A**, se a prioridade for praticidade. Qualquer que seja, o protocolo gravado com o resultado (duração, incremento, inclinação) permite tratar cada um corretamente.

### 3.3 Velocidade inicial e incremento

Não achei na literatura uma regra única para escolher a velocidade inicial. A prática é individualizar para que o teste dure de 10 a 15 minutos (o estudo de referência de 2026 faz isso). Proposta de desenho, que é decisão de protocolo e não equação fisiológica:

- Incremento fixo de 1 km/h por estágio.
- Velocidade inicial escolhida em três faixas pela capacidade que o aluno declara (por exemplo, pelo tempo de 5 km recente ou, na falta dele, uma faixa de nível). Eu preencho os valores exatos depois, com a faixa de 10 a 15 minutos de duração como critério. Se preferir, o Lote 2 já traz o catálogo de protocolos para você revisar antes de ir ao ar.

### 3.4 Cálculo do resultado

- Velocidade de pico (Kuipers et al., 2003): `Vpico = Vúltimo estágio completo + incremento × (t / T)`, em que `t` é o tempo sustentado no estágio incompleto e `T` a duração do estágio.
- Interpretação: `Vpico` é a **velocidade máxima atingida no teste**. Ela é a variável mais bem sustentada pela literatura (Noakes, Myburgh e Schall, 1990: a velocidade de pico na esteira é um dos melhores preditores de desempenho em corridas de fundo). Uso como vVO₂máx estimada, com o rótulo "velocidade máxima no teste incremental".
- VO₂máx estimado: custo de oxigênio de Daniels em `Vpico`. Motivo: a equação do ACSM (`0,2·v + 0,9·v·inclinação + 3,5`) foi desenhada para estado estável e **superestima** o VO₂máx de atletas em cerca de 14,6% (Hippokratia; estudo com protocolo de Bruce). Comparação com a nossa faixa de velocidades:

| Vpico | Daniels | ACSM com 1% |
|---|---|---|
| 12 km/h | 36,0 | 45,3 |
| 15 km/h | 47,5 | 55,8 |
| 18 km/h | 59,4 | 66,2 |

- Limitação: com estágios curtos, o VO₂ não chega ao estado estável a cada degrau, e a velocidade de pico tende a ser maior que a vVO₂máx de laboratório. Por isso o VO₂ aqui sai com confiança **moderada a baixa**, e a velocidade de pico é o resultado principal.
- Orientação do protocolo: não exigir que o aluno continue após perder o controle da passada ou da velocidade. O critério de encerramento é "não consegue sustentar a velocidade do estágio".

## 4. Frequência cardíaca máxima

Ordem de prioridade, sempre com a origem registrada:

1. FC máxima **medida** (informada pelo aluno como máxima observada no teste ou fornecida por avaliação externa). Origem: `informada`.
2. Sem ela, estimativa por idade:
   - Homens: Tanaka et al. (2001, J Am Coll Cardiol): `208 − 0,7 × idade`. Em 180 maratonistas recreativos (Frontiers in Physiology, 2018), foi recomendada para homens. Em mulheres, a FC medida ficou cerca de 4,8 bpm abaixo da prevista.
   - Mulheres: Gulati et al. (2010, Circulation): `206 − 0,88 × idade`, derivada de mulheres. Pendente de conferência da fonte original antes de implementar.
3. FC média ou FC ao final do teste **não** são tratadas como FCmáx. Entram como FC registrada, com o tipo, e não alteram a FCmáx estimada.

Limitação: o desvio individual das equações por idade é grande (da ordem de 10 bpm). Zonas de FC baseadas em FCmáx por idade ficam marcadas com confiança baixa. É exatamente a situação que você quis evitar com "a ausência de FC não impede as zonas", e por isso o rótulo de confiança acompanha cada zona.

## 5. Limiares L1 e L2

Não existe equação validada que converta um tempo de prova isolado em limiar de lactato. A busca confirmou isso: o melhor respaldo é o uso de **percentuais medidos em corredores**, aplicados à vVO₂máx e à FCmáx.

### Fonte principal

Esteve-Lanao J, Sellés-Pérez S, Arévalo-Chico H, Cejuela R. Sports (Basel) 2026;14(1):29. doi:10.3390/sports14010029.
Amostra: 1.411 corredores treinados (819 homens, 592 mulheres), idade média de 37 anos, esteira com 1% de inclinação, gases expirados, limiares pelos critérios de Davis, três avaliadores independentes.

| Referência (média ± DP) | Homens | Mulheres |
|---|---|---|
| Velocidade no L2 (VT2), % da velocidade no VO₂pico | 86,5 a 87,1 (médias por nível, DP de 3,6 a 4,0) | 87,9 a 89,5 (médias por nível, DP de 3,2 a 3,9) |
| Velocidade no L1 (VT1), % da velocidade no VO₂pico | 72,8 a 73,5 (médias por nível, DP de 3,8 a 5,6) | 74,5 a 77,5 (médias por nível, DP de 2,9 a 6,2) |
| FC no L2, % da FCpico | 93,0 ± 2,5 | 94,2 ± 2,2 |
| FC no L1, % da FCpico | 84,2 ± 4,7 | 86,2 ± 4,3 |

(As FC por sexo vêm do artigo. Para a velocidade, o artigo traz médias por sexo e nível de condicionamento, aqui resumidas em faixas; o Lote 2 usará a tabela completa. O texto avisa que algumas porcentagens de velocidade diferem levemente entre texto e tabelas, então os números exatos serão conferidos no artigo antes de entrar no código.)

Resultado geral do estudo: L2 em 87,6 ± 3,9% e L1 em 73,9 ± 5,5% da velocidade no VO₂pico.

### Fontes de conferência

- Condello et al. (2014, J Sports Sci Med 13:309): limiar ventilatório em 67 ± 9% e ponto de compensação respiratória em 84 ± 6% da velocidade máxima (Vmax, não vVO₂máx). Mostra a mesma ordem de grandeza e que os percentuais variam com a referência escolhida.
- Daniels (modelo do ritmo de 60 minutos): em nossos exemplos, o ritmo sustentável por uma hora fica em 90,8% a 91,0% da vVO₂máx, ligeiramente acima do L2 de laboratório (cerca de 87 a 89%), dentro de um desvio-padrão. Uso como **conferência**, não como fonte.
- Estudo europeu de 2024 (971 homens e 301 mulheres): os percentuais nos limiares aumentam com o nível de treinamento. Ou seja, percentual fixo é uma aproximação. A faixa (média ± DP) acompanha cada estimativa.

### Como entra no Panzeri Run

- Cada estimativa vai com **faixa** (média ± 1 DP do estudo), não só o valor central. Exemplo: L2 de um homem com vVO₂máx de 15,1 km/h (cerca de 87% ± 4%) fica em cerca de 13,1 km/h, com faixa aproximada de 12,5 a 13,7 km/h.
- L1 tem DP maior e menos respaldo prático (o L1 é o limiar mais difícil de estimar sem exame). Será apresentado com confiança **mais baixa** que o L2.
- Quando houver ergoespirometria ou lactato informados pelo aluno, esses valores **substituem** a estimativa, com origem `medida`.
- Limitações do estudo: protocolo único (rampa de 0,3 km/h a cada 30 s), muitas participantes iniciantes entre as mulheres, poucas atletas de elite, e os percentuais são relativos ao VO₂pico medido. Aplicá-los à vVO₂máx **estimada** soma a incerteza da estimativa à do percentual. A confiança final reflete isso.

## 6. Zonas de treinamento

- Zonas por ritmo e por FC derivadas dos pontos L1 e L2 (três zonas: abaixo de L1, entre L1 e L2, acima de L2), no modelo polarizado.
- Conferência cruzada com os ritmos de Daniels (E, M, T, I, R), que partem do mesmo VDOT. Se as duas formas divergirem muito, o sistema marca a zona como de confiança baixa e deixa a decisão para a IA.
- Conversão: velocidade (km/h) é a representação canônica. Pace (min/km) é `60 / km/h`, calculado só na exibição. Teste automatizado de ida e volta.
- As zonas são **referência** para a IA e para o aluno, não prescrição. Conforme combinado, a IA continua decidindo o treino e pode se afastar das zonas com justificativa.

## 7. O que preciso que você decida

1. **Estágio do teste incremental:** 2 minutos (seu pedido) ou 3 minutos (maior respaldo)? Recomendo 3 minutos se a prioridade for defensabilidade, mas executo o que você escolher.
2. **Estimativa atual de VO₂ do 3 km (`483/t + 3,5`):** concordo em substituí-la por Daniels nos testes novos e manter a antiga apenas nos registros históricos, sem alterá-los? Hoje ela alimenta as medalhas e agentes, então o Lote 4 precisa cobrir isso. Preciso de seu aval para mexer nesse ponto, porque muda os números mostrados em algumas telas e agentes.
3. **Rótulo "estimativa":** concorda em chamar o VO₂ do 3 km e do incremental de "VO₂ estimado pelo desempenho" (e nunca "VO₂máx") nas telas e para a IA?
4. **Faixas de confiança:** aceito apresentar L1 com confiança baixa e L2 moderada, ou prefere ocultar L1 enquanto não houver exame?

## 8. Pendências de verificação (nada disso foi inventado, mas falta conferir fonte primária)

- Coeficientes de Daniels e Gilbert contra o livro ou tabelas publicadas.
- Gulati 2010 (mulheres) na fonte original.
- Números exatos de Esteve-Lanao 2026 nas tabelas do artigo.
- Protocolo de Kuipers 2003 (definição de `T`, `t` e do incremento) no artigo original.
- Nes et al. (2013, HUNT): `211 − 0,64 × idade`. Não consegui confirmar os coeficientes nesta rodada e, por isso, **não** está proposta.

## Referências

1. Daniels J, Gilbert J. Oxygen Power: Performance Tables for Distance Runners. 1979. Equações reproduzidas também em Daniels' Running Formula.
2. Kuipers H, Rietjens G, Verstappen F, Schoenmakers H, Hofman G. Effects of stage duration in incremental running tests on physiological variables. Int J Sports Med 2003;24(7):486-491. doi:10.1055/s-2003-42020
3. Jones AM, Doust JH. A 1% treadmill grade most accurately reflects the energetic cost of outdoor running. J Sports Sci 1996;14(4):321-327.
4. Noakes TD, Myburgh KH, Schall R. Peak treadmill running velocity during the VO2max test predicts running performance. J Sports Sci 1990;8:35-45.
5. Tanaka H, Monahan KD, Seals DR. Age-predicted maximal heart rate revisited. J Am Coll Cardiol 2001;37:153-156.
6. Gulati M, et al. Heart rate response to exercise stress testing in asymptomatic women. Circulation 2010;122:130-137.
7. Esteve-Lanao J, Sellés-Pérez S, Arévalo-Chico H, Cejuela R. Towards Accurate Reference Values for Heart Rate and Speed Zones by Aerobic Fitness and Sex in Long-Distance Runners. Sports (Basel) 2026;14(1):29. doi:10.3390/sports14010029
8. Condello G, et al. Simple approach to defining training intensity in endurance runners. J Sports Sci Med 2014;13:309-315.
9. Estudo sobre estimativa de VO₂máx por equação do ACSM em atletas (Hippokratia): "Indirect estimation of VO2max in athletes by ACSM's equation: valid or not?" (PubMed 24376318).
10. Estudo sobre equação do ACSM e 3 km: Comparison of VO2max Estimations for Maximal and Submaximal Exercise Tests in Apparently Healthy Adults (PMC10747607, 2023).
11. Frontiers in Physiology 2018 (Fox e Tanaka em maratonistas recreativos), doi:10.3389/fphys.2018.00226.
12. Frontiers in Physiology 2021 (incrementos de 1 km/h a cada 3 min), doi:10.3389/fphys.2021.680913.

---

# VERSÃO DEFINITIVA PARA APROVAÇÃO (30/10/2026, após as decisões de Elton)

Esta parte **substitui** as seções 3.2, 3.3, 7 e 8 acima. O restante continua valendo, com as correções abaixo.

## A. Decisões de Elton incorporadas

- Incremental: estágios de **2 minutos**, **+1 km/h por estágio**, **1% de inclinação**, velocidade inicial pelo perfil: 4 km/h (sedentário total ou condicionamento muito baixo), 5 (sedentário), 6 (baixo ou médio), 7 (alto). Guardada automaticamente com o resultado.
- 3 km: substituir `483/t + 3,5` por Daniels e Gilbert, **inclusive nos testes antigos**, recalculando a partir do tempo original. Resultado bruto, data e FC originais ficam intactos. A versão do modelo é gravada em cada cálculo.
- "VO₂máx estimado" como rótulo para valores indiretos. L1 e L2 sempre apresentados, com a confiança indicada.

## B. Verificação nas fontes (resultado)

| Item | Resultado |
|---|---|
| Daniels e Gilbert: custo de oxigênio e fração sustentável | **Coeficientes confirmados** em várias fontes independentes, todos com o mesmo conjunto, `v` em m/min e `t` em minutos. Conferi numericamente dois exemplos publicados: 10 km em 40:00 dá 51,9 (valor publicado: 51,9) e 10 km em 55:00 dá 35,77 (publicado: 35,774). Não consegui abrir o livro de 1979, então a base é a convergência das fontes mais esses dois casos |
| Gulati 2010 | **Confirmado** no resumo do artigo (Circulation 122:130-137, 5.437 mulheres assintomáticas, idade média de 52 anos): `FCmáx = 206 − 0,88 × idade`. Validações posteriores chegaram à mesma equação; um estudo da Mayo Clinic com 11 mil mulheres achou que ela subestima em mulheres mais velhas. Limitação: população clínica, não corredoras |
| Esteve-Lanao 2026 | **Confirmado** (Sports 14(1):29). Corredores com no mínimo um ano de treino estruturado e três ou mais corridas por semana, idade média de 37 anos. Esteira com 1% de inclinação e rampa de **0,3 km/h a cada 30 s (0,6 km/h por minuto)**, VO₂pico pela média de 1 min, limiares pelos critérios de Davis. **Não inclui sedentários** |
| Kuipers 2003 | **Confirmado** na forma usada em trabalhos posteriores: `Vpico = Vúltimo completo + (Inc × t / T)`, com `t` os segundos sustentados no estágio incompleto e `T` os segundos de um estágio completo. Machado et al. (2013) chamam essa forma de Vpico-P e mostram que ela correlaciona melhor com o desempenho do que a velocidade do último estágio completo, qualquer que seja a duração do estágio |

## C. Adequação ao protocolo incremental de 2 minutos

1. **Vpico-P (Kuipers e Machado) funciona com 2 minutos.** A fórmula é geral, bastando `T = 120 s` e `Inc = 1 km/h`.
2. **Ponto fraco, dito com franqueza:** Machado et al. (2013, J Sci Med Sport 16:577-582, 27 corredores recreativos) concluíram que **3 minutos** é preferível a 1 e 2 minutos para prever desempenho de 5 e 10 km (r = 0,95 e 0,92 com 3 min). Kuipers (2003) mostrou que estágios mais curtos dão velocidade de pico maior (18,3 km/h com 1 min, contra 17,1 com 3 min). Portanto, com 2 minutos, a Vpico tende a ficar um pouco acima da de um protocolo de 3 minutos. Mantemos 2 minutos por decisão sua, e o resultado fica gravado como "protocolo 2 min, +1 km/h, 1%".
3. **Argumento a favor de aplicar os percentuais de L1 e L2:** a velocidade no VO₂pico do estudo de Esteve-Lanao foi obtida numa rampa de 0,6 km/h por minuto. O nosso protocolo sobe **0,5 km/h por minuto** (1 km/h a cada 2 min), um ritmo de progressão muito próximo. A versão de 3 minutos, com 0,33 km/h por minuto, ficaria mais distante. Nesse aspecto os 2 minutos são mais compatíveis com a referência dos limiares do que os 3. Isso é uma inferência minha, que o estudo não testou, e será descrita assim.
4. **Duração total:** o estudo individualizou a velocidade inicial para o teste durar de 10 a 15 min, sem passar de 26 min. Com 2 min por estágio: quem começa em 6 km/h e para em 11 km/h faz cerca de 13 min. Quem começa em 7 e para em 15 faz cerca de 18 min. Quem começa em 4 e para em 8 faz 10 min. Todos dentro do limite do estudo.
5. **Marcha e corrida:** a partir de 8 km/h a maioria das pessoas corre. Abaixo disso, muitos alunos sedentários vão caminhar até o fim. Isso afeta o item D.

## D. VO₂máx estimado no teste incremental

A pesquisa não encontrou equação validada que estime VO₂máx a partir da velocidade de pico de um protocolo de 2 min com +1 km/h. A equação do ACSM é para estado estável e superestimou o VO₂máx de atletas em 14,6% num estudo com protocolo de Bruce. Você pediu para não aplicar equação de outro protocolo sem verificar. Proposta:

- **Resultado principal: Vpico-P**, a velocidade máxima atingida. É a variável com respaldo (Noakes 1990, Machado 2013).
- **VO₂máx estimado (opcional, confiança baixa):** custo de oxigênio de Daniels aplicado à Vpico-P, **somente quando a Vpico-P estiver no domínio do modelo** (corrida a partir de cerca de 10 km/h, onde começam as tabelas de Daniels, VDOT 30; fronteira a conferir na fonte). Abaixo disso, mostram-se velocidade, L1, L2 e zonas, sem VO₂ estimado.
- Por que Daniels e não ACSM: em 12 km/h, Daniels dá 36,0 e o ACSM com 1% dá 45,3. Ambos são aproximações que dependem da economia de corrida do aluno. O de Daniels foi derivado de desempenho em corrida, e o do ACSM tem superestimação documentada.
- **Alternativa B:** não estimar VO₂ no incremental, mostrando só velocidade, limiares e zonas. **Recomendo A**, se você aceitar o rótulo "VO₂máx estimado, confiança baixa" e o corte de domínio.

## E. L1, L2 e zonas

- Base: percentuais de Esteve-Lanao por sexo, aplicados à **vVO₂máx** (3 km: vVO₂ de Daniels; incremental: Vpico-P) e à **FCmáx** (informada ou estimada).
- **Fora da população do estudo:** quem escolhe 4 ou 5 km/h (sedentário) não pertence à população de corredores treinados do estudo. Para esses alunos, L1 e L2 aparecem como "referência de baixa confiança, fora da população estudada", e a IA recebe esse rótulo junto do número.
- Cada valor leva a **faixa** (média ± 1 DP) e a **origem** (medida, informada, estimada).
- Se o aluno informar ergoespirometria ou lactato, esses valores **substituem** as estimativas.

## F. Exemplos calculados

**Incremental, início em 6 km/h:** completa o estágio de 11 km/h e sustenta 70 s do de 12 km/h.
- `Vpico-P = 11 + 1 × 70/120 = 11,58 km/h` (pace 5:11/km).
- VO₂máx estimado (Daniels, dentro do domínio): 34,4, confiança baixa.
- Homem: L2 ≈ 86,7% de 11,58 = 10,0 km/h; L1 ≈ 73,1% = 8,5 km/h. Faixas pelo desvio-padrão do estudo: L2 de cerca de 9,6 a 10,5 e L1 de cerca de 7,9 a 9,0.
- Duração: cerca de 13 min.

**3 km em 12:00** (VDOT 47,9): vVO₂máx 15,10 km/h (3:58/km). Homem: L2 ≈ 13,1 km/h (4:35/km), L1 ≈ 11,0 km/h (5:26/km). Com FC máxima informada de 185 bpm: FC no L2 ≈ 172 e no L1 ≈ 156 bpm.

**FCmáx por idade, sem FC informada:** homem de 40 anos, Tanaka: 180 bpm. Mulher de 40 anos, Gulati: 171 bpm.

## G. Ainda em aberto

1. Conferir a fronteira de domínio de Daniels (VDOT 30) numa fonte primária.
2. Escolher entre D-A (estimar VO₂ no incremental, confiança baixa) e D-B (não estimar).
3. Texto de aviso para alunos com dificuldade de locomoção: será redigido no Lote 3 para sua revisão.
4. Números exatos das tabelas de Esteve-Lanao (velocidade por nível e sexo): fixados em teste automatizado no Lote 2.

Nada disso foi implementado. Aguardo a aprovação dos modelos para iniciar o Lote 2.
