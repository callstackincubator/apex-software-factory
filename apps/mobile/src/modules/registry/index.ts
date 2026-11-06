import type { Href } from "expo-router";

export type ShippedFeature = {
  id: string;
  title: string;
  summary: string;
  issue: number;
  shippedAt: string;
  href?: Href;
};

export const shippedFeatures: readonly ShippedFeature[] = [
  {
    id: "coin-flip",
    title: "Coin flip",
    summary: "Settle it fairly: tap to toss a coin.",
    issue: 58,
    shippedAt: "2026-11-06",
    href: "/coin-flip",
  },
];
