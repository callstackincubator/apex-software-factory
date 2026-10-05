/// <reference types="expo/types" />

// Committed so `tsc` works on a fresh clone; `expo start` also writes an
// (ignored) expo-env.d.ts with the same reference.
declare namespace NodeJS {
  interface ProcessEnv {
    /** Origin of the API, e.g. `http://192.168.1.20:3001`. Inlined at bundle time. */
    EXPO_PUBLIC_API_URL?: string;
    /** OTA server, e.g. `http://192.168.1.20:3002/hot-updater`. Inlined at bundle time. */
    EXPO_PUBLIC_OTA_URL?: string;
  }
}

// Hand-shimmed slice of the Node built-ins, same style as the ProcessEnv
// shim above: the repo keeps @types/node out of the app's type space on
// purpose, so only the surface a Jest test needs to read e2e/*.ad from disk
// is declared here (status-footer.test.tsx's version-tie test). App code
// must not use these; Metro-bundled code has no `__dirname`.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
}

declare const __dirname: string;
