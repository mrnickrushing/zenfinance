// React Native 0.81+'s prebuilt ReactNativeDependencies xcframework doesn't
// vendor folly/coro headers, but folly/Expected.h still checks
// `#if FOLLY_HAS_COROUTINES` before including folly/coro/Coroutine.h and
// auto-detects that as 1 from compiler capabilities. Folly's own
// Portability.h treats FOLLY_CFG_NO_COROUTINES as the user-facing override
// that suppresses that auto-detection — this is the flag the community has
// confirmed actually works (see facebook/react-native#53575), and it needs
// to go on GCC_PREPROCESSOR_DEFINITIONS (which CocoaPods/Xcode reliably
// merges across every pod's own xcconfig) rather than OTHER_CPLUSPLUSFLAGS
// (which some pods set directly in their own podspec, silently overriding
// whatever a Podfile post_install hook sets there).
//
// Earlier attempts got this wrong in two ways: used FOLLY_HAS_COROUTINES
// instead of FOLLY_CFG_NO_COROUTINES, and used OTHER_CPLUSPLUSFLAGS instead
// of GCC_PREPROCESSOR_DEFINITIONS. Expo apps regenerate ios/ on every
// prebuild, so this has to be a config plugin rather than a one-off Podfile
// edit.
const { withPodfile } = require('expo/config-plugins');

const MARKER = '__ZENFINANCE_FOLLY_CORO_FIX__';

module.exports = function withFollyCoroutineFix(config) {
  return withPodfile(config, (config) => {
    const contents = config.modResults.contents;
    if (contents.includes(MARKER)) {
      return config;
    }

    const injection = `
    # ${MARKER}
    # https://github.com/facebook/react-native/issues/53575
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        defs = build_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
        defs = [defs] unless defs.is_a?(Array)
        defs << 'FOLLY_CFG_NO_COROUTINES=1'
        build_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs
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
