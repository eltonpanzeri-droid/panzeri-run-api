// Politica de Privacidade do Panzeri Run para as lojas (Apple App Store / Google Play): pagina /politica-de-privacidade-panzeri-run/.
// RASCUNHO PARA APROVACAO (11/10/2026) — nao publicar sem a aprovacao do Elton. Reaproveita as MESMAS frases da fonte canonica (legal-content.ts)
// onde o assunto e' o mesmo e acrescenta o que ela ainda nao cobre: Apple Saude (HealthKit), agendamento no Apple Watch (WorkoutKit) e Health Connect.
// Regra editorial (a mesma de legal-content.ts): descreve o que o sistema FAZ, conferido no codigo; nao inventa prazo, garantia, contato nem base legal.

import {
  AI_PARAGRAPHS, BACKUP_PARAGRAPHS, DATA_CATEGORIES, DELETE_PARAGRAPHS, DISCONNECT_PARAGRAPH, LEGAL_CONTACT, LegalSection, RAW_AND_DERIVED, STRAVA_PARAGRAPH,
  THIRD_PARTIES, WAHOO_PARAGRAPH,
} from './legal-content';

export const PRIVACY_STORE_PATH = '/politica-de-privacidade-panzeri-run';
export const PRIVACY_STORE_UPDATED_LABEL = '11 de outubro de 2026';

export const PRIVACY_STORE_SECTIONS: LegalSection[] = [
  {
    id: 'quem-somos',
    heading: '1. Quem é o responsável',
    paragraphs: [
      'Elton Panzeri é o responsável pelo Panzeri Run e o controlador dos dados pessoais tratados pelo aplicativo (versões para iPhone, Android e navegador).',
      `Contato para qualquer assunto de privacidade: ${LEGAL_CONTACT}.`,
    ],
  },
  { id: 'dados', heading: '2. Dados que tratamos', paragraphs: ['Dados fornecidos por você ou gerados pelo uso do aplicativo:', ...DATA_CATEGORIES, 'Dados de pagamento são processados pelo Asaas ou pela loja de aplicativos; não armazenamos dados de cartão.'] },
  {
    id: 'apple-saude',
    heading: '3. Apple Saúde (HealthKit) — iPhone',
    paragraphs: [
      'Esta seção vale somente para o aplicativo do Panzeri Run instalado no iPhone. Ela não se aplica ao uso pelo navegador nem ao aplicativo Android.',
      'Permissão: o Panzeri Run só acessa o app Saúde se você autorizar, na janela de permissão do próprio iOS. Pedimos apenas permissão de leitura. Não pedimos permissão para gravar e não gravamos nenhum dado no app Saúde. Você pode retirar a autorização a qualquer momento em Ajustes do iPhone > Saúde > Acesso a dados e dispositivos > Panzeri Run.',
      'O que lemos: seus treinos de corrida registrados no app Saúde (até os 20 mais recentes de cada leitura) e, de cada um, a distância percorrida. Dos treinos recebemos: identificador do treino, tipo de atividade, início, fim, duração, distância, se foi em ambiente fechado, fuso horário e o nome do aplicativo e do dispositivo que registraram o treino. Não lemos frequência cardíaca, rota (GPS), sono, passos, calorias, peso, nutrição nem outros dados do app Saúde.',
      'Quando os dados saem do seu aparelho: a leitura acontece no próprio iPhone. Os treinos só são enviados ao Panzeri Run quando você aciona a importação, na área Dispositivos e integrações do aplicativo. Não há envio automático em segundo plano.',
      'Como usamos: os treinos importados são tratados como as atividades vindas de outros serviços conectados, descritas na seção 5: para mostrar a atividade, comparar o que foi prescrito com o que foi realizado, acompanhar sua evolução e personalizar seu treinamento. Resumos derivados dessas atividades podem fazer parte do contexto enviado à inteligência artificial, conforme a seção 7.',
      'O que não fazemos: não usamos dados do Apple Saúde para publicidade ou marketing, não os enviamos à Meta e não os compartilhamos para fins de propaganda.',
      'Apagar: não há, hoje, um botão no aplicativo para apagar somente os dados importados do Apple Saúde. Você pode pedir a exclusão deles pelo contato indicado na seção 13 ou excluir a conta inteira, no próprio aplicativo, como descrito na seção 13.',
    ],
  },
  {
    id: 'apple-watch',
    heading: '4. Envio de treinos ao Apple Watch (WorkoutKit) — iPhone',
    paragraphs: [
      'Em treinos prescritos que o aplicativo consegue representar fielmente no Apple Watch, aparece o botão "Enviar ao Apple Watch". O envio só acontece quando você toca nele.',
      'Para isso, o iOS pede uma autorização própria para agendar treinos. Com ela, o Panzeri Run entrega ao seu iPhone e ao seu Apple Watch o treino prescrito (a estrutura da sessão, como partes e distâncias) e o dia em que ele deve aparecer. Agendar um treino não significa que ele foi executado.',
      'No servidor do Panzeri Run guardamos o registro dessa entrega (qual treino foi enviado, quando e com qual resultado), para não duplicar o envio. Este recurso não grava dados no app Saúde.',
    ],
  },
  {
    id: 'health-connect',
    heading: '5. Health Connect — Android, e outros serviços conectados',
    paragraphs: [
      'Health Connect (aplicativo Android): se você autorizar, o Panzeri Run lê do Health Connect as sessões de exercício, a distância e a frequência cardíaca durante cada sessão (somente leitura). De cada sessão recebemos: tipo de atividade, início, fim e duração, distância, frequência cardíaca média e máxima daquele treino, o aplicativo que gravou o registro, o dispositivo (quando o aplicativo informa) e o método de gravação. Não lemos rota (GPS), sono, passos isolados, calorias, peso nem nutrição, e não gravamos nada no Health Connect. O Panzeri Run sincroniza ao abrir o aplicativo e quando você toca em "Sincronizar agora"; não sincroniza continuamente em segundo plano. Ao desconectar, novas leituras são interrompidas, mas o histórico já importado não é apagado automaticamente. Você também pode revogar as permissões nos ajustes do Android.',
      'Polar, Strava e Wahoo: você pode autorizar esses serviços a compartilhar suas atividades com o Panzeri Run. Dependendo do serviço e das permissões concedidas, podem ser recebidos data e horário, duração, distância, modalidade, ritmo, frequência cardíaca, cadência, potência, elevação, calorias, rota (GPS) quando o serviço a disponibiliza e amostras ao longo da atividade. Nem todo serviço fornece todos esses dados, e dados vindos de dispositivos podem conter erros ou limitações.',
      ...RAW_AND_DERIVED,
      STRAVA_PARAGRAPH,
      WAHOO_PARAGRAPH,
    ],
  },
  {
    id: 'finalidades',
    heading: '6. Para que usamos',
    paragraphs: ['Personalizar a prescrição de treinos; acompanhar evolução e segurança do aluno; processar pagamento da assinatura; comunicação sobre o serviço (e-mail, notificações).'],
  },
  { id: 'ia', heading: '7. Inteligência artificial', paragraphs: AI_PARAGRAPHS },
  { id: 'terceiros', heading: '8. Compartilhamento e serviços de terceiros', paragraphs: ['O Panzeri Run usa os seguintes serviços externos, cada um para a finalidade indicada:', ...THIRD_PARTIES] },
  { id: 'desconexao', heading: '9. Desconectar um serviço e excluir os dados importados', paragraphs: [DISCONNECT_PARAGRAPH, ...DELETE_PARAGRAPHS] },
  { id: 'backup', heading: '10. Cópias de segurança', paragraphs: BACKUP_PARAGRAPHS },
  {
    id: 'retencao',
    heading: '11. Retenção',
    paragraphs: ['Os dados são mantidos enquanto a conta estiver ativa e pelo prazo necessário para cumprimento de obrigações legais após o encerramento. As cópias de segurança seguem o descrito na seção 10.'],
  },
  {
    id: 'direitos',
    heading: '12. Seus direitos',
    paragraphs: ['Acesso, correção, exclusão, portabilidade e revogação do consentimento a qualquer momento, mediante solicitação ao contato abaixo. Parte do controle já pode ser exercida no aplicativo, na área Privacidade e dados.'],
  },
  {
    id: 'exclusao-conta',
    heading: '13. Como excluir sua conta e seus dados',
    paragraphs: [
      'Pelo aplicativo: abra Privacidade e dados > Excluir minha conta. Para confirmar, o aplicativo pede a sua senha atual e que você digite EXCLUIR CONTA. A exclusão é definitiva: não é possível recuperar a conta nem os dados depois dela.',
      'Assinatura e cobranças: excluir a conta NÃO cancela automaticamente cobranças feitas fora do Panzeri Run. Antes de excluir, o aplicativo mostra a situação da sua assinatura e não impede a exclusão por causa dela. Se a assinatura for pelo Asaas, o aplicativo também informa se já existem cobranças emitidas pendentes ou vencidas. Segundo a documentação do Asaas, cancelar (remover) a assinatura também remove as cobranças pendentes e vencidas ligadas a ela, e cobranças já pagas permanecem registradas e não são devolvidas; essa regra é do Asaas, não do Panzeri Run. Você pode escolher cancelar a assinatura junto com a exclusão, a seu pedido, ou excluir a conta sem cancelar; nesse caso as cobranças já emitidas continuam válidas, novas cobranças podem continuar sendo geradas até que a assinatura seja cancelada, e o responsável pelo Panzeri Run é avisado para poder tratar o caso. Para excluir sem cancelar, o aplicativo pede uma confirmação específica de que você entende isso. Se a assinatura for pela loja de aplicativos (Google Play), somente você pode cancelá-la, nas configurações da própria loja, e o aplicativo mostra como. Se, mesmo assim, uma cobrança chegar depois da exclusão, ela é registrada apenas como registro financeiro, sem identificação, e a conta não é reativada.',
      `Por e-mail: se preferir, envie uma mensagem para ${LEGAL_CONTACT}, do mesmo endereço cadastrado no Panzeri Run, com o assunto "Exclusão de conta". Confirmamos o pedido em até 5 dias úteis e concluímos a exclusão em até 15 dias.`,
      'O que acontece: a conta é anonimizada de forma irreversível. Nome, e-mail, CPF, telefone, endereço, data de nascimento e demais dados de perfil são removidos, o acesso deixa de ser possível e o e-mail poderá ser usado em um novo cadastro. São excluídos, no banco em operação, os dados de saúde e condicionamento físico, a entrevista, a rotina, os feedbacks e relatos, o registro do ciclo menstrual, o histórico de treinos prescritos e realizados, os dados importados de serviços conectados (incluindo Apple Saúde e Health Connect), as informações usadas pela inteligência artificial, as notificações, as mensagens trocadas com o treinador/agente de IA e as credenciais de acesso. Se você conectou Polar ou Wahoo, a autorização é revogada.',
      'O que permanece: registros de pagamento e de assinatura (valores, datas e identificadores do pagamento), o registro do uso de cupons e registros técnicos de auditoria, todos vinculados a um identificador técnico anônimo, sem nome, e-mail, CPF ou outros dados de identificação direta.',
      'Também guardamos, por 1 ano, um registro mínimo e criptografado da exclusão da conta (identificador interno e data), usado apenas para garantir que a exclusão seja mantida em uma eventual recuperação do banco de dados. As cópias de segurança seguem o descrito na seção 10.',
      'Fora do Panzeri Run: serviços que você usa separadamente, como o Asaas, a loja de aplicativos, a Polar, a Wahoo e o Strava, mantêm seus próprios registros, conforme as políticas deles. Mensagens e e-mails que já foram enviados não podem ser apagados por nós.',
    ],
  },
  {
    id: 'alteracoes',
    heading: '14. Alterações e versão',
    paragraphs: [`Esta é a versão de ${PRIVACY_STORE_UPDATED_LABEL}. Alterações relevantes serão comunicadas dentro do aplicativo.`],
  },
  { id: 'contato', heading: '15. Contato', paragraphs: [LEGAL_CONTACT] },
];

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderParagraphs(paragraphs: string[]): string {
  let html = '';
  let inList = false;
  for (const paragraph of paragraphs) {
    if (paragraph.startsWith('- ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${escapeHtml(paragraph.slice(2))}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${escapeHtml(paragraph)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

// Mesma identidade visual da landing (Inter, azul #071A3D, verde #00E5BB, logo do Panzeri Run).
export function renderStorePrivacyPage(): string {
  const index = PRIVACY_STORE_SECTIONS.map((section) => `<li><a href="#${section.id}">${escapeHtml(section.heading.replace(/^\d+\.\s*/, ''))}</a></li>`).join('');
  const body = PRIVACY_STORE_SECTIONS.map((section) => `<section id="${section.id}"><h2>${escapeHtml(section.heading)}</h2>${renderParagraphs(section.paragraphs)}</section>`).join('');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#071A3D">
<link rel="icon" href="/landing-assets/panzeri-run-logo.png">
<title>Política de Privacidade | Panzeri Run</title>
<meta name="description" content="Como o Panzeri Run trata seus dados pessoais e de saúde, incluindo Apple Saúde, Apple Watch e Health Connect.">
<style>
:root{--navy-950:#071A3D;--navy-900:#0D2850;--blue-700:#075BA8;--blue-100:#EAF4FF;--aqua:#00E5BB;--text-primary:#071A3D;--text-secondary:#475467;--line:#DFE8F2}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:90px}
body{margin:0;font:17px/1.65 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--text-primary);background:#fff}
a{color:var(--blue-700)}
.container{width:min(760px,calc(100% - 32px));margin:0 auto}
header{border-bottom:1px solid var(--line);background:#fff;position:sticky;top:0;z-index:10}
.header-inner{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:68px}
.brand{display:flex;align-items:center;gap:12px;color:var(--navy-950);font-weight:800;letter-spacing:.02em;text-decoration:none}
.brand img{width:40px;height:40px;border-radius:10px}
.back{display:inline-flex;align-items:center;min-height:44px;padding:0 20px;border-radius:999px;background:var(--aqua);color:var(--navy-950);font-weight:800;font-size:15px;text-decoration:none}
.back:hover{background:#00CFAA}
h1{font-size:clamp(30px,5vw,42px);line-height:1.15;letter-spacing:-.025em;font-weight:800;margin:48px 0 8px}
.meta{color:var(--text-secondary);font-size:15px;margin:0 0 32px}
.summary{background:var(--blue-100);border:1px solid var(--line);border-radius:12px;padding:20px 24px;margin:0 0 32px}
.summary h2{margin:0 0 8px;font-size:17px}
.summary ol{margin:0;padding-left:20px;columns:2;column-gap:32px;font-size:15px}
.summary li{margin:4px 0;break-inside:avoid}
h2{font-size:22px;line-height:1.3;letter-spacing:-.015em;font-weight:800;margin:40px 0 12px;padding-top:12px;border-top:1px solid var(--line)}
p,li{color:var(--text-secondary)}
ul{padding-left:22px}
footer{margin-top:64px;background:var(--navy-950);color:#fff;padding:32px 0}
footer p{color:#cdd9e8;font-size:14px;margin:6px 0}
footer a{color:#fff}
@media(max-width:640px){body{font-size:16px}.summary ol{columns:1}h2{font-size:20px}}
</style>
</head>
<body>
<header><div class="container header-inner"><a class="brand" href="/"><img src="/landing-assets/panzeri-run-logo.png" width="40" height="40" alt="">PANZERI RUN</a><a class="back" href="/">Voltar ao site</a></div></header>
<main class="container">
<h1>Política de Privacidade do Panzeri Run</h1>
<p class="meta">Versão de ${PRIVACY_STORE_UPDATED_LABEL}</p>
<nav class="summary" aria-label="Sumário"><h2>Nesta página</h2><ol>${index}</ol></nav>
${body}
</main>
<footer><div class="container"><p><a href="/termos-de-uso">Termos de Uso</a> · <a href="/politica-privacidade">Política de Privacidade (geral)</a> · <a href="mailto:${LEGAL_CONTACT}">Contato</a></p><p>© 2026 Panzeri Run. O Panzeri Run fornece orientação de treinamento físico e não substitui avaliação ou acompanhamento médico.</p></div></footer>
</body>
</html>`;
}
