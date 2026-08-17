// Shared style tokens. One source of truth instead of the same literal class
// strings copy-pasted into every form and list page.

// What a form says when the request may or may not have reached the server —
// a dropped response after a committed save is the one case where claiming
// success is a lie and claiming failure is a trap. Saying exactly that, and
// keeping the form (and its operation id) alive, is what lets the retry be
// refused server-side as a duplicate if the first one landed.
export const TRANSPORT_ERROR_MESSAGE =
  "Couldn't reach the server — the save may or may not have gone through. Check the list, then Save again if it didn't.";

// --- Form fields -------------------------------------------------------------
// w-full so a field fills whatever column it is dropped into — on a phone
// every form is one column, and a field that sizes to its content leaves a
// ragged edge down the page.
export const inputClass = "h-12 w-full rounded border border-sand px-3 text-base text-ink focus:border-navy-800";
// The compact field used inside the big entry forms (sale, purchase,
// quotation, transfer, adjustment, inter-company, ledger). Seven files each
// declared this exact string; it is one thing, so it lives in one place.
// w-full because on a phone every form is a single column.
export const fieldClass = "h-11 w-full rounded border border-sand px-3 text-sm text-ink focus:border-navy-800";

export const labelClass = "flex flex-col gap-1 text-sm";
export const labelTextClass = "font-medium text-ink";

// --- Buttons -----------------------------------------------------------------
// `submitClass` is the in-form submit; `primaryActionClass` / `secondaryActionClass`
// are the page-header actions. Same visual language, different sizing — header
// buttons sit next to a heading, submits sit at the end of a field stack.
// Full width on a phone (a 40%-wide Save under a stack of full-width fields
// reads as unfinished), content width from sm up.
export const submitClass =
  "mt-2 h-12 w-full rounded bg-navy-800 px-6 text-base font-semibold text-white hover:bg-navy-700 disabled:opacity-40 sm:w-fit";
export const primaryActionClass =
  "h-11 rounded bg-navy-800 px-5 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-40";
export const secondaryActionClass =
  "h-11 rounded border border-sand px-5 text-sm font-semibold text-navy-800 hover:bg-ivory disabled:opacity-40";
export const deleteButtonClass = "text-sm font-medium text-error hover:underline disabled:opacity-40";

// --- Icon buttons ------------------------------------------------------------
// The page-header actions are icon-only now: a list screen's whole job is to
// show rows, and four labelled buttons across the top were spending a strip of
// every screen restating what the icons say. Square, so a row of them reads as
// a toolbar rather than as ragged pills.
//
// Every one of these MUST carry an aria-label and a title — the label is the
// only thing left for a screen reader, and the title is what a new user hovers
// to find out what the glyph means. A bare icon button with neither is not a
// smaller button, it is an unlabelled one.
export const iconButtonClass =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded border border-sand text-navy-800 hover:bg-ivory disabled:opacity-40 disabled:hover:bg-transparent";
export const primaryIconButtonClass =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-40";

// The "+" that opens a quick-add popup from inside a bigger form. Two sizes
// because the contexts genuinely differ: `quickAdd` sits beside a full-height
// field, `quickAddInline` sits inside a line-item table row where 12 units of
// height would push every row apart.
export const quickAddButtonClass =
  "flex h-12 w-12 shrink-0 items-center justify-center rounded border border-sand text-lg text-navy-800 hover:bg-ivory";
export const quickAddInlineClass =
  "flex h-10 w-8 shrink-0 items-center justify-center rounded border border-sand text-navy-800 hover:bg-ivory";

// --- Inline messages ---------------------------------------------------------
export const errorTextClass = "text-sm text-error";
export const successTextClass = "text-sm text-success";
