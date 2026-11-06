export type CoinSide = "Heads" | "Tails";

export function flip(random: () => number): CoinSide {
  return random() < 0.5 ? "Heads" : "Tails";
}
