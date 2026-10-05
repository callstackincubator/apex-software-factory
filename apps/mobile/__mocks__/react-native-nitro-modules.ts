// Jest picks this up automatically (a node module mock next to node_modules):
// the real package throws at import without its native TurboModule. Nitro
// libraries that mock themselves in tests (react-native-mmkv) only need it to
// import; nothing is linked, so every hybrid object is absent.
export const NitroModules = {
  hasHybridObject: jest.fn(() => false),
  createHybridObject: jest.fn((name: string) => {
    throw new Error(`Nitro hybrid object ${name} is not available in Jest`);
  }),
  getAllHybridObjectNames: jest.fn(() => []),
};
