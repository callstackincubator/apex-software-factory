/// <reference types="expo/types" />

// Committed so `tsc` works on a fresh clone; `expo start` also writes an
// (ignored) expo-env.d.ts with the same reference.
declare namespace NodeJS {
  interface ProcessEnv {
    /** Origin of the API, e.g. `http://192.168.1.20:3001`. Inlined at bundle time. */
    EXPO_PUBLIC_API_URL?: string;
  }
}
