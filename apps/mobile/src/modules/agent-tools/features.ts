import type { AppductToolGroupRegistrar } from "@appduct/react-native";

export type FeatureAgentTools = {
  featureId: string;
  register: (registerTool: AppductToolGroupRegistrar) => void;
};

export const featureAgentTools: readonly FeatureAgentTools[] = [];
