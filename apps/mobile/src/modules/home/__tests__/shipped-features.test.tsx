import { render, screen } from "@testing-library/react-native";

import type { ShippedFeature } from "@/modules/registry";

import { ShippedFeatures } from "../shipped-features";

const feature = (id: string, title: string, issue: number): ShippedFeature => ({
  id,
  title,
  summary: `${title} for booth visitors.`,
  issue,
  shippedAt: "2026-10-07",
});

describe("ShippedFeatures", () => {
  it("shows the empty state while nothing has shipped", async () => {
    await render(<ShippedFeatures features={[]} />);

    expect(screen.getByText("Nothing shipped yet.")).toBeOnTheScreen();
    expect(screen.getByLabelText("0 shipped")).toBeOnTheScreen();
  });

  it("starts empty: the registry ships with no features", async () => {
    await render(<ShippedFeatures />);

    expect(screen.getByText("Nothing shipped yet.")).toBeOnTheScreen();
  });

  it("lists shipped features newest first and drops the empty state", async () => {
    await render(
      <ShippedFeatures
        features={[feature("first", "Keynote countdown", 12), feature("second", "Speaker map", 15)]}
      />,
    );

    expect(screen.queryByText("Nothing shipped yet.")).not.toBeOnTheScreen();
    expect(screen.getByLabelText("2 shipped")).toBeOnTheScreen();
    const titles = screen
      .getAllByText(/^(Keynote countdown|Speaker map)$/)
      .map((node) => node.props.children);
    expect(titles).toEqual(["Speaker map", "Keynote countdown"]);
    expect(screen.getByText("#15 · 2026-10-07")).toBeOnTheScreen();
  });
});
