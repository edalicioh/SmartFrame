import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupAddress, LookupOptions } from "node:dns";
import { isPublicIpAddress } from "@smartframe/contracts";

const dnsLookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: dnsLookup }));

import { publicHttpsDispatcher, publicLookup } from "../packages/widgets/src/public-https";

const resolvePublic = (options: LookupOptions = {}) =>
  new Promise<{ address: string | LookupAddress[]; family?: number }>((resolve, reject) =>
    publicLookup("feeds.example.test", options, (error, address, family) =>
      error ? reject(error) : resolve({ address, family }),
    ),
  );

beforeEach(() => dnsLookup.mockReset());

describe("RSS public HTTPS connections", () => {
  it("pins validated DNS results directly to the socket, including all-address lookups", async () => {
    const addresses = [
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ];
    dnsLookup.mockResolvedValue(addresses);
    expect(await resolvePublic()).toEqual({ address: "8.8.8.8", family: 4 });
    expect(dnsLookup).toHaveBeenCalledExactlyOnceWith("feeds.example.test", {
      all: true,
      verbatim: true,
    });
    expect(await resolvePublic({ all: true })).toEqual({ address: addresses });
    expect(await resolvePublic({ family: 6 })).toEqual({
      address: "2606:4700:4700::1111",
      family: 6,
    });
  });

  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "169.254.169.254",
    "192.168.1.1",
    "::1",
    "fd00::1",
    "febf::1",
    "::ffff:127.0.0.1",
    "2002:7f00:1::",
  ])("rejects a public-looking hostname resolving to %s", async (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
    dnsLookup.mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
    await expect(resolvePublic({ all: true })).rejects.toThrow("endereços públicos");
  });

  it("rejects mixed public/private DNS answers and revalidates subsequent connections", async () => {
    dnsLookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]).mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await resolvePublic();
    await expect(resolvePublic()).rejects.toThrow("endereços públicos");
  });

  it("applies DNS validation to the actual fetch connection before opening a private socket", async () => {
    dnsLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(
      fetch("https://private-feed.example.test/feed.xml", {
        ...{ dispatcher: publicHttpsDispatcher },
        signal: AbortSignal.timeout(2000),
      }),
    ).rejects.toMatchObject({
      cause: { message: "O feed deve resolver apenas para endereços públicos." },
    });
    expect(dnsLookup).toHaveBeenCalledOnce();
  });

  it("fails closed on DNS errors, empty answers and an unavailable address family", async () => {
    dnsLookup.mockRejectedValueOnce(new Error("DNS unavailable"));
    await expect(resolvePublic()).rejects.toThrow("DNS unavailable");
    dnsLookup.mockResolvedValueOnce([]);
    await expect(resolvePublic()).rejects.toThrow("endereços públicos");
    dnsLookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]);
    await expect(resolvePublic({ family: 6 })).rejects.toThrow("família de rede");
  });
});
