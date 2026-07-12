// React Native 0.81+ ships folly headers via a prebuilt ReactNativeDependencies
// xcframework that doesn't vendor folly/coro — but folly/Expected.h still
// unconditionally #includes folly/coro/Coroutine.h, so any pod that
// transitively pulls in Fabric/folly headers (Sentry's Session Replay native
// code, in our case) fails to compile with "file not found". Setting
// -DFOLLY_HAS_COROUTINES=0 via build settings didn't reliably propagate to
// every pod target's compile invocation (some pods set OTHER_CPLUSPLUSFLAGS
// in their own podspec in a way that wins over the post_install override), so
// instead this directly patches the vendored Expected.h after `pod install`
// to guard the include with __has_include — guaranteed effective regardless
// of compiler-flag precedence. Expo apps regenerate ios/ on every prebuild,
// so this has to be a config plugin rather than a one-off Podfile edit.
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
    folly_expected_header = File.join(installer.sandbox.root, 'Headers/Public/ReactNativeDependencies/folly/Expected.h')
    if File.exist?(folly_expected_header)
      contents = File.read(folly_expected_header)
      patched = contents.sub(
        '#include <folly/coro/Coroutine.h>',
        "#if __has_include(<folly/coro/Coroutine.h>)\\n#include <folly/coro/Coroutine.h>\\n#endif"
      )
      File.write(folly_expected_header, patched) if patched != contents
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
