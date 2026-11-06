import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { CoinFlipScreen } from "..";
import { createCoinFlipTools } from "../agent-tools";

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

// expo-router's useFocusEffect needs a navigator; this fake keeps its contract —
// the effect runs when the screen gains focus, its cleanup when it loses it — and
// hands the test the blur/refocus a back button causes.
const mockFocus = { blur: () => {}, refocus: () => {} };

jest.mock("expo-router", () => {
  const React = require("react");
  const entries = new Set<{ effect: () => (() => void) | undefined; cleanup?: () => void }>();
  const blurAll = () => {
    for (const entry of entries) {
      entry.cleanup?.();
      entry.cleanup = undefined;
    }
  };
  mockFocus.blur = () => blurAll();
  mockFocus.refocus = () => {
    blurAll();
    for (const entry of entries) entry.cleanup = entry.effect();
  };
  return {
    useFocusEffect: (effect: () => (() => void) | undefined) => {
      React.useEffect(() => {
        const entry = { effect, cleanup: undefined as (() => void) | undefined };
        entries.add(entry);
        entry.cleanup = effect();
        return () => {
          entry.cleanup?.();
          entries.delete(entry);
        };
      }, [effect]);
    },
  };
});

const randomOf = (...values: number[]) => {
  let next = 0;
  return () => values[Math.min(next++, values.length - 1)] ?? 0;
};

const pressFlip = async () => {
  await fireEvent.press(screen.getByTestId("coin-flip-button"));
};

describe("CoinFlipScreen", () => {
  it('starts with "Tap Flip to toss the coin." and no count', async () => {
    await render(<CoinFlipScreen random={randomOf()} />);

    expect(screen.getByTestId("coin-result")).toHaveAccessibleName("Tap Flip to toss the coin.");
    expect(screen.getByText("Tap Flip to toss the coin.")).toBeOnTheScreen();
    expect(screen.queryByTestId("coin-count")).toBeNull();
  });

  it('tapping Flip shows Heads with "Flip 1", then Tails with "Flip 2"', async () => {
    await render(<CoinFlipScreen random={randomOf(0.2, 0.8)} />);

    await pressFlip();
    expect(screen.getByTestId("coin-result")).toHaveAccessibleName("Heads");
    expect(screen.getByTestId("coin-count")).toHaveAccessibleName("Flip 1");

    await pressFlip();
    expect(screen.getByTestId("coin-result")).toHaveAccessibleName("Tails");
    expect(screen.getByTestId("coin-count")).toHaveAccessibleName("Flip 2");
  });

  it('losing and regaining focus after a flip shows "Tap Flip to toss the coin." and no count', async () => {
    await render(<CoinFlipScreen random={randomOf(0.2)} />);
    await pressFlip();
    expect(screen.getByTestId("coin-count")).toHaveAccessibleName("Flip 1");

    await act(async () => {
      mockFocus.blur();
      mockFocus.refocus();
    });

    expect(screen.getByTestId("coin-result")).toHaveAccessibleName("Tap Flip to toss the coin.");
    expect(screen.queryByTestId("coin-count")).toBeNull();
  });

  it('after 1,000 flips the count reads "Flip 999+"', async () => {
    await render(<CoinFlipScreen random={randomOf(0.2)} />);

    for (let tosses = 0; tosses < 1_000; tosses += 1) {
      await pressFlip();
    }

    expect(screen.getByTestId("coin-count")).toHaveAccessibleName("Flip 999+");
  });

  it("calling open_coin_flip while the screen is already showing leaves the result and the count unchanged", async () => {
    await render(<CoinFlipScreen random={randomOf(0.2)} />);
    await pressFlip();

    // expo-router's navigate to the route already showing fires no focus event.
    const openCoinFlip = createCoinFlipTools({ navigate: jest.fn() }).handler(
      {} as never,
      undefined as never,
    );

    expect(openCoinFlip).toEqual({ pathname: "/coin-flip" });
    expect(screen.getByTestId("coin-result")).toHaveAccessibleName("Heads");
    expect(screen.getByTestId("coin-count")).toHaveAccessibleName("Flip 1");
  });
});
