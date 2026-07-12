// React Native 0.81+ ships folly headers via a prebuilt ReactNativeDependencies
// xcframework that doesn't vendor folly/coro, but folly/Portability.h
// auto-detects FOLLY_HAS_COROUTINES=1 from compiler capabilities (clang +
// -std=c++20) regardless of whether the coro headers are actually present.
// That makes folly headers (Expected.h, and potentially others) both
// #include the missing folly/coro/*.h files AND reference folly::coro::*
// symbols that were never declared, breaking any pod that transitively pulls
// in Fabric/folly headers (Sentry's Session Replay native code, in our case,
// but this would eventually bite any other dependency that touches Fabric).
//
// Prior attempts and why each only solved half the problem:
//  1. OTHER_CPLUSPLUSFLAGS=-DFOLLY_HAS_COROUTINES=0 via Podfile post_install
//     build-settings — didn't reliably reach every pod target's actual
//     compile invocation (some pods set that same setting directly in their
//     own podspec, taking precedence).
//  2. Guarding just folly/Expected.h's #include with __has_include — fixed
//     "file not found" for that one include site, but FOLLY_HAS_COROUTINES
//     was still 1 elsewhere, so folly::coro::* usages became undeclared
//     identifiers instead.
//  3. Forcing FOLLY_HAS_COROUTINES=0 in Portability.h alone (dropping the
//     include-guard from attempt 2) — back to "file not found", because the
//     unconditional #include in Expected.h isn't itself gated by that macro.
//
// This does both at once, and generalizes the include-guard to every folly
// header (not just Expected.h) in case others have the same unconditional
// include: force FOLLY_HAS_COROUTINES=0 in Portability.h, and wrap every
// `#include <folly/coro/...>` line anywhere under the vendored folly headers
// with an __has_include guard. Both are plain file edits done in Podfile
// post_install, unaffected by build-setting precedence.
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
    folly_headers_dir = File.join(installer.sandbox.root, 'Headers/Public/ReactNativeDependencies/folly')

    folly_portability_header = File.join(folly_headers_dir, 'Portability.h')
    if File.exist?(folly_portability_header)
      portability_contents = File.read(folly_portability_header)
      unless portability_contents.include?('ZENFINANCE_FOLLY_CORO_FIX')
        File.write(folly_portability_header, "// ZENFINANCE_FOLLY_CORO_FIX\\n#undef FOLLY_HAS_COROUTINES\\n#define FOLLY_HAS_COROUTINES 0\\n" + portability_contents)
      end
    end

    if File.directory?(folly_headers_dir)
      Dir.glob(File.join(folly_headers_dir, '**', '*.h')).each do |header_path|
        header_contents = File.read(header_path)
        next unless header_contents.include?('#include <folly/coro/')
        patched = header_contents.gsub(/^#include <(folly\\/coro\\/[^>]+)>$/) do
          include_path = Regexp.last_match(1)
          "#if __has_include(<#{include_path}>)\\n#include <#{include_path}>\\n#endif"
        end
        File.write(header_path, patched) if patched != header_contents
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
