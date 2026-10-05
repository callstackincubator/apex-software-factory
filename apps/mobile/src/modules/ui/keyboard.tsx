import { createContext, type ReactNode, useContext } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";

const ProviderMounted = createContext(false);

export function AppKeyboardProvider({ children }: { children: ReactNode }) {
  return (
    <KeyboardProvider>
      <ProviderMounted.Provider value={true}>{children}</ProviderMounted.Provider>
    </KeyboardProvider>
  );
}

export function useKeyboardProviderMounted(): boolean {
  return useContext(ProviderMounted);
}
