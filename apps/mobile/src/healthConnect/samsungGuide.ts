// Passo a passo para ligar o Samsung Health / Galaxy Watch ao Health Connect (03/11/2026, decisao de Elton de 31/10: "passo a passo, dentro do app, para ligar o Health Connect no Samsung Health").
// Modulo PURO (sem React Native), so' texto: os dados da Samsung chegam ao Panzeri Run pelo Health Connect, e sem o compartilhamento ligado no Samsung Health o Health Connect fica vazio.
// ATENCAO: nao foi validado em Galaxy Watch real (Elton nao tem aparelho Samsung): os nomes dos menus seguem o que ja estava no app desde 22/10 ("Configuracoes -> Health Connect") e o aviso final diz que podem variar.

export const SAMSUNG_HEALTH_TITLE = 'Como ligar o Samsung Health ao Health Connect';

export const SAMSUNG_HEALTH_STEPS: readonly string[] = [
  'Atualize o Samsung Health e o Health Connect na Google Play. No Android 14 ou superior, o Health Connect já vem nas configurações do Android.',
  'Abra o app Samsung Health e vá em Configurações → Health Connect.',
  'Ligue o compartilhamento dos dados que você quer enviar (por exemplo exercícios, sono, passos e frequência cardíaca). Sem isso o Health Connect fica vazio.',
  'Volte aqui, escolha abaixo o que você quer compartilhar com o Panzeri Run e toque em "Permitir no Android".',
  'Toque em "Sincronizar agora". Treinos recém-gravados podem levar alguns minutos para aparecer.',
];

export const SAMSUNG_HEALTH_NOTE = 'Os nomes e a posição dos menus podem mudar conforme a versão do Samsung Health e do Android. O relógio só envia o que ele mede.';
