#!/usr/bin/env node
import { Command } from "commander";
import { APP_NAME, APP_TAGLINE } from "@adaiyalam/config";
import { registerScanCommand } from "./commands/scan.js";
import { registerRuleCommand } from "./commands/rule.js";
import { registerHistoryCommands } from "./commands/history.js";
import { registerDashboardCommand } from "./commands/dashboard.js";
import { registerVulnDataCommands } from "./commands/vuln-data.js";

const program = new Command();
program.name(APP_NAME.toLowerCase()).description(`${APP_NAME} — ${APP_TAGLINE}`).version("0.1.0");

registerScanCommand(program);
registerRuleCommand(program);
registerHistoryCommands(program);
registerDashboardCommand(program);
registerVulnDataCommands(program);

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
