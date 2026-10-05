/// <reference types="expo/types" />

// Committed so tsc works on a fresh clone; expo start writes an ignored copy.
declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_API_URL?: string;
    EXPO_PUBLIC_OTA_URL?: string;
  }
}

// @types/node stays out of the app on purpose: only what one Jest test needs to read e2e/*.ad.
// App code must not use these; Metro-bundled code has no __dirname.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
}

declare const __dirname: string;
