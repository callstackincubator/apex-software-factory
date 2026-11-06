import type { AppductToolGroupRegistrar } from "@appduct/react-native";

import { agentTools as coinFlip } from "@/modules/coin-flip";

export type FeatureAgentTools = {
  featureId: string;
  register: (registerTool: AppductToolGroupRegistrar) => void;
};

export const featureAgentTools: readonly FeatureAgentTools[] = [coinFlip];
