import { summarizeDroppedMessages } from "./summarize.js";
import type { Message } from "./types.js";

export type TrimOptions = {
  /** 整段 messages 字符预算（近似，非精确 tokenizer） */
  maxChars?: number;
  /** 单条 tool 结果最大字符；超出截断并标注 */
  maxToolContentChars?: number;
  /**
   * Day11：丢弃较早消息时，是否对丢弃段做 LLM 摘要。
   * 默认读环境变量 CONTEXT_SUMMARY（1/true 开启）。
   */
  summarize?: boolean;
};

export type TrimStats = {
  beforeChars: number;
  afterChars: number;
  truncatedToolMessages: number;
  droppedMessages: number;
  didTrim: boolean;
  /** 是否成功写入了 LLM 摘要（失败回退占位时为 false） */
  summarized: boolean;
};

const DEFAULT_MAX_CHARS = 20_000;
const DEFAULT_MAX_TOOL = 2_500;

function envFlagTrue(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function resolveMaxChars(override?: number): number {
  if (override != null) return override;
  const raw = process.env.CONTEXT_MAX_CHARS?.trim();
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  return DEFAULT_MAX_CHARS;
}

export function resolveMaxToolChars(override?: number): number {
  if (override != null) return override;
  const raw = process.env.CONTEXT_MAX_TOOL?.trim();
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  return DEFAULT_MAX_TOOL;
}

export function resolveSummarize(override?: boolean): boolean {
  if (override != null) return override;
  return envFlagTrue("CONTEXT_SUMMARY");
}

function messageChars(m: Message): number {
  let n = (m.content ?? "").length;
  if (m.tool_calls) {
    for (const c of m.tool_calls) {
      n += c.id.length + c.function.name.length + c.function.arguments.length;
    }
  }
  if (m.tool_call_id) n += m.tool_call_id.length;
  if (m.name) n += m.name.length;
  return n + 16; // role 等开销的粗算
}

export function estimateMessagesChars(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + messageChars(m), 0);
}

function cloneMessages(messages: Message[]): Message[] {
  return messages.map((m) => ({
    ...m,
    tool_calls: m.tool_calls?.map((c) => ({
      ...c,
      function: { ...c.function },
    })),
  }));
}

/** 把过大的 tool 输出截断（保留头部，方便模型仍看到文件开头） */
function shrinkToolContents(messages: Message[], maxTool: number): number {
  let truncated = 0;
  for (const m of messages) {
    if (m.role !== "tool" || m.content == null) continue;
    if (m.content.length <= maxTool) continue;
    const original = m.content.length;
    m.content =
      m.content.slice(0, maxTool) +
      `\n...[truncated tool output, original_chars=${original}]`;
    truncated += 1;
  }
  return truncated;
}

function dropPlaceholder(droppedCount: number): Message {
  return {
    role: "user",
    content: `[context trimmed] 已省略更早的 ${droppedCount} 条消息（多为旧的工具输出）。请依据剩余上下文与项目规则继续。`,
  };
}

function summaryNotice(droppedCount: number, summary: string): Message {
  return {
    role: "user",
    content: `[context summary] 以下为更早 ${droppedCount} 条消息的压缩摘要，请据此继续任务：\n${summary}`,
  };
}

/**
 * 从尾部保留消息，直到接近预算。
 * 保证不以孤立的 tool 消息开头（前面必须有带 tool_calls 的 assistant）。
 */
function keepTailWithinBudget(
  messages: Message[],
  maxChars: number,
): {
  systems: Message[];
  keptTail: Message[];
  dropped: Message[];
} {
  const systems = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const systemCost = estimateMessagesChars(systems);
  const noticeBudget = 600; // 摘要可能比「省略 N 条」长
  let budget = Math.max(0, maxChars - systemCost - noticeBudget);

  if (estimateMessagesChars(rest) <= budget) {
    return { systems, keptTail: rest, dropped: [] };
  }

  const picked: Message[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = rest[i];
    const cost = messageChars(m);
    if (picked.length > 0 && cost > budget) break;
    picked.push(m);
    budget -= cost;
  }
  picked.reverse();

  // 若以 tool 开头，继续向前补上对应的 assistant(tool_calls)
  while (picked.length > 0 && picked[0].role === "tool") {
    const idx = rest.indexOf(picked[0]);
    let found = false;
    for (let j = idx - 1; j >= 0; j--) {
      if (rest[j].role === "assistant" && rest[j].tool_calls?.length) {
        if (!picked.includes(rest[j])) {
          picked.unshift(rest[j]);
        }
        found = true;
        break;
      }
    }
    if (!found) {
      picked.shift();
    }
  }

  const pickedSet = new Set(picked);
  const dropped = rest.filter((m) => !pickedSet.has(m));
  return { systems, keptTail: picked, dropped };
}

async function buildNotice(
  dropped: Message[],
  wantSummarize: boolean,
): Promise<{ notice: Message; summarized: boolean }> {
  if (dropped.length === 0) {
    return { notice: dropPlaceholder(0), summarized: false };
  }
  if (!wantSummarize) {
    return { notice: dropPlaceholder(dropped.length), summarized: false };
  }
  try {
    const summary = await summarizeDroppedMessages(dropped);
    return {
      notice: summaryNotice(dropped.length, summary),
      summarized: true,
    };
  } catch {
    return { notice: dropPlaceholder(dropped.length), summarized: false };
  }
}

/**
 * D1：在调用 LLM 前裁剪上下文（Day11 起为 async）。
 * 策略：① 截断过长 tool → ② 仍超预算则丢弃较早消息；可选对丢弃段做摘要。
 * 返回新数组，不修改入参。
 */
export async function trimMessages(
  messages: Message[],
  opts: TrimOptions = {},
): Promise<{ messages: Message[]; stats: TrimStats }> {
  const maxChars = resolveMaxChars(opts.maxChars);
  const maxTool = resolveMaxToolChars(opts.maxToolContentChars);
  const wantSummarize = resolveSummarize(opts.summarize);

  const beforeChars = estimateMessagesChars(messages);
  const next = cloneMessages(messages);

  const truncatedToolMessages = shrinkToolContents(next, maxTool);
  const { systems, keptTail, dropped } = keepTailWithinBudget(next, maxChars);

  let summarized = false;
  let kept: Message[];
  if (dropped.length === 0) {
    kept = [...systems, ...keptTail];
  } else {
    const built = await buildNotice(dropped, wantSummarize);
    summarized = built.summarized;
    kept = [...systems, built.notice, ...keptTail];
  }

  const afterChars = estimateMessagesChars(kept);

  return {
    messages: kept,
    stats: {
      beforeChars,
      afterChars,
      truncatedToolMessages,
      droppedMessages: dropped.length,
      didTrim:
        truncatedToolMessages > 0 ||
        dropped.length > 0 ||
        afterChars < beforeChars,
      summarized,
    },
  };
}
