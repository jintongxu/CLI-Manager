import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/** Serves the real drawer fixture so a host browser can verify layout and streaming. */
const root = fileURLToPath(new URL("../", import.meta.url));
const html = '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/btwTerminalDrawer.tsx"></script></body></html>';
const server = await createServer({
  root, configFile: false, logLevel: "error", plugins: [react(), tailwindcss(), {
    name: "btw-drawer-fixture",
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (new URL(req.url, "http://localhost").pathname !== "/") return next();
        res.setHeader("Content-Type", "text/html");
        res.end(await vite.transformIndexHtml(req.url, html));
      });
    },
  }],
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
await server.listen();
const address = server.httpServer.address();
console.log(`BTW_DRAWER_FIXTURE=http://127.0.0.1:${address.port}/`);
