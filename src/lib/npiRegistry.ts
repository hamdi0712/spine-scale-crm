// The public CMS NPI Registry — organization (NPI-2) records, read only.
//
// Server-only. Confirmed against the registry's own API page
// (npiregistry.cms.hhs.gov/api-page) and a live answer:
//
//   GET https://npiregistry.cms.hhs.gov/api/?version=2.1
//       &enumeration_type=NPI-2&organization_name=<name>*&state=TX&limit=50
//
//   No key, no cost. organization_name is an exact name or a trailing
//   wildcard after at least two characters, and every organization name an
//   NPI carries is searched (legal name, DBA, former and other names), so a
//   result can come back under a name other than the one asked for. limit is
//   1–200 (default 10).
//
//   Each result: number; basic.organization_name;
//   basic.authorized_official_{name_prefix,first_name,middle_name,last_name,
//   credential,title_or_position,telephone_number}; addresses[] with
//   address_purpose LOCATION | MAILING, city, state, telephone_number;
//   other_names[] { organization_name, type }.

const API_BASE = process.env.NPI_API_BASE || "https://npiregistry.cms.hhs.gov";

export interface NpiAddress {
  purpose: string;
  city: string;
  state: string;
  phone: string | null;
}

export interface NpiOrganization {
  number: string;
  // The legal business name, then every other name filed (DBA and the rest).
  names: string[];
  official: {
    prefix: string | null;
    first: string | null;
    middle: string | null;
    last: string | null;
    credential: string | null;
    title: string | null;
    phone: string | null;
  };
  addresses: NpiAddress[];
}

export type NpiSearchResult = { ok: true; results: NpiOrganization[] } | { ok: false; error: string };

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  // The registry writes "--" in a field nobody filled in.
  return t === "" || t === "--" ? null : t;
}

export function readNpiOrganization(raw: unknown): NpiOrganization | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const number = typeof o.number === "string" || typeof o.number === "number" ? String(o.number) : null;
  const basic = (o.basic ?? {}) as Record<string, unknown>;
  if (!number) return null;
  const others = Array.isArray(o.other_names) ? o.other_names : [];
  const names = [str(basic.organization_name), ...others.map((n) => str((n as Record<string, unknown>)?.organization_name))].filter(
    (n): n is string => n !== null,
  );
  const addresses = (Array.isArray(o.addresses) ? o.addresses : []).flatMap((a): NpiAddress[] => {
    if (a === null || typeof a !== "object") return [];
    const r = a as Record<string, unknown>;
    return [{ purpose: str(r.address_purpose) ?? "", city: str(r.city) ?? "", state: str(r.state) ?? "", phone: str(r.telephone_number) }];
  });
  return {
    number,
    names,
    official: {
      prefix: str(basic.authorized_official_name_prefix),
      first: str(basic.authorized_official_first_name),
      middle: str(basic.authorized_official_middle_name),
      last: str(basic.authorized_official_last_name),
      credential: str(basic.authorized_official_credential),
      title: str(basic.authorized_official_title_or_position),
      phone: str(basic.authorized_official_telephone_number),
    },
    addresses,
  };
}

// Organizations whose name starts with `namePrefix`, in `state` when one is
// known. The wildcard is added here.
export async function searchNpiOrganizations(namePrefix: string, state: string | null): Promise<NpiSearchResult> {
  const params = new URLSearchParams({ version: "2.1", enumeration_type: "NPI-2", organization_name: `${namePrefix}*`, limit: "50" });
  if (state) params.set("state", state);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/?${params.toString()}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  } catch {
    return { ok: false, error: "Could not reach the NPI Registry. Check the server's network connection and try again." };
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: `The NPI Registry answered HTTP ${response.status}.` };
  const o = (json ?? {}) as Record<string, unknown>;
  // A bad query comes back 200 with an Errors list rather than results.
  if (Array.isArray(o.Errors) && o.Errors.length > 0) {
    const first = o.Errors[0] as Record<string, unknown>;
    return { ok: false, error: `The NPI Registry refused the search: ${String(first?.description ?? "no reason given")}` };
  }
  const results = (Array.isArray(o.results) ? o.results : []).map(readNpiOrganization).filter((r): r is NpiOrganization => r !== null);
  return { ok: true, results };
}
