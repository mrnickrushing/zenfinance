// React Native 0.81+ ships folly headers via a prebuilt ReactNativeDependencies
// xcframework that doesn't vendor folly/coro, but folly/Portability.h
// auto-detects FOLLY_HAS_COROUTINES=1 from compiler capabilities (clang +
// -std=c++20) regardless of whether the coro headers are actually present.
// That makes folly/Expected.h (and others) both #include the missing header
// AND reference folly::coro::* symbols that were never declared, breaking any
// pod that transitively pulls in Fabric/folly headers (Sentry's Session
// Replay native code, in our case, but this would eventually bite any other
// dependency that touches Fabric too).
//
// Prior attempts and why they didn't fully work:
//  1. OTHER_CPLUSPLUSFLAGS=-DFOLLY_HAS_COROUTINES=0 via Podfile post_install
//     build-settings — didn't reliably reach every pod target's actual
//     compile invocation (some pods set that same setting directly in their
//     own podspec, taking precedence).
//  2. Guarding just the folly/Expected.h #include with __has_include — fixed
//     the "file not found" for that one include site, but FOLLY_HAS_COROUTINES
//     was still 1 elsewhere, so folly::coro::* usages became undeclared
//     identifiers instead.
//
// This forces the macro itself to 0 at its source (folly/Portability.h) by
// prepending an unconditional #undef/#define pair, so every folly header
// that checks FOLLY_HAS_COROUTINES sees it consistently disabled — this is
// a plain file edit, unaffected by build-setting precedence.
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
    folly_portability_header = File.join(installer.sandbox.root, 'Headers/Public/ReactNativeDependencies/folly/Portability.h')
    if File.exist?(folly_portability_header)
      contents = File.read(folly_portability_header)
      unless contents.include?('ZENFINANCE_FOLLY_CORO_FIX')
        patched = "// ZENFINANCE_FOLLY_CORO_FIX\\n#undef FOLLY_HAS_COROUTINES\\n#define FOLLY_HAS_COROUTINES 0\\n" + contents
        File.write(folly_portability_header, patched)
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
