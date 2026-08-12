// Every key this app responds to, in one list.
//
// The app already had a keyboard model — arrow navigation in every list, an
// Excel grid in every batch dialog, Ctrl+Enter to save — and no way to find out
// about it. A shortcut nobody knows about is a shortcut nobody uses, so the
// list that drives the behaviour is the same list that draws the help sheet:
// they cannot drift, because there is only one of them.
//
// Lives outside the component so both the handler and the sheet read it, and so
// adding a shortcut is one entry rather than three edits.

export type Shortcut = {
  // What to press, as the help sheet spells it. "g then s" is a sequence.
  keys: string;
  label: string;
  // Set on the ones that navigate: pressed after `g`, goes here.
  go?: string;
};

export type ShortcutGroup = { title: string; shortcuts: Shortcut[] };

// The "g then <key>" sequence — the convention Gmail and GitHub use, and the
// only way to get single-key navigation without stealing letters from every
// text box on the page. The key is what follows `g`.
export const GO_TO: Record<string, { href: string; label: string }> = {
  d: { href: "/dashboard", label: "Dashboard" },
  s: { href: "/sales", label: "New Sale" },
  i: { href: "/sales/invoices", label: "Invoices" },
  q: { href: "/sales/quotations", label: "Quotations" },
  p: { href: "/inventory/products", label: "Products" },
  k: { href: "/inventory/stock", label: "Stock" },
  u: { href: "/purchases/stock", label: "Purchases" },
  c: { href: "/purchases/suppliers", label: "Contacts" },
  l: { href: "/ledger", label: "Ledger" },
  y: { href: "/payments", label: "Payments" },
  e: { href: "/expenses", label: "Expenses" },
  a: { href: "/accounts", label: "Accounts" },
  r: { href: "/reports", label: "Reports" },
  w: { href: "/whatsapp", label: "WhatsApp" },
};

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Anywhere",
    shortcuts: [
      { keys: "Ctrl K", label: "Search products, contacts and invoices" },
      { keys: "Alt N", label: "Add a new record on this page — in the purchase popup, save and start the next one" },
      { keys: "Ctrl Alt +", label: "Zoom in — the same size control as Settings" },
      { keys: "Ctrl Alt -", label: "Zoom out" },
      { keys: "?", label: "Show this list" },
      { keys: "Esc", label: "Close a popup, or clear a search box" },
      ...Object.entries(GO_TO).map(([key, { href, label }]) => ({ keys: `g then ${key}`, label: `Go to ${label}`, go: href })),
    ],
  },
  {
    title: "In a list",
    shortcuts: [
      { keys: "/", label: "Jump to the list's search box" },
      { keys: "↑ ↓", label: "Move the highlight" },
      { keys: "PgUp PgDn", label: "Move ten rows at a time" },
      { keys: "Home End", label: "First row / last row" },
      { keys: "Enter", label: "Open the row — or tick it, on a list with tick boxes" },
      { keys: "Shift ↑ ↓", label: "Extend the ticked range" },
      { keys: "Ctrl Enter", label: "Edit everything ticked, together" },
    ],
  },
  {
    title: "In a form",
    shortcuts: [
      { keys: "Ctrl Enter", label: "Save" },
      { keys: "Ctrl Backspace", label: "Empty the field you're in" },
      { keys: "Ctrl ↓", label: "Open a dropdown without the mouse" },
    ],
  },
  {
    title: "In a sale, purchase or quotation",
    shortcuts: [
      { keys: "Ctrl I", label: "Jump to the first line item (Alt I in the purchase popup)" },
      { keys: "Ctrl D", label: "Jump to the discount field (Alt D in the purchase popup)" },
      { keys: "Ctrl T", label: "Jump to the tax field (Alt T in the purchase popup)" },
      { keys: "Ctrl S", label: "Jump to the shipping field (Alt S in the purchase popup)" },
    ],
  },
  {
    title: "In a grid (batch add, sale and purchase lines)",
    shortcuts: [
      { keys: "↑ ↓ Enter", label: "Same column, next row" },
      { keys: "← →", label: "Across columns, from the edge of the text" },
      { keys: "Shift arrows", label: "Grow a block of cells" },
      { keys: "Ctrl C / Ctrl V", label: "Copy a block, paste it into another" },
      { keys: "Delete", label: "Empty the cell, or the whole selected block" },
      { keys: "Ctrl Enter", label: "Save the grid" },
    ],
  },
];
