import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Server tests run in node; a page test opts into jsdom with `@vitest-environment jsdom`.
  test: { include: ["src/**/*.test.{ts,tsx}"], environment: "node" },
});
