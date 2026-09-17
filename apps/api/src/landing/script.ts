export const script = `
(()=>{'use strict';
const config=JSON.parse(document.getElementById('landing-config').textContent);
window.dataLayer=window.dataLayer||[];
const trackEvent=(event,params={})=>window.dataLayer.push({event,...params});
const keys=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid'];
let attribution={};try{const saved=JSON.parse(sessionStorage.getItem('panzeri_attribution')||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))attribution=saved}catch{}
const params=new URLSearchParams(location.search);keys.forEach(key=>{const value=params.get(key);if(value)attribution[key]=value});
try{sessionStorage.setItem('panzeri_attribution',JSON.stringify(attribution))}catch{}
const checkout=new URL(config.checkoutUrl,location.origin);Object.entries(attribution).forEach(([key,value])=>{if(keys.includes(key))checkout.searchParams.set(key,String(value))});
const getCookie=(name)=>{const m=document.cookie.match('(^|;)\\s*'+name+'\\s*=\\s*([^;]*)');return m?decodeURIComponent(m[2]):null};
document.querySelectorAll('[data-checkout]').forEach(link=>{link.href=checkout.href;link.addEventListener('click',()=>{trackEvent(link.dataset.track);trackEvent('checkout_start',{destination:'student_app'});const fbp=getCookie('_fbp');const fbc=attribution.fbclid?'fb.1.'+Date.now()+'.'+attribution.fbclid:null;const url=new URL(link.href);if(fbp)url.searchParams.set('_fbp',fbp);if(fbc)url.searchParams.set('_fbc',fbc);link.href=url.href})});
trackEvent('landing_view');
const header=document.getElementById('siteHeader');const updateHeader=()=>header.classList.toggle('is-scrolled',scrollY>12);updateHeader();addEventListener('scroll',updateHeader,{passive:true});
const menu=document.getElementById('mobileMenu'),toggle=document.getElementById('menuToggle');
const closeMenu=()=>{menu.hidden=true;toggle.setAttribute('aria-expanded','false')};
toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')==='true';menu.hidden=open;toggle.setAttribute('aria-expanded',String(!open))});
document.querySelectorAll('nav a').forEach(link=>link.addEventListener('click',()=>{trackEvent('navigation_click',{target:link.getAttribute('href')});closeMenu()}));
document.querySelectorAll('.faq-trigger').forEach(button=>button.addEventListener('click',()=>{const open=button.getAttribute('aria-expanded')==='true';button.setAttribute('aria-expanded',String(!open));document.getElementById(button.getAttribute('aria-controls')).hidden=open;button.querySelector('span').textContent=open?'+':'−';if(!open)trackEvent('faq_open',{question:button.textContent.trim()})}));
const expand=document.getElementById('expandResults');expand.addEventListener('click',()=>{const open=expand.getAttribute('aria-expanded')==='true';document.querySelectorAll('[data-extra-result]').forEach(card=>card.hidden=open);expand.setAttribute('aria-expanded',String(!open));expand.textContent=open?'VER MAIS RESULTADOS':'VER MENOS';trackEvent('results_expand',{expanded:!open})});
const dialog=document.getElementById('resultLightbox'),image=document.getElementById('lightboxImage'),caption=document.getElementById('lightboxCaption');let index=0,opener=null,touchX=null;
const show=(next)=>{index=(next+config.results.length)%config.results.length;const result=config.results[index];image.src=result.image;image.alt='Depoimento completo: '+result.title;image.width=result.width;image.height=result.height;caption.textContent=(index+1)+' / '+config.results.length+' · '+result.category;trackEvent('result_open',{id:result.id})};
document.querySelectorAll('[data-result-index]').forEach(button=>button.addEventListener('click',()=>{opener=button;show(Number(button.dataset.resultIndex));dialog.showModal();document.body.classList.add('modal-open')}));
document.getElementById('closeLightbox').addEventListener('click',()=>dialog.close());document.getElementById('previousResult').addEventListener('click',()=>show(index-1));document.getElementById('nextResult').addEventListener('click',()=>show(index+1));
dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()});
dialog.addEventListener('close',()=>{document.body.classList.remove('modal-open');if(opener)opener.focus({preventScroll:true})});
addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){closeMenu();toggle.focus()}if(!dialog.open)return;if(event.key==='ArrowLeft'){event.preventDefault();show(index-1)}if(event.key==='ArrowRight'){event.preventDefault();show(index+1)}});
image.addEventListener('touchstart',event=>{touchX=event.changedTouches[0].clientX},{passive:true});image.addEventListener('touchend',event=>{if(touchX===null)return;const dx=event.changedTouches[0].clientX-touchX;if(Math.abs(dx)>50)show(index+(dx<0?1:-1));touchX=null},{passive:true});
if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return;trackEvent(entry.target.dataset.trackView);observer.unobserve(entry.target)}),{threshold:.15});document.querySelectorAll('[data-track-view]').forEach(section=>observer.observe(section))}
})();
`;
