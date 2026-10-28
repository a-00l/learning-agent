/**
 * Day12 对照：裁剪丢掉早期消息后，
 *   A) 只有 trimmed 占位 → 丢失 ALPHA-42
 *   B) 钉上事实卡 → 仍能看见 ALPHA-42
 *
 *   npm run demo:day12
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  emptyFacts,
  renderFactsCard,
  updateFactsHeuristic,
  upsertFactsMessage,
} from "./facts.js";
import { estimateMessagesChars, trimMessages } from "./context.js";
import type { Message } from "./types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
void root;

function buildFatHistory(): Message[] {
  const noise = "x".repeat(800);
  const msgs: Message[] = [
    { role: "system", content: "你是编码助手。" },
    {
      role: "user",
      content:
        "目标：最终告诉我 secret_token 的值；路径 notes/secret.md。",
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: {
            name: "read_file",
            arguments: JSON.stringify({ path: "notes/secret.md" }),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "c1",
      content: JSON.stringify({
        ok: true,
        content: "secret_token=ALPHA-42\n" + noise,
      }),
    },
    {
      role: "assistant",
      content: "已读到 secret_token=ALPHA-42。",
    },
  ];

  for (let i = 0; i < 6; i++) {
    const id = `n${i}`;
    msgs.push({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id,
          type: "function",
          function: {
            name: "read_file",
            arguments: JSON.stringify({ path: `noise/file-${i}.txt` }),
          },
        },
      ],
    });
    msgs.push({
      role: "tool",
      tool_call_id: id,
      content: JSON.stringify({ ok: true, content: `noise-${i}: ${noise}` }),
    });
  }

  msgs.push({
    role: "user",
    content: "secret_token 是什么？只根据上下文回答。",
  });
  return msgs;
}

function findFactsOrTrim(messages: Message[]): string {
  for (const m of messages) {
    if (m.role !== "user" || typeof m.content !== "string") continue;
    if (
      m.content.startsWith("[task facts]") ||
      m.content.startsWith("[context trimmed]") ||
      m.content.startsWith("[context summary]")
    ) {
      return m.content.length > 420 ? m.content.slice(0, 420) + "…" : m.content;
    }
  }
  return "（未找到）";
}

async function main() {
  const fat = buildFatHistory();
  const maxChars = Number(process.env.CONTEXT_MAX_CHARS || 3500);
  console.log(
    `原始 ${fat.length} 条，约 ${estimateMessagesChars(fat)} chars；预算 ${maxChars}\n`,
  );

  const facts = updateFactsHeuristic(emptyFacts(), fat);
  console.log("—— 启发式抽出的事实卡 ——");
  console.log(renderFactsCard(facts));
  console.log();

  console.log("—— A：只丢弃，不钉事实卡 ——");
  const a = await trimMessages(fat, { maxChars, summarize: false });
  console.log(findFactsOrTrim(a.messages));
  console.log(
    `含 ALPHA-42: ${a.messages.some((m) => (m.content ?? "").includes("ALPHA-42"))}`,
  );
  console.log();

  console.log("—— B：丢弃后钉上事实卡 ——");
  const bMsgs = upsertFactsMessage(a.messages, renderFactsCard(facts));
  console.log(findFactsOrTrim(bMsgs));
  console.log(
    `含 ALPHA-42: ${bMsgs.some((m) => (m.content ?? "").includes("ALPHA-42"))}`,
  );
  console.log(
    facts.notes.some((n) => n.includes("ALPHA-42"))
      ? "\n结论：事实卡在裁剪后仍保住关键值；纯丢弃占位没有。"
      : "\n结论：请检查启发式是否识别到 secret_token。",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
