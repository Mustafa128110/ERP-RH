export type NavItem = {
  label: string;
  href: string;
  permission?: string | string[];
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

export const navSections: NavSection[] = [
  {
    label: "Core",
    items: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Contacts", href: "/contacts", permission: ["customers.view", "suppliers.view"] },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Products", href: "/inventory/products", permission: "products.view" },
      { label: "Categories", href: "/inventory/categories", permission: "categories.view" },
      { label: "Brands", href: "/inventory/brands", permission: "brands.view" },
      { label: "Units", href: "/inventory/units", permission: "units.view" },
      { label: "Unit Conversions", href: "/inventory/unit-conversions", permission: "unit_conversions.view" },
      { label: "Warehouses", href: "/inventory/warehouses", permission: "locations.view" },
      { label: "Stock", href: "/inventory/stock", permission: "stock.view" },
      { label: "Stock Transfers", href: "/inventory/stock-transfers", permission: "stock_transfers.view" },
      { label: "Inter-Company Sales", href: "/inventory/inter-company", permission: ["sales.view", "purchases.view"] },
      { label: "Stock Adjustments", href: "/inventory/stock-adjustments", permission: "stock_adjustments.view" },
      { label: "Stock Movements", href: "/inventory/stock-movements", permission: "stock.view" },
    ],
  },
  {
    label: "Purchases",
    items: [
      { label: "Stock Purchases", href: "/purchases/stock", permission: "purchases.view" },
      { label: "Market Purchases", href: "/purchases/market", permission: "purchases.view" },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "New Sale", href: "/sales", permission: "sales.create" },
      { label: "Sales Invoices", href: "/sales/invoices", permission: "invoices.view" },
      { label: "Quotations", href: "/sales/quotations", permission: "quotations.view" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Accounts", href: "/accounts", permission: "accounts.view" },
      { label: "GL Setup", href: "/accounts/gl", permission: "accounts.view" },
      { label: "Payments", href: "/payments", permission: "payments.view" },
      { label: "Ledger", href: "/ledger", permission: "accounts.view" },
      { label: "Expenses", href: "/expenses", permission: "expenses.view" },
      { label: "Taxes", href: "/taxes", permission: "taxes.view" },
      { label: "Costing", href: "/costing" },
    ],
  },
  {
    label: "Communication",
    items: [{ label: "WhatsApp", href: "/whatsapp", permission: ["customers.view", "suppliers.view"] }],
  },
  {
    label: "Reporting",
    items: [{ label: "Reports", href: "/reports", permission: "reports.view" }],
  },
  {
    label: "Administration",
    items: [
      { label: "Users", href: "/users", permission: "users.view" },
      { label: "Roles", href: "/roles", permission: "roles.view" },
      { label: "Companies", href: "/companies", permission: "companies.view" },
      { label: "Audit Logs", href: "/audit-logs", permission: "audit.view" },
      { label: "Settings", href: "/settings", permission: "settings.view" },
    ],
  },
];
