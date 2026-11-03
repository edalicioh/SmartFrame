import { describe, expect, it } from "vitest";
// @ts-expect-error Node-only JavaScript helper has no TypeScript declarations.
import { connectionOptions, hasForward } from "../scripts/tablet-usb.mjs";

describe("encaminhamento USB do player", () => {
  it("exige seleção explícita de um tablet e valida a porta", () => {
    expect(() => connectionOptions([])).toThrow();
    expect(connectionOptions(["--serial", "P7_TEST"])).toEqual({ serial: "P7_TEST", port: 3000 });
    expect(connectionOptions(["--serial", "P7_TEST", "--port", "3030"])).toEqual({
      serial: "P7_TEST",
      port: 3030,
    });
    for (const port of ["0", "65536", "3000;outro", "-1"])
      expect(() => connectionOptions(["--serial", "P7_TEST", "--port", port])).toThrow();
  });
  it("não confunde outras portas ou encaminhamentos com o do player", () => {
    expect(hasForward("", 3000)).toBe(false);
    expect(hasForward("UsbFfs tcp:3030 tcp:3000\n", 3000)).toBe(false);
    expect(hasForward("UsbFfs tcp:3000 tcp:8080\n", 3000)).toBe(false);
    expect(hasForward("UsbFfs tcp:3030 tcp:3030\r\nUsbFfs tcp:3000 tcp:3000\r\n", 3000)).toBe(true);
  });
});
