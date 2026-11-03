// Landing redesign 03/11/2026 — junta o rastreamento que já existia (atribuição UTM, journeyId,
// landing_view/landing_cta_click pro Leo, dataLayer pro GA4/Meta) com o comportamento visual novo
// (abas do "aplicativo por dentro", animação de entrada ao rolar) que veio do design do ChatGPT.
export const script = `
(()=>{'use strict';
const config=JSON.parse(document.getElementById('landing-config').textContent);
window.dataLayer=window.dataLayer||[];
const trackEvent=(event,params={})=>window.dataLayer.push({event,...params});
const keys=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid'];
let attribution={};try{const saved=JSON.parse(sessionStorage.getItem('panzeri_attribution')||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))attribution=saved}catch{}
const params=new URLSearchParams(location.search);keys.forEach(key=>{const value=params.get(key);if(value)attribution[key]=value});
if(!attribution.referrer&&document.referrer){try{if(new URL(document.referrer).origin!==location.origin)attribution.referrer=document.referrer.slice(0,1000)}catch{}}
try{sessionStorage.setItem('panzeri_attribution',JSON.stringify(attribution))}catch{}
const uuid=()=>{try{return crypto.randomUUID()}catch{return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)})}};
const stableId=(kind,key)=>{try{const store=window[kind];let value=store.getItem(key);if(!value){value=uuid();store.setItem(key,value)}return value}catch{return uuid()}};
const journeyId=stableId('localStorage','panzeri_journey_id');
const sessionId=stableId('sessionStorage','panzeri_session_id');
const originFields={utm_source:'source',utm_medium:'medium',utm_campaign:'campaign',utm_content:'content',utm_term:'term',fbclid:'fbclid',gclid:'gclid',referrer:'referrer'};
const originMetadata=()=>{const meta={};Object.entries(originFields).forEach(([from,to])=>{if(attribution[from])meta[to]=String(attribution[from]).slice(0,to==='referrer'?1000:300)});return meta};
const internal=(event,key,extra)=>{try{fetch('/analytics/event',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({sessionId,journeyId,event,metadata:{...originMetadata(),...(extra||{})},dedupeKey:sessionId+':'+event+(key?':'+key:'')})}).catch(()=>{})}catch{}};

// Checkout/web: reaplica a mesma atribuição capturada na landing, igual ao botão de assinar antigo.
const webUrl=new URL(config.checkoutUrl,location.origin);Object.entries(attribution).forEach(([key,value])=>{if(keys.includes(key))webUrl.searchParams.set(key,String(value))});webUrl.searchParams.set('journey_id',journeyId);
const getCookie=(name)=>{const m=document.cookie.match('(^|;)\\s*'+name+'\\s*=\\s*([^;]*)');return m?decodeURIComponent(m[2]):null};
document.querySelectorAll('[data-checkout]').forEach(link=>{link.href=webUrl.href;link.addEventListener('click',()=>{trackEvent(link.dataset.track);trackEvent('checkout_start',{destination:'student_app'});internal('landing_cta_click',link.dataset.track,{cta:link.dataset.track});const fbp=getCookie('_fbp');const fbc=attribution.fbclid?'fb.1.'+Date.now()+'.'+attribution.fbclid:null;const url=new URL(link.href);if(fbp)url.searchParams.set('_fbp',fbp);if(fbc)url.searchParams.set('_fbc',fbc);link.href=url.href})});

// Lojas: passam pelo /ir/play e /ir/apple (contagem de clique + referrer da Play Store) antes de sair do site.
document.querySelectorAll('[data-store]').forEach(link=>{
  const dest=link.dataset.store;
  const url=new URL('/ir/'+dest,location.origin);
  keys.filter(k=>k.startsWith('utm_')).forEach(k=>{if(attribution[k])url.searchParams.set(k,String(attribution[k]))});
  link.href=url.href;
  link.addEventListener('click',()=>{trackEvent(link.dataset.track);internal('landing_cta_click',link.dataset.track,{cta:link.dataset.track})});
});

// Botões que só rolam até a seção de preço (header/hero) — ainda contam como intenção de CTA.
document.querySelectorAll('[data-scroll-cta]').forEach(link=>{link.addEventListener('click',()=>{trackEvent(link.dataset.track);internal('landing_cta_click',link.dataset.track,{cta:link.dataset.track})})});

trackEvent('landing_view');internal('landing_view');

// Topbar
const topbar=document.querySelector('.topbar');
if(topbar){const updateTopbar=()=>topbar.classList.toggle('is-scrolled',scrollY>12);updateTopbar();addEventListener('scroll',updateTopbar,{passive:true})}

// Abas "O aplicativo por dentro"
const screenData={
  inicio:{src:'/landing2-assets/app-inicio.png',alt:'Tela Minha semana do aplicativo Panzeri Run',note:'Acompanhe o que foi feito, o que está previsto e como a semana está avançando.'},
  treino:{src:'/landing2-assets/app-treino.png',alt:'Tela de treino detalhado do aplicativo Panzeri Run',note:'Veja distância, duração, ritmo e orientações organizadas para cada parte do treino.'},
  historico:{src:'/landing2-assets/app-historico.png',alt:'Histórico de treinos do aplicativo Panzeri Run',note:'Semanas, sessões realizadas e registros ficam organizados para que o contexto não dependa apenas da memória.'},
  evolucao:{src:'/landing2-assets/app-evolucao.png',alt:'Tela de evolução do aplicativo Panzeri Run',note:'Aderência, sequência, volume e histórico ajudam a mostrar como o processo está sendo construído.'},
  volume:{src:'/landing2-assets/app-volume.png',alt:'Gráfico de volume semanal do aplicativo Panzeri Run',note:'O volume semanal é acompanhado ao longo do tempo e comparado ao padrão recente do corredor.'},
  integracoes:{src:'/landing2-assets/app-integracoes.png',alt:'Tela de integrações do aplicativo Panzeri Run',note:'Conecte os serviços disponíveis e mantenha as informações do seu treinamento reunidas.'}
};
document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(t=>{t.classList.remove('active');t.setAttribute('aria-selected','false')});
  tab.classList.add('active');tab.setAttribute('aria-selected','true');
  const data=screenData[tab.dataset.screen],img=document.querySelector('#product-screen');
  img.style.opacity='0';setTimeout(()=>{img.src=data.src;img.alt=data.alt;img.style.opacity='1'},160);
  document.querySelector('#tab-note').textContent=data.note;
  trackEvent('product_tab_view',{screen:tab.dataset.screen});
}));

// Animação de entrada ao rolar
const reveal=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');reveal.unobserve(e.target)}}),{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>reveal.observe(el));

// Visualização de seção (GA4) — mesma lógica do site antigo, agora sobre as seções novas.
if('IntersectionObserver'in window){const sectionView=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return;if(entry.target.dataset.trackView)trackEvent(entry.target.dataset.trackView);sectionView.unobserve(entry.target)}),{threshold:.15});document.querySelectorAll('[data-track-view]').forEach(section=>sectionView.observe(section))}

// FAQ (abre e fecha, registra qual pergunta foi aberta)
document.querySelectorAll('.faq details').forEach(details=>details.addEventListener('toggle',()=>{if(details.open)trackEvent('faq_open',{question:details.querySelector('summary').textContent.trim()})}));

// Vídeos de depoimento: só carregam quando a pessoa clica em play (preload="none" no HTML).
document.querySelectorAll('.video-card video').forEach(video=>video.addEventListener('play',()=>{trackEvent('testimonial_video_play',{video:video.dataset.name});internal('landing_cta_click','testimonial_video_play',{cta:'testimonial_video_play',video:video.dataset.name})},{once:true}));
})();
`;
