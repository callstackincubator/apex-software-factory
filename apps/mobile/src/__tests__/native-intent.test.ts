import { redirectSystemPath } from "@/app/+native-intent";

const PAIRING = "apexfactory:///?appduct=eyJ2IjoxfQ&pin=sha256/AAAA";

describe("+native-intent", () => {
  it("keeps a running app where it is when appduct's pairing link arrives", () => {
    expect(redirectSystemPath({ path: PAIRING, initial: false })).toBeNull();
  });

  it("opens the home screen when the pairing link starts the app", () => {
    expect(redirectSystemPath({ path: PAIRING, initial: true })).toBe("/");
  });

  it("passes every other link through unchanged", () => {
    expect(redirectSystemPath({ path: "apexfactory:///features/12", initial: false })).toBe(
      "apexfactory:///features/12",
    );
    expect(redirectSystemPath({ path: "apexfactory:///?appductish=1", initial: false })).toBe(
      "apexfactory:///?appductish=1",
    );
  });
});
