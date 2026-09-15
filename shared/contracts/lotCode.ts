// ---------------------------------------------------------------------------
// Lot code generator — operator convention:
//   706C-<FARMINITIALS><LORDINITIALS>-<YY>-<NN>
//   e.g. 706C-KM-26-01 (no landlord) · 706C-KMJS-26-01 (landlord J. Smith)
// 706C  = elevator prefix (constant below if it ever changes)
// YY    = current 2-digit year; NN = next sequence for that farmer (+landlord)
//         combination this year (scans existing codes, takes max + 1)
// ---------------------------------------------------------------------------

export const LOT_CODE_PREFIX = "706C";

function initialsOf(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, " ") // drop parenthetical nicknames
    .split(/[^A-Za-z]+/)
    .filter(Boolean);
  return words.map((w) => w[0]!.toUpperCase()).join("");
}

/** "Kurt Miller" → "KM" · "S&C Farms (Sam Cole)" → "SF" · "Triple J Ag" → "TJA" */
export function farmInitials(name: string): string {
  return initialsOf(name) || "FARM";
}

function yearCode(now: Date): string {
  return String(now.getFullYear() % 100).padStart(2, "0");
}

/**
 * Base for this farmer/landlord this year — sequence is appended after a dash.
 * e.g. "706C-KM-26" or "706C-KMJS-26" (landlord initials join the farmer's).
 */
export function lotCodeBase(
  farmerName: string,
  landlordName?: string | null,
  now = new Date(),
): string {
  const landlord = landlordName ? initialsOf(landlordName) : "";
  const initials = farmInitials(farmerName) + landlord;
  return `${LOT_CODE_PREFIX}-${initials}-${yearCode(now)}`;
}

/** Next available code, e.g. "706C-KM-26-03" when …-01 and …-02 exist. */
export function nextLotCode(
  existingCodes: string[],
  farmerName: string,
  landlordName?: string | null,
  now = new Date(),
): string {
  const base = lotCodeBase(farmerName, landlordName, now);
  const prefix = `${base}-`;
  let max = 0;
  for (const code of existingCodes) {
    if (!code.startsWith(prefix)) continue;
    const tail = code.slice(prefix.length);
    if (!/^\d{2,}$/.test(tail)) continue;
    max = Math.max(max, parseInt(tail, 10));
  }
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}
