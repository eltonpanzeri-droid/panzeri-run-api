// Config plugin do Bloco 1 (prova HealthKit + WorkoutKit). Atua SOMENTE no projeto iOS: Android nao e' tocado.
//  - entitlement com.apple.developer.healthkit (o EAS sincroniza a capability HealthKit no App ID);
//  - NSHealthShareUsageDescription (so' leitura; nada e' escrito no app Saude, entao nao ha NSHealthUpdateUsageDescription);
//  - iOS 17.0 como versao minima (WorkoutKit/WorkoutScheduler e HKWorkout.workoutPlan exigem iOS 17).
const { withEntitlementsPlist, withInfoPlist, withPodfileProperties, withXcodeProject } = require('expo/config-plugins');

const IOS_DEPLOYMENT_TARGET = '17.0';
const HEALTH_SHARE_TEXT =
  'O Panzeri Run le seus treinos de corrida do app Saude (inicio, fim, duracao e distancia). Os dados de treino que voce autorizar podem ser enviados ao Panzeri Run para sincronizacao e acompanhamento do seu treino.';

module.exports = function withAppleHealthProof(config) {
  config = withEntitlementsPlist(config, (c) => {
    c.modResults['com.apple.developer.healthkit'] = true;
    return c;
  });

  config = withInfoPlist(config, (c) => {
    c.modResults.NSHealthShareUsageDescription = c.modResults.NSHealthShareUsageDescription || HEALTH_SHARE_TEXT;
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
