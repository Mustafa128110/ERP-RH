export type NavItem = {
  label: string;
  href: string;
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

export const navSections: NavSection[] = [
  {
    label: "Core",
    items: [{ label: "Dashboard", href: "/dashboard" }],
  },
  {
    label: "Inventory",
    items: [
      { label: "Products", href: "/inventory/products" },
      { label: "Categories", href: "/inventory/categories" },
      { label: "Brands", href: "/inventory/brands" },
      { label: "Units", href: "/inventory/units" },
      { label: "Unit Conversions", href: "/inventory/unit-conversions" },
      { label: "Warehouses", href: "/inventory/warehouses" },
      { label: "Stock", href: "/inventory/stock" },
      { label: "Stock Transfers", href: "/inventory/stock-transfers" },
      { label: "Inter-Company Sales", href: "/inventory/inter-company" },
      { label: "Stock Adjustments", href: "/inventory/stock-adjustments" },
      { label: "Stock Movements", href: "/inventory/stock-movements" },
    ],
  },
  {
    label: "Purchases",
    items: [
      { label: "Stock Purchase", href: "/purchases/stock" },
      { label: "Contacts", href: "/purchases/suppliers" },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Sales", href: "/sales" },
      { label: "Invoices", href: "/sales/invoices" },
      { label: "Quotations", href: "/sales/quotations" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Accounts", href: "/accounts" },
      { label: "Payments", href: "/payments" },
      { label: "Ledger", href: "/ledger" },
      { label: "Expenses", href: "/expenses" },
      { label: "Taxes", href: "/taxes" },
    ],
  },
  {
    label: "Communication",
    items: [{ label: "WhatsApp", href: "/whatsapp" }],
  },
  {
    label: "Reporting",
    items: [{ label: "Reports", href: "/reports" }],
  },
  {
    label: "Administration",
    items: [
      { label: "Users", href: "/users" },
      { label: "Roles", href: "/roles" },
      { label: "Companies", href: "/companies" },
      { label: "Audit Logs", href: "/audit-logs" },
      { label: "Settings", href: "/settings" },
    ],
  },
];
