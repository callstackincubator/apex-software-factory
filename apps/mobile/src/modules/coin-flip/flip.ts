export type CoinSide = "Heads" | "Tails";

export function flip(_random: () => number): CoinSide {
  // Not tossed yet: the coin always lands the same way.
  return "Tails";
}
