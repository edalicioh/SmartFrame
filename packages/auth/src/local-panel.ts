import type { PrismaClient } from "@smartframe/database";

export function isAdminLoginDisabled() {
  return process.env.SMARTFRAME_ADMIN_LOGIN === "disabled";
}

// Complementa o bind em loopback e impede acesso via Host adulterado/DNS rebinding.
export function isLocalPanelRequest(headers: Pick<Headers, "get">, baseURL: string) {
  try {
    const origin = new URL(baseURL);
    return (
      ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) &&
      ["http:", "https:"].includes(origin.protocol) &&
      headers.get("host")?.toLowerCase() === origin.host.toLowerCase() &&
      headers.get("sec-fetch-site") !== "cross-site"
    );
  } catch {
    return false;
  }
}

export async function localAdministrator(database: PrismaClient, email?: string) {
  const configuredEmail = email?.trim().toLowerCase();
  const households = await database.household.findMany({
    where: configuredEmail ? { owner: { email: configuredEmail } } : {},
    include: { owner: { select: { id: true, name: true, email: true } } },
    take: 2,
  });
  if (households.length !== 1) {
    throw new Error(
      households.length === 0
        ? "Nenhum perfil local encontrado. Configure o proprietário pelo terminal."
        : "Há mais de uma conta. Defina SMARTFRAME_ADMIN_EMAIL para escolher o perfil local.",
    );
  }
  const { owner, ...household } = households[0];
  return { user: owner, household };
}
