import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { callTool } from "../bin/lc.mjs";

const fake = fileURLToPath(new URL("./fixtures/fake-mcp.mjs", import.meta.url));
const resolveBin = () => ({ cmd: process.execPath, args: [fake], local: true });

test("callTool 握手并返回解析后的 JSON 数据", async () => {
  const data = await callTool("get_problem", { titleSlug: "two-sum" }, { resolveBin, timeoutMs: 10000 });
  assert.deepEqual(data, { titleSlug: "two-sum" });
});

test("callTool 非 JSON 返回时降级为 { raw }", async () => {
  const data = await callTool("plain", {}, { resolveBin, timeoutMs: 10000 });
  assert.deepEqual(data, { raw: "not-json-output" });
});

test("callTool 收到 JSON-RPC error 时 reject", async () => {
  await assert.rejects(
    callTool("fail", {}, { resolveBin, timeoutMs: 10000 }),
    /boom/
  );
});

test("callTool 以 --site cn 启动且 session 经 env 注入", async () => {
  const data = await callTool("echo_env", {}, { resolveBin, session: "S", timeoutMs: 10000 });
  assert.deepEqual(data.argv, ["--site", "cn"]);
  assert.equal(data.session, "S");
});

test("callTool spawn 失败时 reject", async () => {
  const badBin = () => ({ cmd: "/nonexistent/definitely-not-here", args: [], local: true });
  await assert.rejects(
    callTool("get_problem", {}, { resolveBin: badBin, timeoutMs: 5000 }),
    /无法启动 MCP server/
  );
});

test("callTool 子进程提前退出时 reject 并带退出码", async () => {
  const exiter = fileURLToPath(new URL("./fixtures/exit-mcp.mjs", import.meta.url));
  const earlyExit = () => ({ cmd: process.execPath, args: [exiter], local: true });
  await assert.rejects(
    callTool("get_problem", {}, { resolveBin: earlyExit, timeoutMs: 5000 }),
    /提前退出（code 3）/
  );
});

test("callTool 超过 timeoutMs 时 reject", async () => {
  const slow = fileURLToPath(new URL("./fixtures/slow-mcp.mjs", import.meta.url));
  const sleeper = () => ({ cmd: process.execPath, args: [slow], local: true });
  await assert.rejects(
    callTool("get_problem", {}, { resolveBin: sleeper, timeoutMs: 300 }),
    /超时（300ms）/
  );
});
