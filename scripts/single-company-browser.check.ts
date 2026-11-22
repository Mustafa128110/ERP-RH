import { execFileSync } from "node:child_process";

// Optional browser suite. PLAYWRIGHT_MODULE and ERP_BROWSER_EXECUTABLE can point
// at the bundled desktop runtime; the suite uses isolated fixture actions.
execFileSync(process.execPath, ["scripts/check-single-company-browser.mjs"], { stdio: "inherit", windowsHide: true, env: process.env });
