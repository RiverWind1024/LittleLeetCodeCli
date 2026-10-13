import { strWidth } from "./utils.js";

const DIFFICULTY = {
  EASY: { cn: "简单", color: "green" },
  MEDIUM: { cn: "中等", color: "yellow" },
  HARD: { cn: "困难", color: "red" },
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
  if (!questions || questions.length === 0) return "无匹配题目";
  const header = solved ? ["难度", "状态", "标题", "slug"] : ["难度", "标题", "slug"];
  const rows = questions.map((q) => {
    const d = difficultyLabel(q.difficulty);
    const cells = [{ plain: d.cn, styled: st[d.color](d.cn) }];
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


export function renderProgressSummary(solved, { style: st = style } = {}) {
  const count = (d) => solved.filter((s) => s.difficulty === d).length;
  return `已解决 ${solved.length} · 简单 ${count("EASY")} · 中等 ${count("MEDIUM")} · 困难 ${count("HARD")}`;
}



export function renderSolvedTable(solved, { style: st = style, zh = isChineseEnv(), difficulty, limit, offset = 0 } = {}) {
  let rows = solved;
  if (difficulty) rows = rows.filter((s) => s.difficulty === difficulty);
  if (limit != null) rows = rows.slice(offset, offset + limit);
  if (!rows || rows.length === 0) return "暂无已解决题目";
  const header = ["难度", "标题", "slug", "最近提交", "次数"];
  const table = rows.map((s) => {
    const d = difficultyLabel(s.difficulty);
    const date = String(s.lastSubmittedAt ?? "").slice(0, 10);
    return [
      { plain: d.cn, styled: st[d.color](d.cn) },
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
  return { cn: String(difficulty ?? "未知"), color: "dim" };
}