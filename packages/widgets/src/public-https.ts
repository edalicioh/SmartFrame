import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { Agent } from "undici";
import { isPublicIpAddress } from "@smartframe/contracts";

/** Return only validated addresses directly to the socket; never resolve them again. */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  void lookup(hostname, { all: true, verbatim: true }).then(
    (addresses) => {
      if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) {
        callback(new Error("O feed deve resolver apenas para endereços públicos."), "");
        return;
      }
      const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family;
      const candidates = family ? addresses.filter((entry) => entry.family === family) : addresses;
      if (!candidates.length) {
        callback(new Error("Endereço público indisponível para esta família de rede."), "");
        return;
      }
      if (options.all) callback(null, candidates);
      else callback(null, candidates[0].address, candidates[0].family);
    },
    (error: NodeJS.ErrnoException) => callback(error, ""),
  );
};

// TLS still verifies the original hostname; the lookup callback pins the checked IP.
export const publicHttpsDispatcher = new Agent({
  connect: { lookup: publicLookup },
  autoSelectFamily: true,
});
