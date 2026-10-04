import type { Href } from "expo-router";

/**
 * A feature proposed at the booth and shipped to this app.
 *
 * To ship one: build it (a route under `src/app/` and components under
 * `src/components/` or `src/features/<id>/`), then append an entry to
 * `shippedFeatures` below. Newest last; the home screen shows newest first.
 */
export type ShippedFeature = {
  /** Stable kebab-case id, e.g. `"countdown-to-keynote"`. */
  id: string;
  /** Short name shown in the list, e.g. `"Countdown to the keynote"`. */
  title: string;
  /** One sentence on what it does for the visitor. */
  summary: string;
  /** GitHub issue number of the spec it was built from. */
  issue: number;
  /** ISO date (`YYYY-MM-DD`) it was merged. */
  shippedAt: string;
  /** Route that opens the feature, if it has a screen of its own. */
  href?: Href;
};

export const shippedFeatures: readonly ShippedFeature[] = [];
