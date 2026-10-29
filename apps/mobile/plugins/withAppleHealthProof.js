// Config plugin do Bloco 1 (prova HealthKit + WorkoutKit). Atua SOMENTE no projeto iOS: Android nao e' tocado.
//  - entitlement com.apple.developer.healthkit (o EAS sincroniza a capability HealthKit no App ID);
//  - NSHealthShareUsageDescription (so' leitura; nada e' escrito no app Saude, entao nao ha NSHealthUpdateUsageDescription);
//  - iOS 17.0 como versao minima (WorkoutKit/WorkoutScheduler e HKWorkout.workoutPlan exigem iOS 17).
const { withEntitlementsPlist, withInfoPlist, withPodfileProperties, withXcodeProject } = require('expo/config-plugins');

const IOS_DEPLOYMENT_TARGET = '17.0';
const HEALTH_SHARE_TEXT =
  'O Panzeri Run le os dados do app Saude que voce autorizar: seus treinos (de qualquer tipo) com as medidas guardadas junto e o percurso, e sua saude do dia a dia - atividade, sono, frequencia cardiaca, variabilidade da frequencia cardiaca, VO2 maximo, peso e composicao corporal, oxigenacao, temperatura, respiracao, mobilidade, habitos, nutricao, pressao arterial, glicemia e ciclo menstrual. Voce escolhe o que compartilhar, e os dados que autorizar sao enviados ao Panzeri Run para acompanhar sua evolucao e personalizar o seu treino.';

const HEALTH_UPDATE_TEXT =
  'O Panzeri Run nao grava registros de saude no app Saude. A Apple exige esta declaracao porque o app usa o HealthKit e pode, somente com a sua autorizacao, agendar no Apple Watch um treino planejado do seu programa de treino.';

module.exports = function withAppleHealthProof(config) {
  config = withEntitlementsPlist(config, (c) => {
    c.modResults['com.apple.developer.healthkit'] = true;
    return c;
  });

  config = withInfoPlist(config, (c) => {
    c.modResults.NSHealthShareUsageDescription = c.modResults.NSHealthShareUsageDescription || HEALTH_SHARE_TEXT;
    // A Apple (erro 90683) exige a chave quando o app usa HealthKit/WorkoutKit, mesmo sem gravar registros no Saude. O texto diz a verdade: nao grava.
    c.modResults.NSHealthUpdateUsageDescription = c.modResults.NSHealthUpdateUsageDescription || HEALTH_UPDATE_TEXT;
    return c;
  });

  config = withPodfileProperties(config, (c) => {
    c.modResults['ios.deploymentTarget'] = IOS_DEPLOYMENT_TARGET;
    return c;
  });

  config = withXcodeProject(config, (c) => {
    const configurations = c.modResults.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const buildSettings = configurations[key] && configurations[key].buildSettings;
      if (buildSettings && buildSettings.IPHONEOS_DEPLOYMENT_TARGET) {
        buildSettings.IPHONEOS_DEPLOYMENT_TARGET = IOS_DEPLOYMENT_TARGET;
      }
    }
    return c;
  });

  return config;
};
