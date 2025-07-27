import readline from "node:readline";
const pageOne = [{ name: "first", description: "First tool" }];
const pageTwo = [{ name: "second", description: "Second tool" }];
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => {
  const request = JSON.parse(line);
  if (request.method === "notifications/initialized") return;
  if (request.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "paged", version: "0.1.0" } } }) + "\n");
  } else if (request.method === "tools/list") {
    const tools = request.params?.cursor === "page-2" ? pageTwo : pageOne;
    const result = request.params?.cursor === "page-2" ? { tools } : { tools, nextCursor: "page-2" };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
  }
});