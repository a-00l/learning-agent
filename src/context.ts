import type { Message } from "./types.js";

export type TrimOptions = {
  /** 整段 messages 字符预算（近似，非精确 tokenizer） */
  maxChars?: number;
  /** 单条 tool 结果最大字符；超出截断并标注 */
  maxToolContentChars?: number;
};

export type TrimStats = {
  beforeChars: number;
  afterChars: number;
  truncatedToolMessages: number;
  droppedMessages: number;
  didTrim: boolean;
};

const DEFAULT_MAX_CHARS = 20_000;
const DEFAULT_MAX_TOOL = 2_500;

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

/**
 * 从尾部保留消息，直到接近预算。
 * 保证不以孤立的 tool 消息开头（前面必须有带 tool_calls 的 assistant）。
 */
function keepTailWithinBudget(messages: Message[], maxChars: number): {
  kept: Message[];
  dropped: number;
} {
  const systems = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const systemCost = estimateMessagesChars(systems);
  const noticeBudget = 120;
  let budget = Math.max(0, maxChars - systemCost - noticeBudget);

  if (estimateMessagesChars(rest) <= budget) {
    return { kept: messages, dropped: 0 };
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
    // rest 里往前找
    let found = false;
    for (let j = idx - 1; j >= 0; j--) {
      if (rest[j].role === "assistant" && rest[j].tool_calls?.length) {
        picked.unshift(rest[j]);
        found = true;
        break;
      }
    }
    if (!found) {
      // 实在补不上就丢掉这条孤儿 tool
      picked.shift();
    }
  }

  const dropped = rest.length - picked.length;
  if (dropped <= 0) {
    return { kept: [...systems, ...picked], dropped: 0 };
  }

  const notice: Message = {
    role: "user",
    content: `[context trimmed] 已省略更早的 ${dropped} 条消息（多为旧的工具输出）。请依据剩余上下文与项目规则继续。`,
  };

  return { kept: [...systems, notice, ...picked], dropped };
}

/**
 * D1：在调用 LLM 前裁剪上下文。
 * 策略：① 截断过长 tool 输出 → ② 仍超预算则丢弃较早消息（保留 system + 尾部）。
 * 返回新数组，不修改入参。
 */
export function trimMessages(
  messages: Message[],
  opts: TrimOptions = {},
): { messages: Message[]; stats: TrimStats } {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const maxTool = opts.maxToolContentChars ?? DEFAULT_MAX_TOOL;

  const beforeChars = estimateMessagesChars(messages);
  const next = cloneMessages(messages);

  const truncatedToolMessages = shrinkToolContents(next, maxTool);
  const { kept, dropped } = keepTailWithinBudget(next, maxChars);
  const afterChars = estimateMessagesChars(kept);

  return {
    messages: kept,
    stats: {
      beforeChars,
      afterChars,
      truncatedToolMessages,
      droppedMessages: dropped,
      didTrim: truncatedToolMessages > 0 || dropped > 0 || afterChars < beforeChars,
    },
  };
}
