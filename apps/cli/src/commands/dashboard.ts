import { spawn } from "node:child_process";
import { Command } from "commander";
import { APP_NAME } from "@adaiyalam/config";

function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === "win32") spawn("cmd", ["/c", "start", '""', url], { shell: false, stdio: "ignore", detached: true }).unref();
    else if (platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    else spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // best effort only; the user can still open the URL manually
  }
}

export function registerDashboardCommand(program: Command): void {
  program
    .command("dashboard")
    .description("Start the local web dashboard + JSON API")
    .option("-p, --port <port>", "port to listen on", "4848")
    .option("--host <host>", "address to bind (default: localhost only)", "127.0.0.1")
    .option("--no-open", "do not open the dashboard in a browser automatically")
    .action(async (options) => {
      const { createServer } = await import("@adaiyalam/api");
      const app = await createServer({ logger: false });
      const port = Number(options.port);
      await app.listen({ port, host: options.host });
      const url = `http://${options.host}:${port}`;
      console.log(`${APP_NAME} dashboard running at ${url} (local only)`);
      if (options.open !== false) openBrowser(url);
    });
}
