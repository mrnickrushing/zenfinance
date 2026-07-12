// React Native 0.81+ ships folly headers via a prebuilt ReactNativeDependencies
// xcframework that doesn't vendor folly/coro — but folly/Expected.h still
// #includes folly/coro/Coroutine.h unless FOLLY_HAS_COROUTINES=0 is defined,
// so any pod that transitively pulls in Fabric/folly headers (Sentry's
// Session Replay native code, in our case) fails to compile. This patches
// the generated Podfile's post_install hook to define that flag for every
// pod target. Expo apps regenerate ios/ on every prebuild, so this has to be
// a config plugin rather than a one-off Podfile edit.
const { withPodfile } = require('expo/config-plugins');

const FLAG = '-DFOLLY_HAS_COROUTINES=0';

module.exports = function withFollyCoroutineFix(config) {
  return withPodfile(config, (config) => {
    const contents = config.modResults.contents;
    if (contents.includes(FLAG)) {
      return config;
    }

    const injection = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        cflags = build_config.build_settings['OTHER_CPLUSPLUSFLAGS'] || ['$(inherited)']
        cflags = [cflags] unless cflags.is_a?(Array)
        cflags << '${FLAG}'
        build_config.build_settings['OTHER_CPLUSPLUSFLAGS'] = cflags
      end
    end
`;

    const marker = 'post_install do |installer|';
    if (contents.includes(marker)) {
      config.modResults.contents = contents.replace(marker, marker + injection);
    } else {
      config.modResults.contents = `${contents}\npost_install do |installer|${injection}end\n`;
    }
    return config;
  });
};
