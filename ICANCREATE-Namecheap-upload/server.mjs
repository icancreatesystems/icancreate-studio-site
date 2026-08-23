import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import worker from "./dist/server/index.js";

const publicRoot = join(import.meta.dirname, "dist", "client");
const mime = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8", ".ico": "image/x-icon",
};

function resolveStaticFile(url) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  const relative = normalize(pathname).replace(/^([/\\])+/, "");
  const file = join(publicRoot, relative);
  if (!file.startsWith(publicRoot) || !existsSync(file) || !statSync(file).isFile()) {
    return null;
  }
  return file;
}

const ASSETS = {
  async fetch(request) {
    const file = resolveStaticFile(request.url);
    if (!file) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(Readable.toWeb(createReadStream(file)), {
      headers: { "content-type": mime[extname(file)] || "application/octet-stream" },
    });
  },
};

createServer(async (req, res) => {
  try {
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "icancreate.studio";
    const url = `${protocol}://${host}${req.url || "/"}`;

    // Serve generated browser assets before handing application routes to the
    // worker. Some shared-hosting proxies do not pass these requests through
    // the worker asset binding reliably.
    if (req.method === "GET" || req.method === "HEAD") {
      const file = resolveStaticFile(url);
      if (file) {
        res.statusCode = 200;
        res.setHeader("content-type", mime[extname(file)] || "application/octet-stream");
        res.setHeader("cache-control", "public, max-age=31536000, immutable");
        if (req.method === "HEAD") {
          res.end();
        } else {
          createReadStream(file).pipe(res);
        }
        return;
      }
    }

    const request = new Request(url, { method: req.method, headers: req.headers });
    const response = await worker.fetch(request, { ASSETS }, { waitUntil() {} });
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.end("Server error");
  }
}).listen(Number(process.env.PORT || 3000), "0.0.0.0");
