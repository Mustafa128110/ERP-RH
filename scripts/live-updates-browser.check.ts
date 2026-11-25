import {execFileSync} from "node:child_process";
execFileSync(process.execPath,["scripts/check-live-updates-browser.mjs"],{stdio:"inherit",windowsHide:true,env:process.env});
