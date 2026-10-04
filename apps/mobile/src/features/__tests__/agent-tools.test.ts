import { registerFeatureTools } from "@/dev/agent-tools";
import { featureAgentTools } from "@/features/agent-tools";

jest.mock("@appduct/react-native", () => ({ createToolGroup: jest.fn() }));

describe("featureAgentTools", () => {
  it("only lists tools of features in shippedFeatures, each with a unique id", () => {
    const ids = featureAgentTools.map((feature) => feature.featureId);
    expect(new Set(ids).size).toBe(ids.length);

    // registerFeatureTools is what refuses an unknown or malformed id at app start.
    for (const feature of featureAgentTools) {
      expect(() => registerFeatureTools(feature.featureId, () => {}, jest.fn())).not.toThrow();
    }
  });
});
