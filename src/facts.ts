/**
 * Day12：关键事实卡（D1.3）
 *
 * 摘要是有损散文；事实卡是旁路结构化状态，裁剪后仍强制留在上下文里。
 * TASK_FACTS=1 开启；TASK_FACTS_LLM=1 时额外用一次 LLM 合并（可选）。
 */
import { chat } from "./llm.js";
import type { Message } from "./types.js";

export type TaskFacts = {
  goal: string;
  paths: string[];
  /** 关键发现，如 secret_token=ALPHA-42 */
  notes: string[];
  todos: string[];
  failures: string[];
};

export const FACTS_MARKER = "[task facts]";

export function emptyFacts(goal = ""): TaskFacts {
  return {
    goal: goal.trim(),
    paths: [],
    notes: [],
    todos: [],
    failures: [],
  };
}

export function factsEnabled(override?: boolean): boolean {
  if (override != null) return override;
  const v = (process.env.TASK_FACTS ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function factsLlmEnabled(): boolean {
  const v = (process.env.TASK_FACTS_LLM ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function uniqPush(list: string[], item: string, max = 20): void {
  const t = item.trim();
  if (!t) return;
  if (list.some((x) => x.toLowerCase() === t.toLowerCase())) return;
  list.push(t);
  if (list.length > max) list.splice(0, list.length - max);
}

function scanText(facts: TaskFacts, text: string): void {
  if (!text) return;

  for (const m of text.matchAll(
    /(?:^|[\s"'`])((?:[\w.-]+\/)+[\w.-]+\.[a-zA-Z0-9]+)(?:$|[\s"'`])/g,
  )) {
    uniqPush(facts.paths, m[1]);
  }
  for (const m of text.matchAll(
    /"path"\s*:\s*"([^"]+)"/g,
  )) {
    uniqPush(facts.paths, m[1]);
  }

  // 值只收「像标识符/短码」的字符，避免 JSON 里 \nxxxx 噪声被吸进来
  for (const m of text.matchAll(
    /\b([A-Za-z_][\w-]{2,40})\s*=\s*([A-Za-z0-9._+-]{1,64})/g,
  )) {
    const key = m[1];
    const val = m[2];
    if (key.length <= 2) continue;
    if (/^x+$/i.test(val)) continue;
    uniqPush(facts.notes, `${key}=${val}`);
  }

  if (/拒绝|denied|error|失败|fail/i.test(text)) {
    const line = text.split(/\r?\n/).find((l) => /拒绝|denied|error|失败|fail/i.test(l));
    if (line) uniqPush(facts.failures, line.slice(0, 160));
  }
}

/** 规则抽取：不调模型，稳定、便宜，适合演示兜底 */
export function updateFactsHeuristic(
  prev: TaskFacts,
  messages: Message[],
): TaskFacts {
  const facts: TaskFacts = {
    goal: prev.goal,
    paths: [...prev.paths],
    notes: [...prev.notes],
    todos: [...prev.todos],
    failures: [...prev.failures],
  };

  for (const m of messages) {
    if (m.role === "system") continue;
    if (
      m.role === "user" &&
      typeof m.content === "string" &&
      (m.content.startsWith("[context ") ||
        m.content.startsWith(FACTS_MARKER) ||
        m.content.startsWith("[long-term memory]"))
    ) {
      continue; // 跳过裁剪通知 / 事实卡 / 长期记忆卡，避免自我循环污染
    }

    if (m.role === "user" && !facts.goal && m.content) {
      facts.goal = m.content.trim().slice(0, 200);
    }

    if (m.tool_calls) {
      for (const c of m.tool_calls) {
        scanText(facts, c.function.arguments);
        if (c.function.name === "ask_user") {
          uniqPush(facts.todos, "等待用户澄清（ask_user）");
        }
      }
    }
    if (m.content) scanText(facts, m.content);
  }

  return facts;
}

function extractJsonObject(text: string): Partial<TaskFacts> | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Partial<TaskFacts>;
  } catch {
    return null;
  }
}

function mergePartial(base: TaskFacts, patch: Partial<TaskFacts>): TaskFacts {
  const next = { ...base, paths: [...base.paths], notes: [...base.notes], todos: [...base.todos], failures: [...base.failures] };
  if (patch.goal?.trim()) next.goal = patch.goal.trim();
  for (const p of patch.paths ?? []) uniqPush(next.paths, p);
  for (const n of patch.notes ?? []) uniqPush(next.notes, n);
  for (const t of patch.todos ?? []) uniqPush(next.todos, t);
  for (const f of patch.failures ?? []) uniqPush(next.failures, f);
  return next;
}

/** 可选：再调一次 LLM，把近期消息合并进事实卡 */
export async function updateFactsViaLlm(
  prev: TaskFacts,
  recent: Message[],
): Promise<TaskFacts> {
  const slim = recent
    .filter((m) => m.role !== "system")
    .slice(-12)
    .map((m, i) => {
      const bits = [`#${i + 1} ${m.role}`];
      if (m.tool_calls?.length) {
        bits.push(
          "calls=" +
          m.tool_calls
            .map((c) => `${c.function.name}(${c.function.arguments.slice(0, 120)})`)
            .join("; "),
        );
      }
      if (m.content) {
        bits.push(m.content.length > 400 ? m.content.slice(0, 400) + "…" : m.content);
      }
      return bits.join("\n");
    })
    .join("\n\n");

  const turn = await chat(
    [
      {
        role: "system",
        content:
          "你是事实抽取器。只输出一个 JSON 对象，不要 markdown，不要解释。字段：goal, paths, notes, todos, failures（皆字符串或字符串数组）。只写对话里出现过的信息。",
      },
      {
        role: "user",
        content: [
          "当前事实卡：",
          JSON.stringify(prev, null, 2),
          "",
          "近期对话：",
          slim,
          "",
          "请输出合并后的完整 JSON。",
        ].join("\n"),
      },
    ],
    undefined,
  );

  const patch = extractJsonObject(turn.content ?? "");
  if (!patch) return prev;
  return mergePartial(prev, patch);
}

export function renderFactsCard(facts: TaskFacts): string {
  const lines = [
    `${FACTS_MARKER} 以下为任务关键事实（结构化，优先级高于模糊记忆；裁剪后仍保留）：`,
    `- goal: ${facts.goal || "（未记录）"}`,
    `- paths: ${facts.paths.length ? facts.paths.join(", ") : "（无）"}`,
    `- notes: ${facts.notes.length ? facts.notes.join("; ") : "（无）"}`,
    `- todos: ${facts.todos.length ? facts.todos.join("; ") : "（无）"}`,
    `- failures: ${facts.failures.length ? facts.failures.join("; ") : "（无）"}`,
  ];
  return lines.join("\n");
}

/** 把事实卡插在 system 之后；若已有旧卡则替换 */
export function upsertFactsMessage(
  messages: Message[],
  card: string,
): Message[] {
  const factMsg: Message = { role: "user", content: card };
  // 显式 Message[]：避免 map 把 tool_calls 推成「必有键」导致无法赋回普通 Message
  const out: Message[] = messages.map((m) => ({
    ...m,
    tool_calls: m.tool_calls?.map((c) => ({
      ...c,
      function: { ...c.function },
    })),
  }));

  const idx = out.findIndex(
    (m) =>
      m.role === "user" &&
      typeof m.content === "string" &&
      m.content.startsWith(FACTS_MARKER),
  );
  if (idx >= 0) {
    out[idx] = factMsg;
    return out;
  }

  if (out[0]?.role === "system") {
    out.splice(1, 0, factMsg);
  } else {
    out.unshift(factMsg);
  }
  return out;
}

export async function refreshFacts(
  prev: TaskFacts,
  messages: Message[],
): Promise<TaskFacts> {
  let next = updateFactsHeuristic(prev, messages);
  if (factsLlmEnabled()) {
    try {
      next = await updateFactsViaLlm(next, messages);
    } catch {
      // 启发式结果仍可用
    }
  }
  return next;
}
