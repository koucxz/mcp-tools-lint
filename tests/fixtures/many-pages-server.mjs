import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => {
  const request = JSON.parse(line);
  if (request.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "many-pages", version: "0.1.0" } } }) + "\n");
  if (request.method === "tools/list") {
    const page = Number(String(request.params?.cursor ?? "0").replace("page-", ""));
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [], nextCursor: `page-${page + 1}` } }) + "\n");
  }
});