import {execFileSync} from "node:child_process";

execFileSync(process.execPath, ["scripts/m52-channel-repair.check.mjs", ...process.argv.slice(2)], {
  stdio: "inherit",
  windowsHide: true,
});
