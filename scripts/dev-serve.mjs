import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { context } from "esbuild";

const port = Number(process.env.PORT ?? 7700);
const distDir = resolve("dist");

const build = await context({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "browser",
  target: "es2020",
  format: "cjs",
  outfile: "dist/index.js",
  external: ["ws"],
  logLevel: "info",
});

await build.watch();

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.js" : url.pathname);
  const filePath = normalize(join(distDir, pathname));

  if (filePath !== distDir && !filePath.startsWith(`${distDir}${sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": types.get(extname(filePath)) ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    if (req.method !== "HEAD") {
      res.end(body);
    } else {
      res.end();
    }
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Serving dist at http://localhost:${port}/index.js`);
});

const shutdown = async () => {
  server.close();
  await build.dispose();
};

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});
