# Textos "O que isso representa" — RASCUNHO PARA REVISÃO

Criado em 02/11/2026 por Claude, a pedido de Elton ("crie os textos, depois eu reviso"). **Rascunho:** passa pela sua revisão e depois pela do advogado antes de valer como definitivo.

**Onde editar:** `apps/mobile/home/indicatorMeanings.ts` (um único arquivo; a chave é o código do indicador). Este documento é só uma cópia legível, gerada desse arquivo.

**Regras de redação usadas (suas decisões de 02/11):** o texto explica o que o indicador é, o que "mais" e "menos" significam e o que ele NÃO permite concluir; inferência com fonte é permitida ("indicadores de sono ruim estão associados a maior chance de lesão"), nunca causa direta; nenhum indicador é analisado sozinho. Em toda explicação aparece este rodapé:

> Nenhum indicador é analisado sozinho: usamos dezenas deles, em conjunto, para montar o seu programa. Isto não é diagnóstico médico.

---

## Sono e recuperação — o que você informa

### Qualidade do sono
`workout.preSleepQuality`

É a sua percepção, de 1 a 5, de como foi a noite antes do treino. Quanto mais perto de 5, melhor você sentiu que descansou. O sono faz parte da recuperação e da adaptação ao treino: em estudos com atletas, noites curtas ou de má qualidade aparecem associadas a pior recuperação, a maior chance de lesão e a queda de desempenho. Uma nota isolada não diz nada sobre a sua recuperação; o que importa é o padrão ao longo do tempo, comparado ao seu próprio habitual.

### Duração estimada do sono
`workout.sleepDurationHoursEstimate`

É quantas horas você estima que dormiu na noite anterior, informadas no feedback do treino. Costuma ser menos preciso do que a medida de um relógio. Dormir por um tempo consistente e suficiente favorece a recuperação, mas o quanto é "suficiente" varia de pessoa para pessoa; por isso comparamos com o seu próprio padrão.

### Interrupções do sono
`workout.sleepInterruption`

Mostra o quanto o seu sono foi interrompido durante a noite (1 = nada ou quase nada, 5 = extremamente). Um sono fragmentado costuma ser menos reparador, mesmo quando o total de horas parece suficiente. Acordar de vez em quando é comum; o que observamos é se isso se repete.

### Dificuldade para pegar no sono
`workout.sleepDifficulty`

Mostra a dificuldade que você teve para pegar no sono (1 = nenhuma, 5 = extrema). Ela pode vir de estresse, excesso de estímulos à noite, treino tarde ou ansiedade. Quando se repete, costuma acompanhar uma qualidade de sono pior, e por isso é um sinal que acompanhamos junto com os demais.

### Horário de dormir vs. habitual
`workout.bedtimeShiftDirection`

Compara o horário em que você foi dormir com o seu horário habitual. Horários muito irregulares atrapalham o ritmo do relógio biológico e podem piorar a qualidade do sono. Uma mudança pontual (viagem, evento) é normal; o que observamos é se ela se repete.

### Horário de acordar vs. habitual
`workout.wakeTimeShiftDirection`

Compara o horário em que você acordou com o seu horário habitual. Acordar em horários muito diferentes de um dia para o outro bagunça o ritmo do relógio biológico. Uma mudança pontual é normal; o que observamos é se ela se repete.

## Sono e recuperação — o que o relógio mede

### Duração do sono medida pelo relógio
`wearable.sleepDurationMin`

É o tempo de sono medido pelo seu relógio. Relógios de pulso estimam o sono a partir de movimento e batimentos cardíacos e podem errar o início, o fim e as pausas da noite. Marcas diferentes medem de jeitos diferentes; por isso só comparamos com o seu próprio histórico, na mesma fonte. Serve para ver tendências, não valores exatos.

### Sono profundo (estimativa do relógio)
`wearable.sleepDeepMin`

O sono profundo é a fase mais ligada à recuperação física do corpo. O relógio ESTIMA as fases do sono: não é um exame de sono e a precisão varia entre aparelhos. Use para acompanhar tendências, não para tirar conclusões de uma noite só.

### Sono leve (estimativa do relógio)
`wearable.sleepLightMin`

O sono leve é a fase de transição, ocupa boa parte da noite e é normal que seja a maior delas. O relógio estima as fases a partir de movimento e batimentos; a precisão varia entre aparelhos. Olhe a tendência, não uma noite isolada.

### Sono REM (estimativa do relógio)
`wearable.sleepRemMin`

O sono REM é a fase mais ligada à recuperação mental e à memória. O relógio estima as fases; a precisão varia entre aparelhos e não substitui um exame de sono. Olhe a tendência ao longo das semanas, não uma noite isolada.

### Pontuação do sono (calculada pelo relógio)
`wearable.sleepScore`

É uma pontuação calculada pelo fabricante do relógio, com uma fórmula própria (duração, fases, interrupções e outros fatores). Não existe um padrão universal: 80 pontos em uma marca não equivalem a 80 em outra. Serve para acompanhar a sua própria evolução, na mesma fonte.

### Variabilidade da frequência cardíaca (HRV) da noite
`wearable.hrvLastNightAvg`

A variabilidade da frequência cardíaca (HRV) é a variação do tempo entre um batimento e outro. Em geral, valores acima do seu habitual aparecem em períodos de boa recuperação, e valores mais baixos em períodos de estresse, cansaço acumulado, doença ou pouco sono. Álcool, calor e o horário da medida também influenciam. Como o método e a unidade mudam de um aparelho para outro, comparamos só com o seu próprio histórico, na mesma fonte.

## Bem-estar — prontidão pré-treino

### Cansaço físico antes do treino
`workout.prePhysicalFatigue`

Mostra como estava o seu cansaço físico ao chegar no treino (1 = muito baixo, 5 = muito alto). Ele pode refletir um treino anterior pesado, pouco sono, doença ou uma rotina corrida. Quando se mantém alto por vários treinos seguidos, pode indicar que a recuperação não está acompanhando a carga.

### Cansaço mental antes do treino
`workout.preMentalFatigue`

Mostra o seu cansaço mental ao chegar no treino (1 = muito baixo, 5 = muito alto): trabalho, estudo, decisões e preocupações pesam aqui. Não é a mesma coisa que o cansaço físico, mas também influencia o esforço que o treino parece exigir e a disposição para fazê-lo.

### Nível de estresse
`workout.preStressLevel`

Mostra o seu nível geral de estresse ao chegar no treino (1 = muito baixo, 5 = muito alto). Estresse alto está associado a sono pior, recuperação mais lenta e treinos que parecem mais pesados. O treino pode ajudar a aliviar o estresse, mas somado a muita carga também pode pesar.

### Frequência de momentos de estresse (últimas 24 h)
`workout.stressEventFrequency`

Mostra com que frequência, nas últimas 24 horas, você passou por momentos que aumentaram claramente o seu estresse (1 = nenhuma vez, 5 = quase continuamente). Mede a frequência desses momentos, não a intensidade geral do estresse, que aparece no indicador ao lado.

### Vontade de treinar
`workout.preMotivation`

Mostra a sua vontade de treinar ao chegar no treino (1 = muito baixa, 5 = muito alta). É um sinal de como corpo e cabeça estão respondendo à rotina. Uma queda que dura semanas costuma acompanhar cansaço acumulado, estresse ou monotonia; não é questão de força de vontade.

## Bem-estar — resposta pós-treino

### Cansaço físico provocado pelo treino
`workout.postPhysicalFatigue`

Mostra o quanto o treino cansou o seu corpo (1 = muito pouco, 5 = extremamente). Cansaço alto depois de um treino difícil é esperado. Vale observar quando ele fica alto depois de treinos leves ou quando aumenta aos poucos ao longo das semanas.

### Cansaço mental provocado pelo treino
`workout.postMentalFatigue`

Mostra o quanto o treino cansou a sua cabeça (1 = muito pouco, 5 = extremamente). Treinos de alta intensidade, muito longos ou que exigem muita atenção costumam cansar mais a mente. Observamos se isso muda em relação ao seu habitual.

### Experiência emocional durante o treino
`workout.emotionalExperienceDuring`

Mostra como você se sentiu emocionalmente durante o treino (1 = muito mal, 5 = muito bem). Sentir prazer e bem-estar ao treinar ajuda a manter a regularidade; uma experiência ruim que se repete pode afetar a motivação. Treino difícil não é, por si só, experiência ruim.

### Mudança do estado mental (antes × depois)
`workout.mentalStateChangePrePost`

Mostra como o treino mudou o seu estado mental, comparando antes e depois (1 = muito pior, 5 = muito melhor). O exercício costuma melhorar o humor, mas nem sempre. Piora que se repete, treino após treino, merece atenção.

## Bem-estar — check-in da semana

### Resposta do corpo comparada ao seu normal
`checkin.bodyResponseVsNormal`

Mostra como você sente que o seu corpo respondeu aos treinos da semana, comparado ao seu normal (3 = dentro do normal; acima, melhor que o habitual; abaixo, pior). É a sua percepção, e ajuda a perceber se a semana foi bem absorvida.

### Vontade de continuar treinando (fim da semana)
`checkin.postWeekMotivation`

Mostra a sua vontade de continuar treinando ao fim da semana (1 = muito baixa, 5 = muito alta). Uma queda que se mantém por várias semanas pode indicar cansaço acumulado, excesso de carga ou desânimo com a rotina.

## Resposta à carga

### Esforço percebido (PSE)
`workout.perceivedEffort`

O esforço percebido (PSE) é a sua nota, de 1 a 10, para o quão pesado o treino pareceu. É muito usado no treinamento porque reflete o esforço total sentido pelo corpo e pela cabeça, e não só o ritmo ou a distância. O mesmo treino pode parecer mais pesado em dias de pouco sono, cansaço ou estresse. Um valor isolado não diz se o treino foi adequado; ele é lido junto com carga, sono, dor e os demais indicadores.

### Carga de cada treino (esforço × minutos)
`workout.sessionInternalLoad`

A carga de cada treino é o esforço percebido (1 a 10) multiplicado pelos minutos de treino, em UA (unidade arbitrária). Ela junta a intensidade sentida e o tempo em um só número e permite comparar treinos de durações diferentes. Descreve a exigência percebida, e não o risco; o significado vem da comparação com o seu próprio histórico.

### Carga acumulada por semana
`load.weekly`

A carga da semana soma as cargas (esforço × minutos) de todos os treinos registrados na semana. Mostra o quanto de esforço você acumulou, semana a semana. Semana sem nenhum treino com esforço e duração registrados fica sem ponto, porque pode ser falta de registro, e não falta de treino. Cada pessoa tem a sua faixa habitual; o que importa é a mudança em relação ao seu hábito.

### Carga recente × seu hábito (razão aguda ÷ crônica)
`load.acuteChronic`

Compara a carga dos últimos 7 dias (aguda) com a média semanal dos últimos 28 dias (crônica). Perto de 1,0, a semana é parecida com o seu hábito recente; acima, é mais carregada; abaixo, mais leve. Algumas pesquisas associam aumentos bruscos de carga, em relação ao que o corpo está acostumado, a maior chance de lesão; o tema ainda é debatido. A razão, sozinha, não prevê lesão nem diz o que fazer.

### Volume: relação aguda ÷ crônica (km)
`training.acwr`

Compara o volume em km dos últimos 28 dias com o dos últimos 42 dias. Perto de 1,0, o volume recente é parecido com o seu hábito; acima, você aumentou o volume; abaixo, diminuiu. Aumentos graduais costumam ser melhor tolerados do que saltos bruscos, que em algumas pesquisas aparecem associados a lesões. Não considera a intensidade e não prevê lesão por si só.

### Frequência cardíaca média de cada atividade
`activity.avgHeartRateBpm`

A frequência cardíaca média mostra a resposta cardiovascular do corpo àquele treino. Ela sobe com a intensidade e também com calor, desidratação, pouco sono, estresse, doença e cafeína, e muda conforme o tipo de sensor. Por isso comparamos com o seu próprio histórico, para o mesmo tipo de treino; contextos diferentes (leve, intervalado, força) não devem ser comparados entre si.

### Exigência da semana comparada ao seu normal
`checkin.weekDemandVsNormal`

Mostra o quanto a semana de treinos pareceu exigente em comparação a uma semana normal sua (3 = dentro do normal). É a sua percepção, que pode ou não coincidir com os números de volume e de carga; comparar os dois é útil para entender como o corpo está lidando com o programa.

## Evolução do treinamento

### Volume por semana (prescrito, percorrido, extras)
`training.volume`

Mostra, semana a semana, o volume em km: o prescrito (o que o programa pediu), o percorrido (tudo o que você fez, incluindo extras) e os extras (iniciativa sua). O volume é só uma dimensão do treino: não diz nada sobre intensidade nem sobre o tipo de treino. Aumentos graduais costumam ser melhor tolerados pelo corpo do que saltos bruscos.

### Diferença: realizado − prescrito
`training.volumeDiffAbsoluteKm`

É a diferença entre o que você realizou e o que foi prescrito na semana, em km. Positivo significa que você fez mais do que o prescrito (os treinos extras entram no realizado); negativo, menos; zero, exatamente o prescrito. Mostra como a semana real se afastou do plano, sem dizer se foi bom ou ruim.

### Razão: realizado ÷ prescrito
`training.volumeRatioCompletedPrescribed`

É quanto do volume prescrito você realizou (1,0 = exatamente o prescrito; 0,8 = 80%; 1,2 = 20% a mais). Os treinos extras entram no realizado. Mostra o tamanho da semana real em relação ao plano; semana sem volume prescrito não entra.

### Cadência
`activity.cadenceAvg`

A cadência é o número de passos por minuto. Ela costuma subir com o ritmo e variar com o terreno, o cansaço e o tipo de treino, e é bem individual: não existe valor certo para todas as pessoas. O que observamos é como a sua cadência muda ao longo do tempo para treinos parecidos.

### Ritmo
`activity.avgPaceSecondsKm`

O ritmo é o tempo médio que você levou para cada km. Depende do tipo de treino (leve, longão, intervalado), do terreno, do clima e do cansaço, por isso treinos diferentes não devem ser comparados entre si. Ritmo mais lento ou mais rápido não é bom nem ruim por si só: depende do objetivo daquele treino.

### Tempo dentro da faixa de ritmo prescrita
`execution.timeInBandPct`

Mostra a parte do tempo observável do treino em que o seu ritmo ficou dentro da faixa de ritmo prescrita. Só entram corridas com faixa prescrita e dados do relógio. Ficar fora da faixa nem sempre é falha: terreno, calor, cansaço e semáforos influenciam, e alguns treinos têm intenções diferentes em cada parte.

## Aderência

### Aderência por semana
`training.adherencePercent`

É a proporção de treinos feitos entre os que você registrou (feitos ÷ feitos + não feitos). Treinos sem registro não entram na conta, e por isso responder o feedback de cada treino é tão importante. Mostra a regularidade com que você cumpre o programa, e o que importa é o padrão ao longo das semanas.

## Dor

### Dor em cada treino
`pain.perWorkout`

Mostra a dor que você relatou em cada treino registrado. Dor é um dos sinais mais importantes para ajustarmos o programa: dor que se repete, aumenta ou aparece mais cedo no treino pesa nas nossas decisões. Treino registrado em que você não relatou dor aparece como sem dor, e por isso responder sobre dor em todo treino é fundamental.

### Relatos feitos em "Relatar dor"
`pain.reports`

São os relatos que você fez em "Relatar dor", com região do corpo, intensidade de 1 a 10 e se a dor está piorando, estável ou melhorando. Dor que persiste, piora ou atrapalha o dia a dia é um sinal importante, e este acompanhamento não substitui a avaliação de um profissional de saúde. Se a dor for forte ou não melhorar, procure um profissional.

---

## Pontos para você decidir na revisão

1. **Afirmações com pesquisa** (sono e lesão em atletas; aumento brusco de carga e lesão; HRV e recuperação): estão escritas com cautela ("estão associadas", "algumas pesquisas", "o tema ainda é debatido"). Confirme se é o nível de cautela que você quer e se quer citar a fonte na tela "Fontes científicas e metodologia".
2. **Dor:** o texto diz que treino registrado sem relato de dor aparece como "sem dor" (sua regra de 02/11) e que o acompanhamento não substitui profissional de saúde.
3. **Relógio:** fases do sono, pontuação e HRV dizem que são estimativas do aparelho e que só se comparam com a própria aluna, na mesma fonte.
4. **Frase final:** "Isto não é diagnóstico médico" repete o aviso do topo da Evolução.
