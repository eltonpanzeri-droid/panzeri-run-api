# Panzeri Run para Wear OS (Galaxy Watch, Pixel Watch e outros)

Fase 2 (17/11/2026): pareia por código e mostra os treinos da semana, guardados no relógio (funciona sem internet).

Fase 3, parte 1 (17/11/2026): **gravar a corrida** pelo Health Services (frequência cardíaca, distância, pace e GPS), com pausar/retomar/encerrar, serviço em primeiro plano e atividade em andamento no mostrador. As permissões (GPS, sensores, reconhecimento de atividade) só são pedidas ao tocar em "Iniciar corrida"; não há localização em segundo plano. O treino encerrado fica guardado no relógio (pasta `files/workouts/pending`, privada do app); **o envio ao Panzeri Run, a autorização da aluna e o recebimento no servidor ainda não existem** (próxima parte). Publicação (fase 4) vem depois.

- Kotlin + Compose para Wear OS. `applicationId = com.panzerirun.app` (mesma ficha do app do celular na Play). `minSdk 30`.
- Pareamento: o relógio pede um código (`POST /wear/pairing/start`), a aluna digita no Panzeri Run (Dispositivos e integrações > Samsung) e o relógio recebe uma credencial só de leitura (`/wear/pairing/poll`, uma vez). Semana: `GET /wear/week`.
- A credencial fica no Android Keystore. Se o armazenamento seguro falhar, ela fica só na memória (nunca em arquivo comum).

## Compilar e testar (Windows, sem Android Studio)
Pré-requisitos: JDK 17 e Android SDK (`ANDROID_HOME`). Crie `local.properties` com `sdk.dir=...` se precisar.

```
.\gradlew.bat testDebugUnitTest assembleDebug
```

Emulador de relógio (imagem `system-images;android-34;android-wear;x86_64`, AVD `wear5`) e servidor de teste sem banco:

```
node tools/mock-server.js                       # http://localhost:8787 (no emulador: http://10.0.2.2:8787)
.\gradlew.bat assembleDebug -Pwear.apiUrl=http://10.0.2.2:8787
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

A variante `debug` aceita HTTP (só para esse servidor de teste); a `release` fala só HTTPS com o servidor de produção. Nunca aponte o teste para o banco de produção.

Teste da gravação no emulador (dados sintéticos do Health Services): `adb shell am broadcast -a whs.USE_SYNTHETIC_PROVIDERS com.google.android.wearable.healthservices` e, com a corrida iniciada, `adb shell am broadcast -a whs.synthetic.user.START_RUNNING com.google.android.wearable.healthservices`.
