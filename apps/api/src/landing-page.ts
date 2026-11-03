import { CHECKOUT_URL, WEB_PRICE } from './landing/data';
import { styles } from './landing/styles';
import { script } from './landing/script';

// Landing redesign 03/11/2026 — conteúdo/visual vem do projeto construído com o ChatGPT (ver
// Ponte Dra Elaine x Agente Leo); esta camada liga tudo ao rastreamento, checkout e lojas reais.
const config = JSON.stringify({ checkoutUrl: CHECKOUT_URL }).replace(/</g, '\\u003c');
const priceNumber = WEB_PRICE.replace('R$', '').trim();

const storeButtons = (center = false) => `<div class="store-actions${center ? ' store-actions-center' : ''}">
  <a class="store-button" href="https://play.google.com/store/apps/details?id=com.panzerirun.app" data-store="play" data-track="store_play_click" target="_blank" rel="noopener" aria-label="Baixar Panzeri Run na Google Play"><span class="store-icon">▶</span><span><small>DISPONÍVEL NO</small><strong>Google Play</strong></span></a>
  <a class="store-button" href="https://apps.apple.com/br/app/panzeri-run/id6805618958" data-store="apple" data-track="store_apple_click" target="_blank" rel="noopener" aria-label="Baixar Panzeri Run na App Store"><span class="store-icon apple">●</span><span><small>BAIXE NA</small><strong>App Store</strong></span></a>
</div>`;

const testimonialPhone = (file: string, alt: string, caption: string) =>
  `<figure class="testimonial-phone reveal"><div class="testimonial-device"><span class="device-speaker" aria-hidden="true"></span><img src="/landing2-assets/${file}" alt="${alt}" loading="lazy"></div><figcaption>${caption}</figcaption></figure>`;

const videoCard = (file: string, label: string) =>
  `<div class="video-card reveal"><video controls preload="none" data-name="${file}" poster="" playsinline><source src="/landing2-media/${file}" type="video/mp4"></video></div>`;

export const LANDING_PAGE_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
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
<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','1019622314418918');fbq('track','PageView');</script><noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=1019622314418918&ev=PageView&noscript=1"/></noscript>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Treinamento de corrida individualizado com a metodologia Elton Panzeri, inteligência artificial e acompanhamento contínuo da sua evolução.">
<meta name="theme-color" content="#061724">
<link rel="icon" href="/landing-assets/panzeri-run-logo.png">
<link rel="canonical" href="https://eltonpanzeripersonal.com.br/">
<meta property="og:type" content="website">
<meta property="og:title" content="Panzeri Run — corrida orientada por dados, contexto e método">
<meta property="og:description" content="Seu treino evolui com você. Conheça o aplicativo de corrida que transforma seus dados e sua experiência em orientação individualizada.">
<meta property="og:url" content="https://eltonpanzeripersonal.com.br/">
<meta property="og:locale" content="pt_BR">
<meta name="twitter:card" content="summary">
<title>Panzeri Run — Seu treino evolui com você</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Panzeri Run","applicationCategory":"HealthApplication","description":"Aplicativo de planejamento personalizado de treinamento de corrida."}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${styles}</style>
</head>
<body>
  <a class="skip" href="#conteudo">Ir para o conteúdo</a>
  <header class="topbar">
    <a class="brand" href="#inicio" aria-label="Panzeri Run, início"><span class="brand-mark">▥</span> PANZERI RUN</a>
    <nav aria-label="Navegação principal">
      <a href="#como-funciona">Como funciona</a>
      <a href="#metodo">Metodologia</a>
      <a href="#historias">Histórias</a>
    </nav>
    <a class="button button-small" href="#assinar" data-scroll-cta data-track="header_cta_click">Começar agora</a>
  </header>

  <main id="conteudo">
    <section class="hero" id="inicio" data-track-view="hero_view">
      <div class="hero-copy reveal">
        <span class="eyebrow">HÁ UM LUGAR PARA VOCÊ NA CORRIDA</span>
        <h1>Corra para pertencer. Evolua para <em>inspirar.</em></h1>
        <p class="lead">Comece com os amigos, cuide da sua saúde e descubra uma confiança que aparece na corrida — e acompanha você para o resto da vida.</p>
        <div class="hero-actions">
          <a class="button" href="#assinar" data-scroll-cta data-track="hero_cta_click">Quero começar minha jornada</a>
          <a class="text-link" href="#produto">Ver o aplicativo <span>↓</span></a>
        </div>
        <div class="trust-row" aria-label="Diferenciais">
          <span>✓ Treinos com segurança</span>
          <span>✓ Evolução possível para você</span>
          <span>✓ Metodologia Elton Panzeri</span>
        </div>
      </div>
      <div class="hero-visual reveal">
        <div class="photo-frame"><img src="/landing2-assets/hero-elton.jpg" alt="Elton Panzeri correndo uma maratona no Rio de Janeiro"></div>
        <div class="floating-card fc-one"><strong>507 km</strong><span>histórico analisado</span></div>
        <div class="floating-card fc-two"><strong>94%</strong><span>aderência</span></div>
        <div class="pulse" aria-hidden="true"></div>
      </div>
    </section>

    <section class="section-light" style="padding-top:80px;padding-bottom:0">
      <div class="container" style="max-width:420px;margin:0 auto">
        ${testimonialPhone('testemunho-01-mental-confianca.jpg', 'Aluna relatando que o teste foi mental e que está conseguindo', '"O teste foi pra mim. Mental. Eu consigo e estou conseguindo."')}
      </div>
    </section>

    <section class="manifesto section-light" data-track-view="manifesto_view">
      <div class="section-heading reveal">
        <span class="eyebrow">CORRER É MAIS DO QUE TREINAR</span>
        <h2>Você não precisa assistir de fora. Ainda há muita vida para viver correndo.</h2>
      </div>
      <div class="experience-grid">
        <article class="experience reveal"><span>01</span><h3>Pertencer</h3><p>Começar a correr com os amigos e fazer parte das histórias que antes pareciam distantes.</p></article>
        <article class="experience reveal"><span>02</span><h3>Confiar</h3><p>Reconhecer, passo a passo, que você é capaz de construir algo importante.</p></article>
        <article class="experience reveal"><span>03</span><h3>Inspirar</h3><p>Ser o exemplo positivo que pode ajudar outra pessoa a cuidar de si também.</p></article>
        <figure class="experience-photo reveal"><img src="/landing2-assets/conquista.jpg" alt="Corredores comemorando a chegada em uma maratona"><figcaption>A preparação constrói o momento.</figcaption></figure>
      </div>
    </section>

    <section class="profile section-light" id="sua-historia">
      <div class="profile-copy reveal">
        <span class="eyebrow">SEU TREINO PRECISA COMEÇAR EM VOCÊ</span>
        <h2>Queremos saber quem você é, onde deseja chegar e como sua vida acontece.</h2>
        <p>Experiência, objetivos, rotina, disponibilidade e condições atuais mudam completamente a forma de prescrever. É conhecendo você de verdade que construímos um programa realmente individualizado.</p>
        <p class="profile-note">Quanto melhor entendemos sua realidade, mais seguro, possível e significativo se torna o caminho.</p>
      </div>
      <div class="profile-demo reveal" aria-label="Exemplo ilustrativo de informações iniciais">
        <div class="demo-head"><span>PERFIL DO CORREDOR</span><small>exemplo ilustrativo</small></div>
        <div class="answer"><small>MEU OBJETIVO</small><strong>Correr meus primeiros 10 km</strong></div>
        <div class="answer"><small>MINHA EXPERIÊNCIA</small><strong>Estou começando agora</strong></div>
        <div class="answer"><small>MINHA ROTINA</small><strong>Tenho 3 dias por semana</strong></div>
        <div class="context-ready"><span></span><div><small>CONTEXTO INICIAL</small><strong>Pronto para orientar o planejamento</strong></div></div>
      </div>
    </section>

    <section class="comparison context-section" id="metodo" data-track-view="comparison_view">
      <div class="section-heading reveal">
        <span class="eyebrow">O QUE TORNA UM TREINO INDIVIDUALIZADO</span>
        <h2>Nenhum dado sozinho conta a verdade sobre o seu treinamento.</h2>
        <p>A qualidade está em analisar muitas informações, entender como elas se relacionam e, principalmente, reconhecer como você responde a cada estímulo.</p>
      </div>
      <div class="context-grid">
        <article class="context-card reveal"><span>01</span><h3>O que foi prescrito</h3><p>Objetivo, tipo de treino, volume, intensidade e momento da preparação.</p></article>
        <article class="context-card reveal"><span>02</span><h3>O que seu corpo mostrou</h3><p>Ritmo, distância, frequência cardíaca, cadência e demais dados disponíveis.</p></article>
        <article class="context-card reveal"><span>03</span><h3>Como você respondeu</h3><p>Esforço, dor, sono, descanso, prontidão emocional e sensação após o treino.</p></article>
        <article class="context-card featured reveal"><span>04</span><h3>O próximo passo</h3><p>Avançar, manter ou reduzir depende da relação entre tudo isso — nunca de um número isolado.</p></article>
      </div>
      <div class="testimonial-phones" aria-label="O que alunos dizem sobre a diferença do Panzeri Run" style="margin-top:70px">
        ${testimonialPhone('testemunho-03-comparacao-apps-1.jpg', 'Aluno comparando o Panzeri Run com outros aplicativos de corrida', 'Já testou outros apps')}
        ${testimonialPhone('testemunho-04-comparacao-apps-2.jpg', 'Aluna comparando o Panzeri Run com outros aplicativos de corrida', '"O programa é top demais"')}
        ${testimonialPhone('testemunho-05-comparacao-apps-3.jpg', 'Aluno descrevendo as primeiras impressões do Panzeri Run', 'Primeiras impressões')}
      </div>
    </section>

    <section class="product section-light" id="produto" data-track-view="product_view">
      <div class="product-copy reveal">
        <span class="eyebrow">O APLICATIVO POR DENTRO</span>
        <h2>Você treina. O Panzeri Run transforma cada registro em contexto.</h2>
        <p>Não olhamos apenas para pace e distância. Relacionamos o treino com sono, descanso, prontidão emocional, esforço, dor e a forma como você terminou para decidir se é hora de avançar, manter ou reduzir.</p>
        <div class="tabs" role="tablist" aria-label="Telas do aplicativo">
          <button class="tab active" role="tab" aria-selected="true" data-screen="inicio">Minha semana</button>
          <button class="tab" role="tab" aria-selected="false" data-screen="treino">Meu treino</button>
          <button class="tab" role="tab" aria-selected="false" data-screen="historico">Histórico</button>
          <button class="tab" role="tab" aria-selected="false" data-screen="evolucao">Evolução</button>
          <button class="tab" role="tab" aria-selected="false" data-screen="volume">Volume</button>
          <button class="tab" role="tab" aria-selected="false" data-screen="integracoes">Integrações</button>
        </div>
        <div class="tab-note" id="tab-note">Acompanhe o que foi feito, o que está previsto e como a semana está avançando.</div>
      </div>
      <div class="phone-stage reveal">
        <div class="phone"><img id="product-screen" src="/landing2-assets/app-inicio.jpg" alt="Tela Minha semana do aplicativo Panzeri Run"></div>
        <div class="orbit orbit-a"></div><div class="orbit orbit-b"></div>
      </div>
    </section>

    <section class="flow" id="como-funciona" data-track-view="flow_view">
      <div class="section-heading reveal"><span class="eyebrow">COMO FUNCIONA</span><h2>Um ciclo que aprende com o que acontece de verdade.</h2></div>
      <ol class="flow-list">
        <li class="reveal"><span>01</span><div><h3>Conhecemos você</h3><p>Objetivo, experiência, rotina, disponibilidade e informações relevantes para começar.</p></div></li>
        <li class="reveal"><span>02</span><div><h3>Planejamos sua semana</h3><p>As atividades são organizadas de acordo com o seu momento e aquilo que deseja construir.</p></div></li>
        <li class="reveal"><span>03</span><div><h3>Você treina e registra</h3><p>O aplicativo reúne execução, volume, ritmo e outras métricas disponíveis.</p></div></li>
        <li class="reveal"><span>04</span><div><h3>Você completa a história</h3><p>Queremos saber realmente como você está. Esforço, dor, dificuldade, sono, disposição e emoções revelam aquilo que nenhum gráfico consegue explicar sozinho.</p></div></li>
        <li class="reveal"><span>05</span><div><h3>Seu contexto fica mais completo</h3><p>A evolução deixa de ser uma lembrança vaga e passa a fazer parte da análise dos próximos passos.</p></div></li>
      </ol>
    </section>

    <section class="feedback section-light">
      <div class="feedback-visual reveal"><div class="phone phone-small"><img src="/landing2-assets/app-ritmo.jpg" alt="Gráficos reais de ritmo do aplicativo Panzeri Run"></div></div>
      <div class="feedback-copy reveal"><span class="eyebrow">DADOS + EXPERIÊNCIA HUMANA</span><h2>Os números mostram parte do treino. Você completa a história.</h2><p>Velocidade, distância, frequência cardíaca e cadência são importantes. Mas nunca superam aquilo de mais humano: como você se sentiu. É dessa união que nasce uma orientação verdadeiramente individualizada.</p><div class="signal-grid"><span>Ritmo</span><span>Distância</span><span>Frequência cardíaca</span><span>Cadência</span><span>Sono e descanso</span><span>Prontidão emocional</span><span>Esforço percebido</span><span>Dor relatada</span></div></div>
    </section>

    <section class="progression" data-track-view="progression_view">
      <div class="section-heading reveal"><span class="eyebrow">SUA EVOLUÇÃO, SEU RITMO</span><h2>Cada conquista pode abrir caminho para a próxima.</h2><p>Não existe uma trajetória obrigatória. Você escolhe o que deseja viver; o Panzeri Run ajuda a organizar o processo.</p></div>
      <div class="progress-track reveal">
        <article><span>01</span><strong>Começar</strong><p>Criar uma rotina possível.</p></article>
        <article><span>02</span><strong>Ganhar confiança</strong><p>Entender como seu corpo responde.</p></article>
        <article><span>03</span><strong>Participar</strong><p>Viver uma prova ou correr com alguém.</p></article>
        <article><span>04</span><strong>Escolher de novo</strong><p>Manter, melhorar ou buscar outro desafio.</p></article>
      </div>
      <small class="progress-disclaimer">Progressão meramente ilustrativa. Seus objetivos e condições definem o caminho.</small>
      <div class="testimonial-phones" aria-label="Conquistas reais de alunos" style="margin-top:55px">
        ${testimonialPhone('testemunho-06-resultado-prova.jpg', 'Resultado de prova de 5km de um aluno, 11º lugar geral', 'Resultado de prova')}
        ${testimonialPhone('testemunho-07-medalha-puerto-iguazu.jpg', 'Aluna comemorando 21km completados em Puerto Iguazú', '"Fiz os 21km em 2h27"')}
      </div>
    </section>

    <section class="method">
      <div class="method-image reveal"><img src="/landing2-assets/treino-elton.jpg" alt="Elton Panzeri em um treino de corrida"></div>
      <div class="method-copy reveal"><span class="eyebrow">METODOLOGIA PANZERI</span><h2>A ciência do esporte aplicada à sua vida.</h2><p class="method-quote">"É a metodologia desenvolvida por Elton Panzeri, transformada em uma prescrição inteligente para cada corredor."</p><p>Formado em Educação Física pela UFMG e pós-graduado em Terapia Cognitivo-Comportamental, Neurociência do Comportamento, Psicologia Positiva e Coaching, Elton Panzeri desenvolveu uma metodologia que usa a ciência do comportamento para aplicar a ciência do esporte à vida real.</p><p>A tecnologia potencializa a leitura dos sinais que seu corpo oferece. A metodologia determina como transformar esses dados em decisões de treinamento.</p><div class="credentials"><span>Educação Física • UFMG</span><span>Terapia Cognitivo-Comportamental</span><span>Neurociência do Comportamento</span><span>Psicologia Positiva e Coaching</span></div></div>
    </section>

    <section class="connections section-light" id="integracoes">
      <div class="connections-copy reveal"><span class="eyebrow">TECNOLOGIA QUE TRANSFORMA DADOS EM DECISÕES</span><h2>Seu relógio registra. O Panzeri Run entende o que fazer com isso.</h2><p>Você não precisa interpretar gráficos. O Panzeri Run usa inteligência artificial para cruzar as informações que a ciência do esporte considera importantes e transformá-las na prescrição que você precisa para buscar resultados com mais segurança.</p></div>
      <div class="connections-card brand-cloud reveal" aria-label="Marcas e serviços compatíveis">
        <strong>POLAR</strong><strong>STRAVA</strong><strong>HEALTH CONNECT</strong><strong>SAMSUNG</strong><strong>GARMIN</strong><strong>COROS</strong><strong>ZEPP · AMAZFIT</strong><strong>WAHOO</strong>
        <small>Os dados coletados dependem das informações que cada marca autoriza acessar e da permissão concedida pelo aluno.</small>
      </div>
    </section>

    <section class="stories section-light" id="historias" data-track-view="stories_view">
      <div class="section-heading reveal"><span class="eyebrow">QUEM JÁ COMEÇOU</span><h2>Histórias reais. Conquistas que importam.</h2><p>Relatos espontâneos de pessoas que estão usando o Panzeri Run e construindo uma relação mais confiante com a corrida.</p></div>
      <div class="testimonial-phones" aria-label="Depoimentos reais de alunos do Panzeri Run">
        ${testimonialPhone('testemunho-02-consultoria-humanizada.jpg', 'Aluna elogiando a consultoria humanizada e falando sobre planejar uma meia maratona', '"Apareceu sua consultoria muito humanizada"')}
        ${testimonialPhone('testemunho-08-avaliacao-thais.jpg', 'Aluna se oferecendo para avaliar o aplicativo com 5 estrelas', '"A indicação é sempre a melhor propaganda"')}
        ${testimonialPhone('testemunho-09-atualizacao-luiza.jpg', 'Aluna elogiando as atualizações constantes do aplicativo', '"Cada dia que entro uma atualização nova"')}
      </div>
      <p class="privacy-note">Depoimentos reais. Nomes, telefones e imagens de perfil foram removidos para preservar a privacidade.</p>
      <div class="video-grid" aria-label="Depoimentos em vídeo de alunos">
        ${videoCard('depoimento-video-01.mp4', 'Depoimento em vídeo')}
        ${videoCard('depoimento-video-02.mp4', 'Depoimento em vídeo')}
        ${videoCard('depoimento-video-03.mp4', 'Depoimento em vídeo')}
        ${videoCard('depoimento-video-04.mp4', 'Depoimento em vídeo')}
        ${videoCard('depoimento-video-05.mp4', 'Depoimento em vídeo')}
        ${videoCard('depoimento-video-06.mp4', 'Depoimento em vídeo')}
      </div>
    </section>

    <section class="pricing" id="assinar" data-track-view="pricing_view">
      <div class="price-copy reveal"><span class="eyebrow">COMECE NO SEU RITMO</span><h2>Corra com mais saúde. Evolua com confiança. Inspire quem está ao seu lado.</h2><p>Começar a correr também é encontrar pessoas, reconhecer a própria capacidade e se tornar um exemplo positivo para quem precisa dar o primeiro passo.</p><div class="benefit-list"><span>Comece a correr com os amigos</span><span>Melhore sua saúde</span><span>Aprenda a confiar em si</span><span>Seja um exemplo positivo</span></div></div>
      <article class="price-card reveal"><span class="plan-label">PANZERI RUN</span><div class="price"><small>R$</small><strong>${priceNumber}</strong><span>/mês</span></div><p>Tudo o que sustenta uma evolução possível, segura e verdadeiramente sua.</p><ul><li>Treinos com segurança</li><li>Evolução dentro do que você é capaz</li><li>Treinamento individualizado</li><li>Acompanhamento da evolução</li><li>Feedback após os treinos</li><li>Histórico organizado</li><li>Metodologia Elton Panzeri</li></ul>
      ${storeButtons(false)}
      <a class="web-link" href="${CHECKOUT_URL}" data-checkout data-track="pricing_web_click">Ou acesse pela versão web →</a>
      <small class="price-foot">Cancele quando quiser. Consulte os termos da assinatura.</small></article>
    </section>

    <section class="faq section-light">
      <div class="section-heading reveal"><span class="eyebrow">PERGUNTAS FREQUENTES</span><h2>O que você precisa saber antes de começar.</h2></div>
      <div class="faq-list">
        <details><summary>O Panzeri Run serve para iniciantes?</summary><p>Sim. O aplicativo considera experiência, rotina e objetivo para orientar pessoas acima de 18 anos em diferentes momentos da corrida.</p></details>
        <details><summary>Posso treinar para diferentes distâncias?</summary><p>O objetivo é definido pelo corredor. O planejamento pode apoiar desde os primeiros quilômetros até desafios como 5 km, 10 km, meia maratona e maratona, conforme suas condições.</p></details>
        <details><summary>Qual é a diferença para pedir um treino ao ChatGPT?</summary><p>Uma conversa genérica depende do contexto informado naquele momento. O Panzeri Run organiza seu histórico, execução, feedback e evolução dentro de um sistema criado especificamente para treinamento de corrida.</p></details>
        <details><summary>O aplicativo considera dores e dificuldades?</summary><p>Há espaço para relatar sua experiência após o treino. Essas informações complementam os dados objetivos e ajudam a formar um contexto mais completo.</p></details>
        <details><summary>Quanto custa?</summary><p>A assinatura custa ${WEB_PRICE} por mês.</p></details>
      </div>
    </section>

    <section class="final-cta"><div class="reveal"><span class="eyebrow">SUA PRÓXIMA CONQUISTA</span><h2>Você escolhe onde quer chegar.<br>O Panzeri Run ajuda a construir o caminho.</h2>
      ${storeButtons(true)}
      <a class="final-web-link" href="${CHECKOUT_URL}" data-checkout data-track="final_web_click">Acessar pela web</a>
    </div></section>
  </main>

  <footer class="footer"><a class="brand" href="#inicio"><span class="brand-mark">▥</span> PANZERI RUN</a><p>Metodologia, ciência e tecnologia a serviço da sua corrida.</p><div><span>Termos e privacidade disponíveis no fluxo de assinatura</span><a href="https://www.instagram.com/eltonpanzeripersonal/">Instagram</a></div></footer>
  <script id="landing-config" type="application/json">${config}</script>
  <script>${script}</script>
</body>
</html>`;
