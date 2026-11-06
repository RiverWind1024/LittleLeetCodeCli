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

const SUBMISSION_LIST_QUERY = `query submissionList($offset: Int!, $limit: Int!, $questionSlug: String) {
  submissionList(offset: $offset, limit: $limit, questionSlug: $questionSlug) {
    hasNext
    submissions {
      id
      title
      status
      statusDisplay
      lang
      langName: langVerboseName
      runtime
      memory
      timestamp
      frontendId
      url
      isPending
    }
  }
}`;

export async function fetchSubmissionList(
  slug,
  { session = "", offset = 0, limit = 20, fetchImpl = fetch, timeoutMs = 20000 } = {},
) {
  const data = await lcGraphql(
    SUBMISSION_LIST_QUERY,
    { offset, limit, questionSlug: slug },
    { fetchImpl, session, timeoutMs },
  );
  const subs = data?.submissionList?.submissions ?? [];
  return subs.map((s) => ({
    id: String(s?.id ?? ""),
    title: s?.title ?? "",
    status: s?.status ?? "",
    statusDisplay: s?.statusDisplay ?? "",
    lang: s?.lang ?? "",
    langName: s?.langName ?? s?.lang ?? "",
    runtime: s?.runtime ?? "",
    memory: s?.memory ?? "",
    timestamp: s?.timestamp ?? "",
    frontendId: s?.frontendId ?? "",
    url: s?.url ?? "",
    isPending: s?.isPending ?? "",
  }));
}
