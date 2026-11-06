import { strWidth, isChineseEnv, style } from "./utils.js";

const DIFFICULTY = {
  EASY: { cn: "简单", en: "EASY", color: "green" },
  MEDIUM: { cn: "中等", en: "MID", color: "yellow" },
  HARD: { cn: "困难", en: "HARD", color: "red" },
};

const LIST_TABLE_HEADER_ZH = {
  DIFFICULTY: "难度",
  STATUS: "状态",
  SLUG: "题号",
  TITLE: "标题",
  COUNT: "次数",
  RECENT_SUBMIT: "最近提交",
};

const LIST_TABLE_HEADER_EN = {
  DIFFICULTY: "DIFFICULTY",
  STATUS: "STATUS",
  SLUG: "SLUG",
  TITLE: "TITLE",
  COUNT: "COUNT",
  RECENT_SUBMIT: "RECENT_SUBMIT",
};

export function resolveTitle(q, zh) {
  const a = zh ? q?.titleCn : q?.title;
  const b = zh ? q?.title : q?.titleCn;
  return a || b || q?.titleSlug || "";
}

export function renderTable(header, rows, { style: st = style } = {}) {
  if (!rows || rows.length === 0) return "";
  const widths = header.map((h, i) =>
    Math.max(strWidth(h), ...rows.map((r) => strWidth(r[i].plain)))
  );
  const rule = (l, mid, r) => l + widths.map((w) => "─".repeat(w + 2)).join(mid) + r;
  const fmt = (cells) =>
    "│ " + cells.map((c, i) => c.styled + " ".repeat(Math.max(0, widths[i] - strWidth(c.plain)))).join(" │ ") + " │";
  return [
    rule("┌", "┬", "┐"),
    fmt(header.map((h) => ({ plain: h, styled: st.bold(h) }))),
    rule("├", "┼", "┤"),
    ...rows.map(fmt),
    rule("└", "┴", "┘"),
  ].join("\n");
}

export function renderList(questions, { style: st = style, zh = isChineseEnv(), solved } = {}) {
  if (!questions || questions.length === 0) return zh ? "无匹配题目" : "No matching problems";
  const header_dict = zh ? LIST_TABLE_HEADER_ZH : LIST_TABLE_HEADER_EN;
  const header = solved
    ? [header_dict.DIFFICULTY, header_dict.STATUS, header_dict.TITLE, header_dict.SLUG]
    : [header_dict.DIFFICULTY, header_dict.TITLE, header_dict.SLUG];
  const rows = questions.map((q) => {
    const d = difficultyLabel(q.difficulty);
    const d_tag = zh ? d.cn : d.en;
    const cells = [{ plain: d_tag, styled: st[d.color](d_tag) }];
    if (solved) {
      cells.push(solved.has(q.titleSlug)
        ? { plain: "✓", styled: st.green("✓") }
        : { plain: "", styled: "" });
    }
    cells.push(
      { plain: resolveTitle(q, zh), styled: resolveTitle(q, zh) },
      { plain: q.titleSlug ?? "", styled: st.dim(q.titleSlug ?? "") },
    );
    return cells;
  });
  return renderTable(header, rows, { style: st });
}

export function renderProgressSummary(solved, { style: st = style, zh = isChineseEnv() } = {}) {
  const count = (d) => solved.filter((s) => s.difficulty === d).length;
  if (zh) {
    return `已解决 ${solved.length} · 简单 ${count("EASY")} · 中等 ${count("MEDIUM")} · 困难 ${count("HARD")}`;
  }
  return `Solved ${solved.length} · EASY ${count("EASY")} · MID ${count("MEDIUM")} · HARD ${count("HARD")}`;
}

export function renderSolvedTable(solved, { style: st = style, zh = isChineseEnv(), difficulty, limit, offset = 0 } = {}) {
  let rows = solved;
  if (difficulty) rows = rows.filter((s) => s.difficulty === difficulty);
  if (limit != null) rows = rows.slice(offset, offset + limit);
  if (!rows || rows.length === 0) return zh ? "暂无已解决题目" : "No solved problems";
  const header_dict = zh ? LIST_TABLE_HEADER_ZH : LIST_TABLE_HEADER_EN;
  const header = [header_dict.DIFFICULTY, header_dict.TITLE, header_dict.SLUG, header_dict.RECENT_SUBMIT, header_dict.COUNT];
  const table = rows.map((s) => {
    const d = difficultyLabel(s.difficulty);
    const label = zh ? d.cn : d.en;
    const date = String(s.lastSubmittedAt ?? "").slice(0, 10);
    return [
      { plain: label, styled: st[d.color](label) },
      { plain: resolveTitle(s, zh), styled: resolveTitle(s, zh) },
      { plain: s.slug ?? "", styled: st.dim(s.slug ?? "") },
      { plain: date, styled: st.dim(date) },
      { plain: String(s.numSubmitted ?? ""), styled: String(s.numSubmitted ?? "") },
    ];
  });
  return renderTable(header, table, { style: st });
}

export function difficultyLabel(difficulty) {
  const key = String(difficulty ?? "").toUpperCase();
  if (DIFFICULTY[key]) return DIFFICULTY[key];
  return { cn: String(difficulty ?? "未知"), en: String(difficulty ?? "UNKNOWN"), color: "dim" };
}

// 提交判定的状态枚举（leetcode.cn 的 status 字段）
const SUBMISSION_STATUS = {
  AC:  { cn: "通过",     en: "Accepted",              color: "green" },
  WA:  { cn: "答案错误", en: "Wrong Answer",          color: "red" },
  TLE: { cn: "超时",     en: "Time Limit Exceeded",   color: "yellow" },
  MLE: { cn: "内存超限", en: "Memory Limit Exceeded", color: "yellow" },
  RE:  { cn: "运行错误", en: "Runtime Error",         color: "red" },
  CE:  { cn: "编译错误", en: "Compile Error",         color: "red" },
  SE:  { cn: "系统错误", en: "System Error",          color: "red" },
};

export function submissionStatusLabel(status) {
  const key = String(status ?? "").toUpperCase();
  if (SUBMISSION_STATUS[key]) return SUBMISSION_STATUS[key];
  return { cn: String(status ?? ""), en: String(status ?? ""), color: "dim" };
}

// 秒级 Unix 时间戳 → 本地时间 "YYYY-MM-DD HH:MM:SS"
export function formatTimestamp(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return String(ts ?? "");
  const d = new Date(n * 1000);
  const p = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const HISTORY_HEADER_ZH = {
  TIME: "提交时间", STATUS: "状态", LANG: "语言", RUNTIME: "耗时",
  MEMORY: "内存", BEAT: "击败%", CASES: "用例", ID: "ID",
};

const HISTORY_HEADER_EN = {
  TIME: "TIME", STATUS: "STATUS", LANG: "LANG", RUNTIME: "RUNTIME",
  MEMORY: "MEMORY", BEAT: "BEAT %", CASES: "CASES", ID: "ID",
};

const DASH = "—";

// 击败百分位：0 表示该次提交没有有效百分位（如编译/运行错误），显示占位符
function percentileText(v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return DASH;
  return `${v.toFixed(1)}%`;
}

function casesText(passed, total) {
  if (typeof passed !== "number" || typeof total !== "number") return DASH;
  return `${passed}/${total}`;
}

export function renderHistoryTable(submissions, { style: st = style, zh = isChineseEnv() } = {}) {
  if (!submissions || submissions.length === 0) return zh ? "暂无提交记录" : "No submissions";
  const h = zh ? HISTORY_HEADER_ZH : HISTORY_HEADER_EN;
  const header = [h.TIME, h.STATUS, h.LANG, h.RUNTIME, h.MEMORY, h.BEAT, h.CASES, h.ID];
  const rows = submissions.map((s) => {
    const key = String(s?.status ?? "").toUpperCase();
    const known = SUBMISSION_STATUS[key];
    let statusCell;
    if (!known) {
      statusCell = { plain: s?.status ?? "", styled: st.dim(s?.status ?? "") };
    } else {
      const text = zh ? known.cn : known.en;
      const mark = key === "AC" ? "✓" : "✗";
      const color = key === "AC" ? "green" : known.color;
      const plain = `${mark} ${text}`;
      statusCell = { plain, styled: st[color](plain) };
    }
    const time = formatTimestamp(s?.timestamp);
    const beat = percentileText(s?.runtimePercentile);
    const cases = casesText(s?.passedTestCaseCnt, s?.totalTestCaseCnt);
    const langName = s?.langName || s?.lang || "";
    return [
      { plain: time, styled: st.dim(time) },
      statusCell,
      { plain: langName, styled: langName },
      { plain: s?.runtime || DASH, styled: s?.runtime || DASH },
      { plain: s?.memory || DASH, styled: s?.memory || DASH },
      { plain: beat, styled: beat },
      { plain: cases, styled: cases },
      { plain: s?.id ?? "", styled: st.dim(s?.id ?? "") },
    ];
  });
  return renderTable(header, rows, { style: st });
}

const DETAIL_LABEL_ZH = {
  time: "时间", lang: "语言", runtime: "耗时", memory: "内存", cases: "用例",
  code: "源码", fail: "首个失败用例", input: "输入", expect: "期望", actual: "实际",
  err: "错误",
};

const DETAIL_LABEL_EN = {
  time: "Time", lang: "Language", runtime: "Runtime", memory: "Memory", cases: "Cases",
  code: "Code", fail: "First failing case", input: "Input", expect: "Expected", actual: "Actual",
  err: "Error",
};

function beatSuffix(v, zh) {
  const text = percentileText(v);
  if (text === DASH) return "";
  return zh ? `（击败 ${text}）` : ` (beat ${text})`;
}

export function renderSubmissionDetail(d, { style: st = style, zh = isChineseEnv() } = {}) {
  if (!d) return zh ? "未找到提交" : "Submission not found";
  const L = zh ? DETAIL_LABEL_ZH : DETAIL_LABEL_EN;
  const lines = [];
  // 标签按显示宽度对齐（中文占 2 列，英文标签长度不一）
  const labelWidth = Math.max(
    strWidth(L.time), strWidth(L.lang), strWidth(L.runtime), strWidth(L.memory), strWidth(L.cases),
  );
  const padFor = (label) => " ".repeat(labelWidth - strWidth(label) + 2);
  lines.push(`  ${st.bold(String(d.id ?? ""))}  ${st.dim(d.statusDisplay ?? "")}`);
  lines.push(`  ${st.dim(L.time)}${padFor(L.time)}${formatTimestamp(d.timestamp)}`);
  lines.push(`  ${st.dim(L.lang)}${padFor(L.lang)}${d.langName || d.lang || ""}`);
  lines.push(`  ${st.dim(L.runtime)}${padFor(L.runtime)}${d.runtime || DASH}${beatSuffix(d.runtimePercentile, zh)}`);
  lines.push(`  ${st.dim(L.memory)}${padFor(L.memory)}${d.memory || DASH}${beatSuffix(d.memoryPercentile, zh)}`);
  lines.push(`  ${st.dim(L.cases)}${padFor(L.cases)}${casesText(d.passedTestCaseCnt, d.totalTestCaseCnt)}`);

  const od = d.outputDetail ?? {};
  const errText = od.compileError || od.runtimeError || "";
  if (errText) {
    lines.push("");
    lines.push(`  ${st.red(L.err)}`);
    for (const l of String(errText).replace(/\s+$/, "").split("\n")) lines.push(`    ${st.red(l)}`);
  }

  lines.push("");
  lines.push(`  ${st.bold(L.code)}`);
  for (const l of String(d.code ?? "").replace(/\s+$/, "").split("\n")) {
    lines.push(l ? `    ${l}` : "");
  }

  const failRows = [
    [L.input, od.input],
    [L.expect, od.expectedOutput],
    [L.actual, od.codeOutput],
  ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "");
  if (failRows.length) {
    lines.push("");
    lines.push(`  ${st.yellow(L.fail)}`);
    for (const [k, v] of failRows) lines.push(`    ${st.dim(k)}  ${String(v).split("\n")[0]}`);
  }
  return lines.join("\n");
}
