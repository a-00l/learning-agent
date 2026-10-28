/**
 * Day11：把即将丢弃的消息压成短摘要（再调一次 LLM，无 tools）。
 */
import { chat } from "./llm.js";
import type { Message } from "./types.js";

const MAX_INPUT_CHARS = 12_000;
const MAX_SUMMARY_HINT = 400;

function formatMessageForSummary(m: Message, index: number): string {
  const parts: string[] = [`#${index} role=${m.role}`];
  if (m.tool_calls?.length) {
    const calls = m.tool_calls
      .map((c) => `${c.function.name}(${c.function.arguments.slice(0, 200)})`)
      .join("; ");
    parts.push(`tool_calls: ${calls}`);
  }
  if (m.tool_call_id) parts.push(`tool_call_id=${m.tool_call_id}`);
  const body = (m.content ?? "").trim();
  if (body) {
    parts.push(body.length > 800 ? body.slice(0, 800) + "…[截断]" : body);
  }
  return parts.join("\n");
}

/** 拼成给摘要模型看的纯文本（控制长度，避免摘要调用本身爆窗） */
export function renderDroppedForSummary(dropped: Message[]): string {
  const chunks: string[] = [];
  let used = 0;
  for (let i = 0; i < dropped.length; i++) {
    const block = formatMessageForSummary(dropped[i], i + 1);
    if (used + block.length + 2 > MAX_INPUT_CHARS) {
      chunks.push(`…另有 ${dropped.length - i} 条未送入摘要模型`);
      break;
    }
    chunks.push(block);
    used += block.length + 2;
  }
  return chunks.join("\n\n");
}

/**
 * 对丢弃段做一次无工具的 chat，返回纯文本摘要。
 * 失败时抛错，由调用方回退到「省略 N 条」占位。
 */
export async function summarizeDroppedMessages(
  dropped: Message[],
): Promise<string> {
  if (dropped.length === 0) return "（无内容）";

  const transcript = renderDroppedForSummary(dropped);
  const turn = await chat(
    [
      {
        role: "system",
        content:
          "你是上下文压缩器。只输出摘要正文，不要前言后语，不要调用工具。",
      },
      {
        role: "user",
        content: [
          `把下列 Agent 对话片段压成中文要点（建议不超过 ${MAX_SUMMARY_HINT} 字）。`,
          "必须尽量保留：用户目标；已确认路径/文件名；已完成操作与结果；失败或拒绝原因；未完成待办。",
          "禁止编造片段中没有的信息。",
          "",
          "—— 片段开始 ——",
          transcript,
          "—— 片段结束 ——",
        ].join("\n"),
      },
    ],
    undefined,
  );

  const text = (turn.content ?? "").trim();
  if (!text) {
    throw new Error("摘要模型返回空内容");
  }
  return text;
}
