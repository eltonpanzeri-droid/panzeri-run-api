/**
 * Metodologia Elton Panzeri — conhecimento real do treinador, coletado diretamente com ele
 * para fundamentar as decisoes do agente de prescricao. Isto NAO e conhecimento generico de
 * treinamento de corrida — e a forma como Elton realmente pensa e decide, em suas proprias
 * palavras (traduzido para orientar o agente). Deve ser tratado como fonte primaria: preservar
 * os numeros e o raciocinio reais, nao generalizar para regras de blog de corrida.
 */
export const PANZERI_METHODOLOGY_KNOWLEDGE = `
# Metodologia Elton Panzeri (fonte: o proprio treinador)

## Principio central
Toda regra abaixo (80/20, zonas, progressao) e um NORTE — uma referencia flexivel — nunca uma
regra rigida. Interprete os dados de cada aluno individualmente. Exemplo dado pelo treinador:
para alguém com limiar aerobico baixo, forcar um ritmo genuinamente "leve" exigiria caminhar;
isso nao ajuda o desenvolvimento. Alguém que treina so 2x por semana quebra completamente a
logica de distribuicao de volume pensada para quem treina mais vezes. Regras existem para
orientar, nao para travar o julgamento.

**O que e obrigatorio vs. o que e recomendado (distincao explicita do treinador):**
- E OBRIGATORIO classificar/entender o esforco em termos de zona (Z1-Z5) — isso e uma ferramenta
  conceitual de raciocinio e comunicacao, nao opcional.
- NAO e obrigatorio que o pace numerico prescrito siga uma formula fixa derivada da zona. O pace
  real de cada sessao vem do seu raciocinio sobre a evidencia do aluno (teste, auto-relato,
  Strava), nao de uma tabela de multiplicadores por zona.
- A proporcao 80/20 (baixa/alta intensidade) e RECOMENDADA como referencia geral, NAO e
  obrigatoria. Alunos com pouca disponibilidade, limiar baixo, ou objetivos especificos podem
  fugir bastante dela com razao.
- E OBRIGATORIO entender o seguinte: um aluno cujo limiar/pace confortavel esta proximo do ritmo
  de caminhada vai precisar passar MAIS tempo em intensidade alta, nao menos. Isso porque, abaixo
  de um pace de aproximadamente 8:30/km, a mecanica da corrida piora (fica biomecanicamente
  parecido com andar rapido, ineficiente). Para esses alunos, a solucao nao e forcar uma corrida
  continua lenta com mecanica ruim — e usar treinos INTERVALADOS com intensidade mais alta na
  parte de corrida (pace mais forte, mesmo parecendo "intenso" para o nivel do aluno), alternando
  com CAMINHADA de verdade (nao um trote lento) como recuperacao, com paces de caminhada maiores
  (mais lentos). Essa decisao deve vir do pace REAL que voce mesmo calculou para o aluno
  (paceAssessment), nao de uma classificacao generica de "iniciante" — um aluno pode nao ser
  iniciante em experiencia e ainda assim ter um limiar proximo da caminhada (ex: alguem
  destreinado ou com sobrepeso ha pouco tempo correndo), e o contrario tambem e possivel.

## Iniciante com limiar baixo (quando "leve de verdade" exigiria caminhar)
Nao forcar corrida continua lenta demais. Em vez disso:
- Um dia da semana vira caminhada continua usada como "longao": progressao 5km -> 6km -> 8km
  (8km costuma ser o teto), pace 10:00-12:00/km, cerca de 1h30. O objetivo e acostumar o corpo
  a ficar mais tempo em exercicio, nao aumentar intensidade.
- Os demais dias usam intervalado caminhada/corrida (ex.: 10x 0,5km andando + 0,1km correndo,
  evoluindo para 0,5x0,2, depois 0,3x0,2...). Varia-se ao longo das semanas: o tempo total
  correndo, o tamanho de cada estimulo de corrida, e a "densidade" (razao caminhada/corrida) —
  as vezes mais tempo correndo com pausas maiores, as vezes menos pausa mantendo o tempo de
  corrida.
- Existe uma faixa de velocidade a evitar: entre "rapido demais para andar" e "lento demais
  para correr" (equivalente a cerca de 7-8km/h). Por isso o iniciante ja corre numa faixa de
  pace equivalente a 7-8km/h, em vez de mais lento.
- Quanto mais iniciante, mais leve o pace de corrida sugerido.

## Frequencia baixa (ex.: 2x/semana)
Um treino continuo (caminhada para iniciante, focado em aumentar volume/distancia total) + um
intervalado. Conforme aumenta a frequencia semanal, os treinos extras entram como mais
intervalados, cada um com um objetivo individual diferente por sessao (nao repetir a mesma
formula). Exemplo dado (aluno correndo seg/qua/sex/sab):
- Segunda: progressao semana a semana na distancia corrida de cada serie, mantendo a pausa fixa.
- Quarta: mantem a mesma estrutura (ex. sempre 0,5km corrida / 0,5km caminhada), mas aumenta a
  velocidade da corrida.
- Sexta: mexe na densidade corrida:caminhada — uma semana muda a proporcao, na seguinte mantem
  a densidade mas muda as distancias absolutas, outra semana muda so o pace mantendo densidade
  e distancias.
Regra importante: nunca mexer em tudo ao mesmo tempo — cada sessao/semana isola qual variavel
esta progredindo (distancia da serie, pausa, velocidade, densidade), mantendo as outras estaveis.

## Treino longo / longao
- Preferir sempre uma faixa de pace, nao um pace fixo — controlar pace exato na rua e dificil
  na pratica.
- Longao progressivo em blocos so entra quando o aluno ja tem mais bagagem: referencia dada foi
  "consegue fazer 10km num pace perto de 6:00/km" e "ja fez longos maiores que 10-15km". Isso
  NAO e regra fixa, e um NORTE.
- Progressao do volume do longao (regra geral, com boa aderencia): NAO e crescimento linear —
  e ondulado, com recuos entre picos. Exemplo literal dado pelo treinador:
  semana1: 10km, semana2: 8km, semana3: 12km, semana4: 8km, semana5: 10km, semana6: 14km,
  semana7: 10km, semana8: 12km, semana9: 16km...
- Decisao de como seguir depende do feedback subjetivo do aluno depois do longao mais desafiador:
  - "deu para fazer" / tranquilo -> mantem progressao parecida.
  - dificuldade real mas suportavel -> repete a mesma distancia mais vezes antes de tentar subir.
  - sofrimento excessivo / dor -> recua bastante e demora mais semanas antes de repetir aquele
    patamar.
  - Importante: investigar primeiro se a dificuldade foi situacional (esqueceu gel, nao
    hidratou, saiu mais tarde/calor) antes de tratar como sinal real de limite — se foi
    situacional, tenta manter a progressao normalmente.

## Intensidade alta (Z4/Z5) — quando usa, quando evita
Nao existe "nunca", mas usa pouco para quem treina poucas vezes por semana. Raciocinio:
- O que mais traz resultado e o volume semanal total, principalmente viabilizar o treino longo
  (de preferencia bem longo). As outras sessoes da semana sao desenhadas em funcao de garantir
  que esse longao aconteca.
- Evita Z3 deliberadamente — trabalha com Z2 e Z4/Z5 (inclusive supramaximo em intervalados),
  pulando a zona intermediaria.
- Para iniciantes, qualquer velocidade de corrida ja representa uma zona intensa — ou seja, o
  iniciante naturalmente tem uma proporcao mais alta de "intensidade alta" so por nao ter zona
  confortavel ainda. Conforme o aluno evolui, a proporcao se aproxima do 80/20 classico.
- Metodo de progressao de intervalados para alunos avancados: o foco nao e so "correr rapido",
  e aumentar o TEMPO DE EXPOSICAO numa faixa de intensidade entre o pace-alvo de prova e o pace
  de VO2max. Variaveis manipuladas uma de cada vez, alternando semana a semana: duracao/distancia
  total da sessao, tempo ou distancia de cada serie, numero de series, distancia total corrida
  em cada serie. Aceita-se piorar uma variavel para melhorar outra na mesma semana (nao sobe
  tudo simultaneamente); o objetivo e que, ao longo de varias semanas, todas as variaveis tenham
  subido.

## Fortalecimento (forca) — volume e frequencia
Primeiro fator e a rotina disponivel. Depois:
- Iniciante: como corre pouco volume/intensidade e precisa de mais tempo de recuperacao entre
  sessoes de corrida, usa fortalecimento MAIS vezes.
- Corredor com mais volume e intensidade: usa fortalecimento MENOS vezes — a transicao e
  gradual, nao um corte abrupto.
- Semanas especiais (prova chegando, ou o aluno vai fazer o longao mais longo da vida dele, ou
  um longao que ele ainda nao "consolidou"): alivia o fortalecimento, as vezes deixando so 1
  sessao, orientando o aluno a fazer essa sessao o mais longe possivel do dia do longao.

## Dor relatada (nao lesao grave) — regua de decisao
Avaliar a caracteristica da dor: esta aumentando ao longo do tempo/treinos? Aparece so depois da
corrida ou ja no inicio? Comeca leve e piora durante a propria sessao? Atrapalha o dia a dia?
Escala de dor (0-10) -> acao: ate 4 mantem o treino normalmente; 5-6 reduz (intensidade/volume);
acima de 6 corta o treino daquele dia.

## Uso concreto do Strava (o que realmente pesa, em ordem)
1. Completou a distancia prescrita? 2. Pace bateu com o prescrito? 3. Frequencia cardiaca — usada
para saber se o treino foi muito exigente mesmo que distancia/pace tenham batido. 4. O feedback
do aluno — pesa tanto quanto os dados objetivos, nao e secundario.

## Papel da satisfacao relatada (Amei/Gostei/Neutro/Nao gostei/Detestei)
Muda decisao mesmo com boa aderencia. Regra: se o MESMO feedback se repete 2 ou 3 vezes seguidas,
muda mais a prescricao (ex.: aluno cumprindo tudo certinho mas marcando "Nao gostei" repetidamente
e sinal de ajustar, nao so de comemorar a aderencia). Funciona como gatilho de RECORRENCIA, nao de
ocorrencia isolada — mesma logica usada para decidir reduzir o pico de volume.

## Periodizacao em torno de prova (pico -> polimento -> prova -> pos-prova)
Sobe o volume ate um pico. Mantem o pico por algumas semanas: primeiras semanas do pico com a
mesma intensidade, depois tenta subir intensidade mantendo o volume. 2-3 semanas antes da prova:
polimento — reduz volume, mantem intensidade. Semana da prova: pouco volume, pouca intensidade.
Pos-prova: reinicia com volume baixo, respeitando o tempo de cada aluno "recuperar a motivacao"
(existe uma especie de "post-race blues" — alguns alunos demoram bem mais que outros para voltar
animados; isso nao e preguica, e esperado).

## Regra de decisao: manter vs. reduzir o volume/longao no pico
Enquanto o aluno corre bem e da bons feedbacks, mantem. Quando aparecem sinais de cansaco, ainda
mantem por mais um tempo (nao reage ao primeiro sinal). So reduz quando os sinais de cansaco ficam
RECORRENTES — o sinal mais forte e a piora em treinos que o aluno ja esta habituado a fazer bem
(regressao num treino que era rotina pesa mais do que dificuldade num treino novo/desafiador).
`.trim();
