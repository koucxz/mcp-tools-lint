import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
rl.on("line", async line => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    await wait(90);
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "fixture", version: "0.1.0" } } }) + "\n");
  }
  if (request.method === "tools/list") {
    await wait(90);
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [] } }) + "\n");
  }
});