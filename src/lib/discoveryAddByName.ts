// Add clinic by name — the one way into Discovery that isn't a bulk import.
//
// The CSV and Apify wizards exist for a list: rows, a mapping, a preview, a
// count at the end. This exists for the other half of the job — somebody names
// a clinic they heard about, and the only thing standing between that name and
// the queue is a website URL for the actors to work from. So the form asks for
// the name, the search finds the URL, and one candidate lands in Pending.
//
// What happens to it afterwards is not this module's business and is
// deliberately identical to a bulk-imported candidate's: the same Process
// Queue, the same four actors, the same scoring, the same promote-or-reject.
// The only thing this entry point decides is how the record starts.
//
// Pure — the reading and cleaning of what the form posted, and the shape of
// what comes back. src/lib/actions/discovery.ts does the searching and the
// writing.

// Long enough for the longest clinic name anybody actually has, short enough
// that a pasted paragraph is refused rather than stored and searched on.
export const CLINIC_NAME_MAX_CHARS = 120;

// A city and a state. Anything longer is not narrowing a search.
export const LOCATION_MAX_CHARS = 80;

// What this candidate says it came from, in the source column the list shows.
// The bulk imports write "LinkedIn" or whatever the mapping carried; this is
// the honest equivalent for a record that started as a name and a search.
export const ADD_BY_NAME_SOURCE = "Added by name";

// The batch every by-name candidate is filed under, dated per record rather
// than per run — there is no run here, each one is its own.
export const ADD_BY_NAME_BATCH_DESCRIPTION = "Added by name";

// What came back from adding one. A result rather than a redirect because the
// form is a dialog on the Discovery page: the search takes as long as an actor
// run takes, and the page behind it should say what happened rather than
// reload with a count of one.
export type AddByNameResult =
  | {
      ok: true;
      id: string;
      clinicName: string;
      // Null when the search ran and nothing in it read as the clinic's own
      // site. The candidate is still created — the Maps actor searches on the
      // name alone, so there is still something for the queue to score on —
      // and the dialog says as much rather than implying a website was found.
      websiteUrl: string | null;
      // The query as it was actually searched, so an unexpected result can be
      // understood without guessing what was asked.
      query: string;
      // Set when the search itself failed. The candidate exists either way;
      // this is what stops that being reported as a clean run.
      searchError?: string;
    }
  | {
      ok: false;
      error: string;
      // The clinic is already here. The dialog links to it rather than making
      // somebody go and find it.
      duplicateId?: string;
      duplicateStatus?: string;
    };

// The name as typed, made safe to store and to search on. Whitespace collapses
// because it ends up in a query and in a list cell, neither of which can show
// a second line.
export function readClinicName(raw: unknown): string | null {
  return readText(raw, CLINIC_NAME_MAX_CHARS);
}

export function readLocation(raw: unknown): string | null {
  return readText(raw, LOCATION_MAX_CHARS);
}

function readText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\s+/g, " ").trim().slice(0, max);
  return cleaned === "" ? null : cleaned;
}

// The duplicate test for a single named clinic: the clinic name alone.
//
// Deliberately looser than the bulk import's, which matches on clinic *and*
// contact because a scraped list carries one contact per row and two people at
// the same clinic are two real rows. Here there is no contact to match on, and
// "add this clinic" when the clinic is already in Discovery is a mistake worth
// catching rather than a second candidate to score twice.
export function clinicNameKey(clinicName: string): string {
  return clinicName.trim().toLowerCase().replace(/\s+/g, " ");
}
