import { createContext, type ReactNode, useContext } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";

const ProviderMounted = createContext(false);

/**
 * react-native-keyboard-controller's provider, mounted once at the root
 * (`src/app/_layout.tsx`), so any screen can use its hooks and
 * `KeyboardAwareScrollView` / `KeyboardStickyView` without wiring it again.
 */
export function AppKeyboardProvider({ children }: { children: ReactNode }) {
  return (
    <KeyboardProvider>
      <ProviderMounted.Provider value={true}>{children}</ProviderMounted.Provider>
    </KeyboardProvider>
  );
}

/** True under `AppKeyboardProvider`; the `/_capabilities` smoke checks it. */
export function useKeyboardProviderMounted(): boolean {
  return useContext(ProviderMounted);
}
