import type { AppductToolGroupRegistrar, AppductToolRegistration } from "@appduct/react-native";
import { type Href, router } from "expo-router";
import { z } from "zod";

const COIN_FLIP_PATH = "/coin-flip";

const inputSchema = z.object({});
const outputSchema = z.object({
  pathname: z.string().describe("Route the app shows after the call"),
});

export type CoinFlipTool = AppductToolRegistration<typeof inputSchema, typeof outputSchema> & {
  group?: undefined;
};

export type CoinFlipToolDeps = {
  navigate(path: string): void;
};

export function createCoinFlipTools(deps: CoinFlipToolDeps): CoinFlipTool {
  return {
    name: "open_coin_flip",
    description:
      "Open the Coin flip screen from anywhere in the app. Reaching the screen already showing stacks nothing and resets nothing, so the current result and flip count stay as they are.",
    inputSchema,
    outputSchema,
    annotations: { idempotentHint: true },
    handler: () => {
      deps.navigate(COIN_FLIP_PATH);
      return { pathname: COIN_FLIP_PATH };
    },
  };
}

export const agentTools = {
  featureId: "coin-flip",
  register: (registerTool: AppductToolGroupRegistrar) => {
    registerTool(createCoinFlipTools({ navigate: (path) => router.navigate(path as Href) }));
  },
};
