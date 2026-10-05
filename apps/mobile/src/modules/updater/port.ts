export type AvailableUpdate = {
  id: string;
  message: string | null;
  rollback: boolean;
  forced: boolean;
  download(): Promise<boolean>;
};

export type RunningBundle = { id: string; embedded: boolean; channel: string };

export type Updater = {
  serverUrl: string;
  start(): void;
  check(): Promise<AvailableUpdate | null>;
  reload(): Promise<void>;
  runningBundle(): RunningBundle;
  fingerprint(): string | null;
};
