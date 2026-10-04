import type { AppductToolGroupRegistrar } from "@appduct/react-native";

/**
 * Agent tools a shipped feature brings along: shortcuts that let an agent
 * test the feature without tapping through it — seed its state, jump to a
 * step, emulate an event. Registered at app start by `installAgentTools`
 * (`src/dev/agent-tools.ts`) under the appduct group `features/<featureId>`.
 *
 * To add some: write `src/features/<id>/agent-tools.ts` exporting a
 * `FeatureAgentTools`, and append it below. `featureId` must be the `id` of
 * the feature's entry in `shippedFeatures` (`registry.ts`). Follow the tool
 * rules in `apps/mobile/AGENTS.md` (name by intent, `outputSchema`,
 * annotations, a matching observer).
 */
export type FeatureAgentTools = {
  /** The feature's `id` in `shippedFeatures`. */
  featureId: string;
  /** Registers the tools; `registerTool` has the feature's group bound. */
  register: (registerTool: AppductToolGroupRegistrar) => void;
};

export const featureAgentTools: readonly FeatureAgentTools[] = [];
