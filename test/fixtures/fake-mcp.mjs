#!/usr/bin/env node
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: msg.id,
      result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "0" } },
    }) + "\n");
  } else if (msg.method === "tools/call") {
    const name = msg.params.name;
    if (name === "fail") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: msg.id,
        error: { code: -32000, message: "boom" },
      }) + "\n");
      return;
    }
    let text;
    if (name === "get_problem") text = JSON.stringify({ titleSlug: msg.params.arguments.titleSlug });
    else if (name === "plain") text = "not-json-output";
    else if (name === "echo_env") text = JSON.stringify({ argv: process.argv.slice(2), session: process.env.LEETCODE_SESSION ?? null });
    else text = JSON.stringify({ error: `unknown tool ${name}` });
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: msg.id,
      result: { content: [{ type: "text", text }] },
    }) + "\n");
  }
});
