import type { z } from "zod";

import type { CoinFlipTool } from "../agent-tools";
import { createCoinFlipTools } from "../agent-tools";

// The way appduct calls a handler: parsed input, an execution context it owns.
function call(tool: CoinFlipTool, input: object = {}) {
  const args = (tool.inputSchema as z.ZodType).parse(input);
  const result = tool.handler(args as never, undefined as never);
  return (tool.outputSchema as z.ZodType).parse(result) as Record<string, unknown>;
}

describe("open_coin_flip", () => {
  it("navigates to /coin-flip and returns that pathname", () => {
    const navigate = jest.fn();

    expect(call(createCoinFlipTools({ navigate }))).toEqual({ pathname: "/coin-flip" });
    expect(navigate).toHaveBeenCalledWith("/coin-flip");
  });

  it("is idempotent and not destructive, so a retry is safe", () => {
    expect(createCoinFlipTools({ navigate: jest.fn() }).annotations).toStrictEqual({
      idempotentHint: true,
    });
  });
});
