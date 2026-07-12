// @sentry/react-native's RNSentry.mm calls facebook::hermes::HermesRuntime::
// enableSamplingProfiler() / disableSamplingProfiler() / dumpSampledTraceToStream()
// as static-style calls, but newer Hermes engine versions (bundled with RN
// 0.86) moved these to the IHermesRootAPI interface instead — so the build
// fails with "no member named 'enableSamplingProfiler' in
// 'facebook::hermes::HermesRuntime'". This is a known, still-unresolved
// upstream bug even as of @sentry/react-native 8.18.0 (see
// getsentry/sentry-react-native#5073). The community-confirmed fix is to
// comment out those three native profiler calls in RNSentry.mm — this app
// doesn't rely on Sentry's native (Hermes) profiling feature, just error
// tracking, so losing it is a non-issue.
const { withPodfile } = require('expo/config-plugins');

const MARKER = '__ZENFINANCE_SENTRY_HERMES_PROFILER_FIX__';

const REPLACEMENTS = [
  'facebook::hermes::HermesRuntime::enableSamplingProfiler();',
  'facebook::hermes::HermesRuntime::disableSamplingProfiler();',
  'facebook::hermes::HermesRuntime::dumpSampledTraceToStream(ss);',
];

module.exports = function withSentryHermesProfilerFix(config) {
  return withPodfile(config, (config) => {
    const contents = config.modResults.contents;
    if (contents.includes(MARKER)) {
      return config;
    }

    const replacementLines = REPLACEMENTS.map(
      (line) => `        contents = contents.gsub('${line}', '// ${line} // patched: unavailable in this Hermes version')\n`,
    ).join('');

    const injection = `
    # ${MARKER}
    # https://github.com/getsentry/sentry-react-native/issues/5073
    def zenfinance_find_up(start_dir, relative_path)
      dir = start_dir
      10.times do
        candidate = File.join(dir, relative_path)
        return candidate if File.exist?(candidate)
        parent = File.dirname(dir)
        break if parent == dir
        dir = parent
      end
      nil
    end

    rn_sentry_mm = zenfinance_find_up(__dir__, 'node_modules/@sentry/react-native/ios/RNSentry.mm')
    if rn_sentry_mm
      contents = File.read(rn_sentry_mm)
${replacementLines}      File.write(rn_sentry_mm, contents)
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
