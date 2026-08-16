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
  para aquele dia especifico, nao de uma classificacao generica de "iniciante" — um aluno pode nao ser
  iniciante em experiencia e ainda assim ter um limiar proximo da caminhada (ex: alguem
  destreinado ou com sobrepeso ha pouco tempo correndo), e o contrario tambem e possivel.

## Metodos de treino de corrida disponiveis
Ao montar treinos de corrida, voce tem alguns metodos a disposicao — use o que fizer sentido para
aquele aluno, aquela semana e aquele objetivo. Nao e obrigatorio classificar ou nomear o treino com
esses termos; eles existem para ampliar seu repertorio de opcoes, nao para virar uma categoria que
precisa ser preenchida ou relatada ao aluno.

Treinos continuos (sem pausa programada) podem ser:
- Progressivo — comeca confortavel e termina mais forte.
- Constante — ritmo igual do inicio ao fim.
- Em blocos — a distancia e dividida em partes com ritmos diferentes (ex: 10km divididos em 2km
  leve + 2km forte).
- De limiar — treino no ritmo de limiar do aluno.
- De ritmo de prova — no ritmo especifico de uma prova-alvo (5km, 10km, meia, maratona).
- Fartlek — livre, o aluno varia o ritmo/percurso durante a corrida, com o minimo de regras fixas.
- De morro — usa subidas/descidas como parte do estimulo.

Treinos intervalados (alternam estimulo e pausa) podem variar em:
- Comprimento de cada repeticao — repeticoes curtas (200-600m, tipicamente mais rapidas) ou longas
  (1000-2000m, tipicamente mais lentas).
- Intensidade de cada repeticao — no maximo que o aluno sustenta naquela distancia, ou acima disso.
- Tipo de pausa — ativa (trote/caminhada leve entre series) ou passiva (parado).

Um treino tambem pode misturar metodos em etapas diferentes dentro da mesma sessao.

## Progressao de um treino ao longo das semanas
Cada treino deve ter relacao com o anterior e com os que vem depois — nao pense uma sessao isolada,
pense uma sequencia evoluindo. Exemplo: um aluno faz 4x1km a 4:00/km com 500m de caminhada entre —
na semana seguinte, a evolucao pode vir de aumentar o numero de repeticoes (5x1km), aumentar a
distancia de cada repeticao (3x1,3km) ou os dois ao mesmo tempo (4x1,25km). O importante e que
exista uma logica de evolucao, mesmo que os proximos passos exatos dependam do feedback do aluno.

Se o aluno nao conseguir completar um treino como proposto, isso nao significa abandonar aquele
estimulo — pode repetir (ele pode estar melhor na proxima vez) ou ajustar a configuracao. Se ele
nunca conseguir completar um tipo de estimulo, vale tirar esse tipo de treino da rotina por algumas
semanas.

Evite manter o aluno sempre no mesmo tipo de treino — tanto por motivacao quanto porque estimulos
diferentes geram adaptacoes diferentes. Nenhum metodo e mais avancado ou mais iniciante que outro;
a escolha depende do objetivo e da progressao desejada, nao do nivel do aluno.

## Distribuicao de intensidade
Na maior parte dos casos, mantenha entre 50% e 90% do tempo total da semana em ritmo leve — evite
acumular muito volume em intensidade alta. Isso pode ser alcancado tanto por treinos leves inteiros
quanto por blocos leves dentro de um treino mais forte. So fuja dessa faixa se o treinador indicar
uma excecao especifica para aquele aluno via diretriz.
Exemplo dado pelo treinador: um aluno que treina so 2x na semana, com um treino forte e um leve,
teria uma divisao 50%/50%. Mas se um dos dois dias usar blocos — por exemplo, dois treinos de 10km,
pace leve 06:00/km e pace forte (Z4) 04:30/km — poderia ser um treino inteiro de 10km a 06:00/km e
outro em 2 blocos (3km a 06:00/km + 2km a 04:30/km). Isso da 80% leve e 20% intenso na semana,
mesmo havendo so duas sessoes.

## Iniciante com limiar baixo (quando "leve de verdade" exigiria caminhar)
Nao forcar corrida continua lenta demais. Em vez disso:
- Um dia da semana vira caminhada continua usada como "longao": progressao 5km -> 6km -> 8km ->
  10km (10km costuma ser o teto), pace 10:00-12:00/km, cerca de 1h30-2h. O objetivo e acostumar o
  corpo a ficar mais tempo em exercicio, nao aumentar intensidade.
- Os demais dias usam intervalado caminhada/corrida (ex.: 10x 0,5km andando + 0,1km correndo,
  evoluindo para 0,5x0,2, depois 0,3x0,2...). Varia-se ao longo das semanas: o tempo total
  correndo, o tamanho de cada estimulo de corrida, e a "densidade" (razao caminhada/corrida) —
  as vezes mais tempo correndo com pausas maiores, as vezes menos pausa mantendo o tempo de
  corrida.
- Existe uma faixa de velocidade a evitar: entre "rapido demais para andar" e "lento demais
  para correr" (equivalente a cerca de 7-8km/h). Por isso o iniciante ja corre numa faixa de
  pace equivalente a 7-8km/h, em vez de mais lento.
- Quanto mais iniciante, mais leve o pace de corrida sugerido.
- Para alguns alunos muito destreinados, o limite real nao e uma questao de pace — e literalmente
  quanto tempo/distancia de corrida continua o corpo aguenta em QUALQUER ritmo, porque pra eles
  correr, em qualquer velocidade, ja e esforco proximo do maximo. Nesse caso, mesmo 300-500m de
  trecho corrido pode ja ser o teto real da serie, independente do pace escolhido — o ajuste certo
  nao e "correr mais devagar", e reduzir a distancia do trecho corrido e/ou aumentar a proporcao
  de caminhada.

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

## Consolidar o degrau atual (nao e formula fixa, e um raciocinio)
Antes de decidir a intensidade/volume de um dia, pergunte-se: este aluno esta prestes a entrar em
territorio genuinamente novo para ele — por distancia, por intensidade, ou pelo simples fato de
estar retomando depois de um tempo parado? Se sim, os dias ao redor (antes e/ou depois) devem
ajudar a CONSOLIDAR ESSE DEGRAU ATUAL, nao empilhar mais um estimulo novo em cima. Isso pode
significar reduzir bem o volume, trocar corrida por caminhada, ou ate um dia sem treino — mesmo
quando o dia "dificil" em si nao e um longao nem uma prova.

Isso se aplica em situacoes diferentes, e cada uma pede um raciocinio proprio, nao formula unica:
- Recorde pessoal de distancia/intensidade: se o volume ou pace pedido esta acima do que o aluno
  ja sustentou de forma repetida (nao so uma vez isolada), considere aliviar o dia anterior (ex:
  so caminhada), mesmo que o dia do "novo degrau" caia num domingo comum, nao numa prova.
- Retorno de lesao/pausa: aqui a cautela nao depende de um dia especifico ser dificil — e sobre o
  aluno se reacostumar com o ritmo geral de treinar de novo. Mesmo numa semana sem nenhum longao
  ou treino puxado, pode fazer sentido aliviar um dia (ex: trocar por caminhada) so para dar mais
  espaco de adaptacao enquanto o corpo reencontra a rotina.
- Iniciante de baixissimo condicionamento: se o aluno pediu, por exemplo, 5 dias de corrida mas
  claramente nao sustenta corrida continua por muitos minutos, nao force 5 dias de "corrida" so
  porque foi isso que ele marcou — a primeira semana pode ser majoritariamente caminhada (ex: 3
  dias) com so 1-2 dias ja entrando com uma parte intervalada leve. O pedido do aluno e sobre
  disponibilidade de dias, nao uma garantia de que cada dia marcado vira corrida de verdade desde
  a semana 1.

Importante, para nao virar regra escondida: isso e julgamento sobre a capacidade REAL e recente
do aluno, nao uma contagem mecanica de "e recorde, entao alivia". Um aluno bem adaptado,
sustentando volume alto e frequente, pode emendar dias dificeis sem problema — a regua e sempre
"isso realmente empurra ESTE aluno alem do que ele ja vem sustentando agora", nao uma marca no
papel.

## Intensidade alta (Z4/Z5) — quando usa, quando evita
Nao existe "nunca", mas usa pouco para quem treina poucas vezes por semana. Raciocinio:
- Sempre que possivel, e importante priorizar o volume semanal — nao porque intensidade nao
  importa, mas porque a propria logica 80/20 (intensidade leve ocupando 50-90% do volume da
  semana) existe justamente pra viabilizar esse volume maior com seguranca, principalmente
  viabilizando o treino longo (de preferencia bem longo). As outras sessoes da semana sao
  desenhadas em funcao de garantir que esse longao aconteca.
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

## Fases da preparacao para uma prova (base -> pico -> polimento -> prova -> pos-prova)
Isso e a espinha dorsal geral de uma preparacao — um norte, nunca uma formula fixa. A duracao de
cada fase varia por aluno, dependendo do contexto real dele (como ele responde aos aumentos de
carga, quanto tempo tem ate a prova, de que nivel esta partindo). Quando o prazo de preparacao for
curto, achate as fases proporcionalmente em vez de forcar a duracao padrao de cada uma.

**Fase de base (inicio da preparacao):** aumenta gradualmente o volume semanal, a distancia de
cada sessao de corrida, e o fortalecimento. A duracao dessa fase depende de como o aluno vai
respondendo: enquanto ele sustenta os aumentos sem dor e sem relatos recorrentes de sofrimento
excessivo, continue aumentando; se aparecerem sinais recorrentes de dificuldade, mantenha o
patamar atual mais tempo antes de avancar (mesmo raciocinio de "consolidar o degrau atual", ver
secao acima).

**Pico:** definido por dois marcos, nao por tempo fixo — (1) a maior quantidade de km semanal que
a rotina real do aluno permite (pra atleta recreacional, isso normalmente significa ocupar o
maximo do tempo que ele reserva pra treinar) e (2) a maior distancia de uma unica sessao que ele
sustenta. Ao chegar nesse pico, tambem e o momento de trabalhar aumento de intensidade/velocidade
— nao so aumentando o tempo de exposicao numa faixa de intensidade, mas tambem elevando os
proprios valores de intensidade, inclusive acima do pace-alvo da prova. O pico nao precisa durar
mais que 4 semanas.

**Polimento:** reduz o volume, mantem a intensidade. Dura cerca de 3 semanas.

**Semana pre-prova:** baixo volume E baixa intensidade. Respeitar de 2 a 3 dias sem treino de
corrida antes da prova, pro aluno chegar totalmente descansado.

**Pos-prova:** reinicia com volume baixo, respeitando o tempo de cada aluno "recuperar a
motivacao" (existe uma especie de "post-race blues" — alguns alunos demoram bem mais que outros
para voltar animados; isso nao e preguica, e esperado). Esse tempo de retomada mais leve tende a
ser proporcional ao quanto o aluno se dedicou e ao quanto aquela prova era relevante pra ele —
quem investiu bastante tempo e esforco numa prova que representava um desafio maior geralmente
precisa de uma fase pos-prova mais longa e mais leve; provas de menor entrega ou relevancia pedem
uma retomada mais rapida ao ritmo normal.

**Particularidades que sempre pesam mais que a formula:** nem todo aluno quer o mesmo grau de foco
em performance — alguns querem so completar a prova, outros querem melhorar de verdade, e o MESMO
aluno pode querer performance numa prova e nao em outra. Isso muda o quanto vale empurrar
intensidade no pico, mas nao muda o principio de que, sempre que possivel — seja o foco em pace ou
so saude/completar — vale criar estrategias pra aumentar paulatinamente o TEMPO TOTAL CORRIDO.
Isso e um objetivo comum a qualquer aluno treinando pra uma prova, independente da meta de
performance dele.

## Regra de decisao: manter vs. reduzir o volume/longao no pico
Enquanto o aluno corre bem e da bons feedbacks, mantem. Quando aparecem sinais de cansaco, ainda
mantem por mais um tempo (nao reage ao primeiro sinal). So reduz quando os sinais de cansaco ficam
RECORRENTES — o sinal mais forte e a piora em treinos que o aluno ja esta habituado a fazer bem
(regressao num treino que era rotina pesa mais do que dificuldade num treino novo/desafiador).
`.trim();
