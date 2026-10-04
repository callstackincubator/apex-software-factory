import { render, screen } from "@testing-library/react-native";

import HomeScreen from "@/app/index";

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
jest.mock("@/lib/api", () => ({
  api: { health: () => Promise.reject(new Error("no API in tests")) },
}));

describe("HomeScreen", () => {
  it("presents the blank canvas: headline, event, empty shipped list and status", async () => {
    await render(<HomeScreen />);

    expect(
      screen.getByRole("header", { name: "This app is empty. On purpose." }),
    ).toBeOnTheScreen();
    expect(screen.getByText("reactCon Berlin · Oct 7–9, 2026")).toBeOnTheScreen();
    expect(screen.getByText("Nothing shipped yet.")).toBeOnTheScreen();
    expect(await screen.findByText("offline")).toBeOnTheScreen();
  });
});
