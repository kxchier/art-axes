const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "../dist");
const port = Number(process.env.PORT) || 8083;
const host = "127.0.0.1";
const { createLabelEmbedder, validateLabels } = require("./label-embeddings.cjs");
const embedLabels = createLabelEmbedder(path.join(root, "models"));

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
    if (pathname === "/api/label-embeddings") {
      if (request.method !== "POST") { response.writeHead(405, { Allow: "POST" }).end(); return; }
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) { response.writeHead(403).end("Forbidden"); return; }
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 100000) { response.writeHead(413).end("Request too large"); return; }
      }
      let labels;
      try { labels = validateLabels(JSON.parse(body).labels); }
      catch (error) { response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error.message })); return; }
      try {
        const result = await embedLabels(labels);
        response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(result));
      } catch (error) {
        console.error("Label comparison failed:", error);
        response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "The local label model could not load. Check that model files are present and npm install has completed." }));
      }
      return;
    }
    const requestedPath = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.resolve(root, `.${requestedPath}`);

    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    const file = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(file);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500).end(error.code === "ENOENT" ? "Not found" : "Server error");
  }
});

server.listen(port, host, () => {
  console.log(`pairwise media graphs is running at http://${host}:${port}`);
});

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(`port ${port} is already in use. try: PORT=8084 npm run dev`);
    process.exit(1);
  }
  throw error;
});
