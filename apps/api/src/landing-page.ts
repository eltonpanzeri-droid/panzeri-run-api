import { CHECKOUT_URL, WEB_PRICE, results, faq } from './landing/data';
import { styles } from './landing/styles';
import { script } from './landing/script';

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const logo = `<img class="brand-icon" src="/landing-assets/panzeri-run-logo.png" width="40" height="40" alt="" decoding="async">`;
const cta = (event: string) =>
  `<a href="${CHECKOUT_URL}" class="button button-primary" data-checkout data-track="${event}">COMEÇAR MEU TREINO <span aria-hidden="true">&nbsp;↗</span></a>`;
const heading = (tag: string, title: string, text = '') =>
  `<div class="heading"><span class="eyebrow">${tag}</span><h2>${title}</h2>${text ? `<p>${text}</p>` : ''}</div>`;
const cards = (items: string[][], className = 'grid') =>
  `<div class="${className}">${items.map(([title, text], i) => `<article class="card"><span class="card-num">${String(i + 1).padStart(2, '0')}</span><h3>${title}</h3><p>${text}</p></article>`).join('')}</div>`;
const nav = `<a href="#como-funciona">Como funciona</a><a href="#resultados">Resultados</a><a href="#inclui">O que inclui</a><a href="#planos">Começar</a><a href="#duvidas">Dúvidas</a>`;
const product = `<div class="product-visual" aria-label="Visão conceitual do planejamento, não uma captura de tela do aplicativo"><div class="product-top"><span>PANZERI RUN</span><span>SEU PLANEJAMENTO</span></div><h2>Uma semana.<br>Parte de um caminho maior.</h2><p>Corrida, força e recuperação.<br>Organizados para o seu momento.</p><div class="week" aria-hidden="true"><span class="day">S</span><span class="day active">T</span><span class="day">Q</span><span class="day active">Q</span><span class="day">S</span><span class="day active">S</span><span class="day">D</span></div><div class="session-card"><small>PLANEJAMENTO INDIVIDUALIZADO</small><h3 class="session-title">Saiba o que fazer.<br>E por que fazer.</h3><p>Objetivo da sessão · intensidade · execução</p></div><div class="session-card"><small>DEPOIS DE TREINAR</small><p>O que você fez e como respondeu também fazem parte do planejamento.</p></div><p class="product-note">Representação conceitual do processo de treinamento.</p></div>`;
const resultCards = results
  .map(
    (result, index) =>
      `<article class="result-card" ${result.featured ? '' : 'hidden data-extra-result'}><div class="result-copy"><span class="eyebrow">${escapeHtml(result.category.toUpperCase())}</span><h3>${result.featured ? '“' : ''}${escapeHtml(result.title)}${result.featured ? '”' : ''}</h3><p>${escapeHtml(result.description)}</p></div><button class="result-image-button" type="button" data-result-index="${index}" aria-label="Toque para ler o print completo: ${escapeHtml(result.title)}"><img src="${result.image}" alt="Print original de depoimento sobre ${escapeHtml(result.category.toLowerCase())}" loading="lazy" decoding="async" width="${result.width}" height="${result.height}"><span>Toque para ler o print completo <span aria-hidden="true">↗</span></span></button></article>`,
  )
  .join('');
const config = JSON.stringify({ checkoutUrl: CHECKOUT_URL, results }).replace(/</g, '\\u003c');

export const LANDING_PAGE_HTML = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "yibnn0x7im");
</script>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ZJXHZVSDL8"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-ZJXHZVSDL8');
</script>
<meta charset="utf-8"><link rel="icon" href="/landing-assets/panzeri-run-logo.png"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#071A3D"><title>Panzeri Run | Treino de corrida personalizado</title><meta name="description" content="Treinamento de corrida personalizado para seu nível, objetivo e rotina. Planejamento para 5 km, 10 km, meia maratona e maratona."><link rel="canonical" href="https://eltonpanzeripersonal.com.br/"><meta property="og:type" content="website"><meta property="og:title" content="Panzeri Run | Treino de corrida sob medida"><meta property="og:description" content="Seu treino precisa se adaptar a você. Não o contrário."><meta property="og:url" content="https://eltonpanzeripersonal.com.br/"><meta property="og:locale" content="pt_BR"><meta name="twitter:card" content="summary"><script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Panzeri Run","applicationCategory":"HealthApplication","description":"Aplicativo de planejamento personalizado de treinamento de corrida."}</script><style>${styles}</style></head>
<body id="top"><a class="skip" href="#conteudo">Ir para o conteúdo</a>
<header class="site-header" id="siteHeader"><div class="container header-inner"><a class="brand" href="#top" aria-label="Panzeri Run, início">${logo}PANZERI RUN</a><nav class="desktop-nav" aria-label="Navegação principal">${nav}</nav>${cta('header_cta_click')}<button class="menu-toggle" id="menuToggle" aria-expanded="false" aria-controls="mobileMenu" aria-label="Abrir ou fechar menu">☰</button></div><nav class="mobile-nav" id="mobileMenu" aria-label="Navegação mobile" hidden>${nav}</nav></header>
<main id="conteudo">
<section class="hero"><div class="container hero-grid"><div class="hero-copy"><span class="eyebrow">TREINAMENTO DE CORRIDA PERSONALIZADO</span><h1>Seu treino precisa se adaptar a você.<br><span class="blue">Não o contrário.</span></h1><p>O Panzeri Run organiza seu treinamento a partir do seu nível, objetivo, disponibilidade e evolução.</p><p>Você treina, registra como foi e o planejamento continua acompanhando o caminho que você realmente percorreu.</p>${cta('hero_cta_click')}<p class="micro">Para quem quer começar, correr 5 km, 10 km, meia maratona ou maratona.</p><ul class="benefit-list"><li>Treino individualizado</li><li>Corrida + força</li><li>Progressão estruturada</li></ul></div>${product}</div></section>
<div class="trust-bar"><div class="container trust-grid"><div><strong>Desde 2009</strong><span>experiência profissional com treinamento</span></div><div><strong>Ciência aplicada</strong><span>fisiologia, comportamento e progressão</span></div><div><strong>Vida real</strong><span>treino construído para caber na rotina</span></div></div></div>
<section class="pale" data-track-view="problem_view"><div class="container">${heading('O PROBLEMA', 'Uma planilha pronta conhece a distância da prova.<br><span class="blue">Ela não conhece você.</span>', 'Duas pessoas podem querer correr os mesmos 10 km e precisar de treinamentos completamente diferentes.')}<div class="grid">${[
  ['Histórico', 'Quanto você já corre, há quanto tempo treina e como chegou até aqui.'],
  ['Disponibilidade', 'Quantos dias você realmente consegue treinar dentro da sua rotina.'],
  ['Capacidade atual', 'Ritmos, volume, tolerância ao esforço e experiência.'],
  ['Rotina', 'Trabalho, família, musculação, viagens e imprevistos.'],
  ['Resposta ao treino', 'O treino planejado pode ser igual. A resposta de cada corpo não é.'],
]
  .map(
    ([title, text], i) =>
      `<article class="card"><span class="card-num">0${i + 1}</span><h3>${title}</h3><p>${text}</p></article>`,
  )
  .join(
    '',
  )}<article class="card card-conclusion"><h3>Por isso o planejamento precisa começar pelo corredor.</h3><p>E continuar acompanhando o que acontece depois que ele começa a treinar.</p></article></div></div></section>
<section class="dark"><div class="container split"><div>${heading('UM PROCESSO, NÃO UMA LISTA', 'Você não precisa de mais uma lista de quilômetros.', 'Precisa saber por que correr, quanto correr, em qual intensidade, quando recuperar e como progredir.')}<p class="closing">O Panzeri Run organiza cada semana dentro de uma progressão maior.</p><p>O treino de hoje precisa fazer sentido dentro daquilo que você fez antes e daquilo que quer conseguir depois.</p></div><div class="flow" aria-label="Etapas do processo">${['AVALIAR', 'PLANEJAR', 'TREINAR', 'REGISTRAR', 'AJUSTAR', 'EVOLUIR'].map((word) => `<span>${word}</span>`).join('')}</div></div></section>
<section id="como-funciona" data-track-view="how_it_works_view"><div class="container">${heading('COMO FUNCIONA', 'Como seu treinamento é construído.', 'O plano nasce das informações que realmente mudam a prescrição.')}<div class="steps">${[
  [
    'Você conta onde está',
    'Objetivo, experiência, rotina, disponibilidade, força, fadiga, dores e histórico de treinamento.',
  ],
  [
    'Definimos o ponto de partida',
    'Seu treinamento começa naquilo que você consegue fazer hoje, e não em uma meta arbitrária de quilômetros.',
  ],
  [
    'Seu plano é estruturado',
    'Volume, intensidades, distribuição semanal, estímulos específicos e fortalecimento são organizados dentro de uma progressão.',
  ],
  [
    'Você treina e registra',
    'Depois das sessões, suas informações ajudam a contextualizar como seu corpo respondeu ao processo.',
  ],
  [
    'O planejamento continua evoluindo',
    'As próximas semanas consideram o caminho que você realmente percorreu.',
  ],
]
  .map(
    ([title, text], i) =>
      `<article class="step"><strong>0${i + 1}</strong><h3>${title}</h3><p>${text}</p></article>`,
  )
  .join('')}</div><div class="section-action">${cta('how_it_works_cta_click')}</div></div></section>
<section class="pale" data-track-view="app_showcase_view"><div class="container">${heading('NO APLICATIVO', 'Abra e saiba exatamente o que fazer.', 'Sem tentar interpretar uma planilha ou adivinhar qual deveria ser o próximo passo.')}<div class="showcase-grid">${[
  [
    '▦',
    'Sua semana',
    'Veja as sessões programadas e como elas se distribuem dentro da sua rotina.',
  ],
  [
    '↗',
    'Cada treino explicado',
    'Distância, duração, intensidade, séries, recuperação e objetivo da sessão.',
  ],
  ['✓', 'Registre como foi', 'O treino realizado importa tanto quanto o treino planejado.'],
  [
    '↗',
    'Acompanhe a evolução',
    'Seu histórico deixa de ser uma coleção de quilômetros e passa a fazer parte do planejamento.',
  ],
]
  .map(
    ([symbol, title, text]) =>
      `<article class="card"><span class="app-symbol" aria-hidden="true">${symbol}</span><h3>${title}</h3><p>${text}</p></article>`,
  )
  .join('')}</div></div></section>
<section><div class="container split"><div>${heading('VIDA REAL', 'Porque a vida real não segue uma planilha.', 'Planejamento esportivo não existe isolado da vida.')}<p class="closing">Seu treino precisa continuar fazendo sentido mesmo quando a semana muda.</p><p>Esses acontecimentos fazem parte do treinamento. O objetivo do Panzeri Run é manter o processo coerente quando a realidade muda.</p></div><ul class="life-list">${['Você perdeu um treino.', 'Uma semana ficou mais pesada.', 'Sua disponibilidade mudou.', 'A prova se aproximou.', 'Um treino ficou mais difícil do que deveria.', 'Seu desempenho mudou.'].map((text) => `<li>${text}</li>`).join('')}</ul></div></section>
<section class="pale" id="na-pratica"><div class="container">${heading('NA PRÁTICA · EXEMPLO FICTÍCIO', 'O próximo treino parte da semana que você viveu.', 'Imagine uma situação muito comum. A aluna Mariana quer correr seus primeiros 10 km, mas precisa conciliar os treinos com a vida real.')}<div class="story-intro"><p>Mariana quer correr seus primeiros 10 km. Mas também trabalha, cuida da família e quer ter tempo para outras coisas. No início, imagina conseguir treinar três vezes por semana.</p><p>O Panzeri Run começa conhecendo seu histórico, capacidade atual, disponibilidade, objetivos e limitações. A partir daí, estrutura um plano e orienta como executar cada sessão: o que fazer, em qual intensidade e com qual objetivo.</p></div><div class="grid story-grid">${cards(
  [
    [
      'O planejado encontra a vida real',
      'Na terça-feira, chove no horário do treino e Mariana não tem um lugar seguro para correr. Surge a dúvida: trocar a sessão, deixar para amanhã ou seguir sem ela? Repor por conta própria pode mudar a recuperação entre os treinos.',
    ],
    [
      'O que aconteceu vira informação',
      'Mariana registra o treino não realizado e conta o motivo no check-in semanal. Também informa o que conseguiu cumprir, como se sentiu e quanto tempo terá disponível. Não é apenas uma ausência: é contexto para o planejamento.',
    ],
    [
      'A próxima semana respeita essa resposta',
      'Na reavaliação semanal, o Panzeri Run cruza o realizado com a resposta ao esforço e a rotina disponível. Esse contexto orienta o que manter, reorganizar ou progredir. Um treino perdido não é uma dívida que precisa ser paga a qualquer custo.',
    ],
  ],
  'grid story-cards',
)}</div><div class="progress-quote"><h3>Pessoas diferentes não precisam avançar no mesmo calendário.</h3><p class="closing">Quem consegue cumprir o plano e responde bem pode estar pronto para progredir antes. Quem enfrenta imprevistos ou precisa de mais tempo também merece um caminho coerente, sem ficar para trás por não viver só para correr.</p><p>O comportamento real e a resposta do aluno orientam a próxima semana. O plano deixa de ser um calendário engessado e passa a acompanhar o que realmente aconteceu.</p><p class="micro">Os ajustes descritos são semanais, a partir dos registros e do check-in. Nesse caso fictício, o Panzeri Run considera esse imprevisto, as demais informações e o progresso da aluna para orientar a próxima progressão semanal com foco em segurança e evolução.</p></div></div></section>
<section><div class="container">${heading('SEU MOMENTO', 'Existe um caminho para o corredor que você é hoje.', 'Você não precisa chegar pronto. O planejamento existe justamente para construir o caminho.')}<div class="grid audience-grid">${[
  [
    '01',
    'Quero começar a correr',
    'Comece respeitando seu nível atual e construa capacidade progressivamente.',
  ],
  [
    '5–10',
    'Quero correr 5 ou 10 km',
    'Desenvolva resistência, ritmo e capacidade de sustentar esforço.',
  ],
  [
    '21,1',
    'Quero correr minha primeira meia',
    'Construa volume e especificidade sem transformar cada treino em uma prova.',
  ],
  [
    'RP',
    'Quero melhorar meu tempo',
    'Estruture intensidade, volume e recuperação de acordo com a sua capacidade.',
  ],
  [
    '42,2',
    'Quero correr uma maratona',
    'Organize meses de preparação dentro de uma progressão coerente.',
  ],
]
  .map(
    ([distance, title, text]) =>
      `<article class="card"><span class="distance">${distance}</span><h3>${title}</h3><p>${text}</p></article>`,
  )
  .join('')}</div></div></section>
<section id="resultados" data-track-view="results_section_view"><div class="container">${heading('RESULTADOS REAIS', 'O aplicativo é novo.<br><span class="blue">O método por trás dele não.</span>', 'Antes de existir o Panzeri Run como aplicativo, corredores com histórias, níveis e objetivos diferentes já eram treinados usando os princípios que deram origem ao sistema.')}<p style="margin-bottom:30px;font-size:13px">Resultados de corredores treinados pelo método que deu origem ao Panzeri Run.</p><div class="results-grid" id="resultsGrid">${resultCards}</div><div class="section-action"><button class="button button-secondary" id="expandResults" aria-expanded="false" aria-controls="resultsGrid">VER MAIS RESULTADOS</button></div><div class="progress-quote"><span class="eyebrow">PROGRESSÃO PERCEBIDA</span><h3>Quando a pessoa começa a enxergar a própria evolução, o treino ganha outro significado.</h3><blockquote>“A cada treino você coloca um tempo e eu consigo superar, dando sempre o meu melhor. Isso tem me deixado muito feliz, porque consigo enxergar de verdade a minha evolução. Obrigada por acreditar em mim e me desafiar cada vez mais.”</blockquote><cite>Depoimento espontâneo de uma aluna real treinada pelo método.</cite></div></div></section>
<section class="authority pale" data-track-view="authority_section_view"><div class="container split"><img class="authority-photo" src="/landing-assets/elton.jpeg" width="853" height="1280" alt="Elton Panzeri durante uma corrida" loading="lazy" decoding="async"><div>${heading('QUEM ESTÁ POR TRÁS', 'O aplicativo é novo.<br>O método por trás dele não.', 'Sou Elton Panzeri, Profissional de Educação Física formado pela UFMG e trabalho como Personal Trainer e treinador desde 2009.')}<p class="closing">Durante esses anos acompanhei pessoas com níveis, rotinas e objetivos completamente diferentes. Iniciantes, corredores buscando seus primeiros 5 km, pessoas preparando meias maratonas e maratonas e corredores tentando melhorar performance.</p><p>O Panzeri Run nasceu da tentativa de transformar essa lógica de prescrição em um sistema capaz de organizar treinamento, comportamento e evolução de forma mais acessível.</p><p>Formação complementar em Neurociência do Comportamento, Terapia Cognitivo-Comportamental e Psicologia Positiva.</p><p class="signature">Tecnologia é a ferramenta.<br>Treinamento continua sendo o fundamento.</p></div></div></section>
<section id="inclui"><div class="container">${heading('O QUE VOCÊ RECEBE', 'Muito mais do que “segunda: 5 km”.')}${cards(
  [
    [
      'Planejamento de corrida',
      'Sessões organizadas de acordo com seu objetivo e momento do treinamento.',
    ],
    [
      'Intensidades orientadas',
      'Ritmos e estímulos definidos de acordo com o objetivo de cada sessão.',
    ],
    ['Fortalecimento', 'Treino de força integrado ao planejamento quando aplicável.'],
    ['Progressão', 'Seu treinamento faz parte de uma sequência, e não de semanas independentes.'],
    ['Registro', 'Informe o que fez e como respondeu ao treino.'],
    ['Ajustes', 'O planejamento considera mudanças no processo e na sua rotina.'],
    ['Provas', 'Estrutura progressiva para 5 km, 10 km, meia maratona e maratona.'],
    ['Educação', 'Você também aprende a compreender o próprio treinamento.'],
  ],
  'grid features-grid',
)}</div></section>
<section class="dark" id="planos" data-track-view="pricing_view"><div class="container split">${heading('COMECE PELO PONTO EM QUE VOCÊ ESTÁ', 'Seu próximo objetivo começa no próximo treino.', 'Entre no Panzeri Run, responda à avaliação inicial e comece a organizar seu treinamento em torno da sua realidade.')}<div class="pricing-card"><span class="eyebrow">PANZERI RUN</span><h3>Plano de treinamento</h3><div class="price">${WEB_PRICE}<span> / mês</span></div><p class="micro">Assinatura mensal pela plataforma web.</p><ul>${['Treinamento personalizado', 'Treinos de corrida', 'Treino de força quando aplicável', 'Progressão estruturada', 'Registro das sessões', 'Acompanhamento da evolução'].map((text) => `<li>${text}</li>`).join('')}</ul>${cta('pricing_cta_click')}<p class="micro">Consulte as condições de contratação e cancelamento antes de concluir.</p></div></div></section>
<section id="duvidas"><div class="container">${heading('DÚVIDAS', 'O que você precisa saber antes de começar.')}<div class="faq-list">${faq.map(([question, answer], i) => `<article class="faq-item"><h3><button class="faq-trigger" aria-expanded="false" aria-controls="faq-answer-${i}">${question}<span aria-hidden="true">+</span></button></h3><div class="faq-answer" id="faq-answer-${i}" hidden><p>${answer}</p></div></article>`).join('')}</div></div></section>
<section class="final-cta pale"><div class="container">${heading('COMECE AGORA', 'Seu objetivo pode estar a meses de distância.<br><span class="blue">O próximo treino está muito mais perto.</span>', 'Comece pelo ponto em que você está hoje. O Panzeri Run organiza o caminho a partir daí.')}${cta('final_cta_click')}</div></section>
</main><footer class="footer"><div class="container"><div class="footer-top"><div><a class="brand" href="#top">${logo}PANZERI RUN</a><p>Treino de corrida sob medida.</p></div><nav aria-label="Links institucionais"><a href="/termos-de-uso">Termos de Uso</a><a href="/politica-privacidade">Política de Privacidade</a><a href="https://wa.me/5531992538375" target="_blank" rel="noopener">Contato</a><a href="https://www.instagram.com/eltonpanzeripersonal/" target="_blank" rel="noopener">Instagram</a></nav></div><div class="footer-bottom"><p>© 2026 Panzeri Run. Todos os direitos reservados.</p><p>O Panzeri Run fornece orientação de treinamento físico e não substitui avaliação ou acompanhamento médico.</p></div></div></footer>
<div class="mobile-sticky-cta">${cta('mobile_sticky_cta_click')}</div>
<dialog id="resultLightbox" aria-label="Depoimento completo"><div class="lightbox-toolbar"><p id="lightboxCaption"></p><div class="lightbox-arrows"><button id="previousResult" aria-label="Depoimento anterior">←</button><button id="nextResult" aria-label="Próximo depoimento">→</button><button id="closeLightbox" aria-label="Fechar depoimento" autofocus>×</button></div></div><img id="lightboxImage" alt="Depoimento completo"></dialog><script id="landing-config" type="application/json">${config}</script><script>${script}</script></body></html>`;
