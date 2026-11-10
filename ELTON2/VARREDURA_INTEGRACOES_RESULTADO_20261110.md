# Varredura das integrações — resultado em 10/11/2026 (pacote do build 1.0.4)

Ordem de Elton (06/11, repetida em 10/11): pegar TODOS os dados de treino e de saúde de cada integração, exceto o que está bloqueado por decisão (GPS adiado; o que o Google mandou retirar do Health Connect; Strava na IA; texto de consentimento da Zepp). Base: relatório do Astra (09/11) + leitura do código. Este arquivo diz o que ENTROU e o que FICOU de fora, com o motivo.

## Entrou (commits locais, valem no Deploy da API e/ou no build 1.0.4)
| Integração | O que passou a ser lido | Onde |
|---|---|---|
| Garmin | voltas, os 3 tempos (relógio, cronômetro, em movimento), temperatura, GPS (autorização "Percurso GPS"), arquivo FIT (voltas com métricas e dinâmica de corrida em média) | commits `19935b9`, `f32d9e5` |
| Apple Saúde | séries do treino ao longo do tempo (FC, velocidade, potência, cadência, distância); pressão, glicemia, ciclo e temperatura basal para a IA (com o grupo marcado) | `025d989`, `17ca180`, `f5797f3` |
| Polar | campos do Nightly Recharge antes descartados: ANS charge, seu status, status do Nightly Recharge, FC média e intervalo médio entre batimentos da noite (no grupo "HRV" já autorizado; chegam à IA com o Atlas) | commit desta data |

## Ficou de fora, com o motivo (nenhum item foi esquecido: cada um precisa de algo que eu não tenho aqui)
- **Polar — FC contínua, cardio load, SleepWise, Elixir:** são endpoints novos da API da Polar. Não vi a resposta real deles (sem conta/alunas com esses dados) e a autorização da aluna (texto de consentimento da Polar) hoje não descreve esses grupos: implementar às cegas arrisca gravar dado errado. Próximo passo: rodar a sonda da Polar (`polar-probe`) com uma aluna e então mapear.
- **Health Connect — séries do treino, voltas, segmentos:** cada permissão do Android precisa de função visível na tela (regra do Google, que recusou a v15). Séries de FC/velocidade/potência já têm permissão; a leitura detalhada exige código nativo Android e teste em aparelho que eu não tenho. Fica para depois do build, com a primeira aluna Android.
- **Wahoo — FIT e envio de planos:** exige o fluxo de arquivo FIT da Wahoo e contrato de envio; sem alunas conectadas para validar.
- **COROS — estresse, recuperação, avaliação física, carga, wellness:** estão no MCP da COROS, mas a integração ainda não foi validada ao vivo (pendência registrada em 30/10); ampliar antes disso multiplica o risco.
- **Zepp — voltas no FIT e backfill de saúde:** a decisão de 30/10 é NÃO mexer no que muda texto de consentimento; voltas no FIT não mudam o texto e podem entrar, mas dependem de um arquivo FIT real da Zepp para conferir os campos.
- **Apple Saúde — passada, contato com o solo e oscilação vertical por segundo:** hoje só média do treino (não há coluna por segundo).
- **Suunto, Google Health (Fitbit), WHOOP, Oura, Withings (conectores novos):** fora do pedido ("integrações já criadas"); Oura/WHOOP/Withings têm restrições contratuais de IA.

## Riscos de política (do Astra) que continuam abertos
Garmin (Rev H) e o uso do Atlas; Strava; Oura/WHOOP/Withings. Conferir contrato antes de ligar qualquer um.
