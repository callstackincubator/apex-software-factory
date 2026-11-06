import { render, screen } from "@testing-library/react-native";

import { HomeScreen } from "..";

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

describe("HomeScreen", () => {
  it("presents the headline, the event and the status footer", async () => {
    await render(<HomeScreen />);

    expect(
      screen.getByRole("header", { name: "This app is empty. On purpose." }),
    ).toBeOnTheScreen();
    expect(screen.getByText("reactCon Berlin · Oct 7–9, 2026")).toBeOnTheScreen();
    expect(await screen.findByText("offline")).toBeOnTheScreen();
  });

  it("lists Coin flip under Shipped at the booth, and the empty state is gone", async () => {
    await render(<HomeScreen />);

    expect(screen.getByTestId("shipped-feature-coin-flip")).toBeOnTheScreen();
    expect(screen.queryByTestId("shipped-empty")).toBeNull();
  });
});
