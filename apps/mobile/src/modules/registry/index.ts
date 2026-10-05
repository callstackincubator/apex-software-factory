import type { Href } from "expo-router";

export type ShippedFeature = {
  id: string;
  title: string;
  summary: string;
  issue: number;
  shippedAt: string;
  href?: Href;
};

export const shippedFeatures: readonly ShippedFeature[] = [];
