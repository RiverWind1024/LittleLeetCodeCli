// 直连 leetcode.cn GraphQL 的取数层。
// 只读接口只需 LEETCODE_SESSION cookie，无需 csrf token（csrf 仅写操作需要）。

const GRAPHQL_URL = "https://leetcode.cn/graphql/";

function buildCookie(session) {
  const s = String(session ?? "").trim();
  if (!s) return "";
  return s.includes("LEETCODE_SESSION=") ? s : `LEETCODE_SESSION=${s}`;
}

export async function lcGraphql(query, variables, { fetchImpl = fetch, session = "", timeoutMs = 20000 } = {}) {
  const res = await fetchImpl(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      referer: "https://leetcode.cn/submissions/",
      cookie: buildCookie(session),
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`获取提交历史失败：HTTP ${res.status}`);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error("获取提交历史失败：接口返回非 JSON 内容");
  }
  if (json?.errors?.length) {
    throw new Error(`获取提交历史失败：${json.errors[0]?.message ?? "未知错误"}`);
  }
  if (!json?.data) throw new Error("获取提交历史失败：接口未返回预期数据");
  return json.data;
}
