import { APP_NAME } from "@adaiyalam/config";
import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 4848);
const host = process.env.HOST ?? "127.0.0.1";

createServer({ logger: false })
  .then((app) => app.listen({ port, host }))
  .then(() => {
    console.log(`${APP_NAME} dashboard + API running at http://${host}:${port}`);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
