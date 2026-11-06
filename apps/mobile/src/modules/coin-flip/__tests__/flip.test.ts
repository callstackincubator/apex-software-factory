import { flip } from "../flip";

describe("flip", () => {
  it("returns Heads below 0.5 and Tails at 0.5 and above", () => {
    expect(flip(() => 0)).toBe("Heads");
    expect(flip(() => 0.2)).toBe("Heads");
    expect(flip(() => 0.4999)).toBe("Heads");
    expect(flip(() => 0.5)).toBe("Tails");
    expect(flip(() => 0.8)).toBe("Tails");
    expect(flip(() => 0.9999)).toBe("Tails");
  });
});
