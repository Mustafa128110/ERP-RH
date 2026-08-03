// Lines can be booked without a location — document_lines.location_id is
// nullable, and a sale or purchase entered in a hurry often leaves it empty. The
// stock those lines produce is real, it just isn't anywhere, so it needs a name
// to be picked out of a dropdown and a value that survives a round trip through
// a form or a query string. NULL can't do either.
//
// Lives outside the "use server" action files because both the server actions
// and the client forms need it, and such a module may only export async
// functions. Same reason lib/adjustment-constants.ts exists.
export const UNASSIGNED_LOCATION = "unassigned";
export const UNASSIGNED_LABEL = "Unassigned";

// Form value to what the column stores. Both the sentinel and a blank map to
// NULL; the caller decides whether blank was allowed in the first place.
export const locationIdOrNull = (value: string): string | null => (value === UNASSIGNED_LOCATION || value === "" ? null : value);

// The other direction, for loading a saved document back into its form.
export const locationFormValue = (value: string | null): string => value ?? UNASSIGNED_LOCATION;
