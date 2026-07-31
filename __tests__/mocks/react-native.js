// Minimal react-native stand-in for store-level tests. Platform.OS is "test"
// (neither web nor native) so the store takes its simplest paths: immediate
// persist (no web debounce) and no pixel vault.
module.exports = {
  Platform: { OS: "test", select: (o) => (o && (o.test ?? o.default)) },
};
