import type { AppductToolGroupRegistrar, AppductToolRegistration } from "@appduct/react-native";
import { z } from "zod";

export const COIN_FLIP_PATH = "/coin-flip";

const inputSchema = z.object({});
const outputSchema = z.object({
  pathname: z.string().describe("Route the screen sits at"),
});

export type CoinFlipTool = AppductToolRegistration<typeof inputSchema, typeof outputSchema> & {
  group?: undefined;
};

export type CoinFlipToolDeps = {
  navigate(path: string): void;
};

export function createCoinFlipTools(_deps: CoinFlipToolDeps): CoinFlipTool {
  // Not wired yet: the handler returns no route and opens nothing.
  return {
    name: "open_coin_flip",
    description: "Open the Coin flip screen.",
    inputSchema,
    outputSchema,
    handler: () => ({ pathname: "" }),
  };
}

export const agentTools = {
  featureId: "coin-flip",
  register: (registerTool: AppductToolGroupRegistrar) => {
    registerTool(createCoinFlipTools({ navigate: () => {} }));
  },
};
