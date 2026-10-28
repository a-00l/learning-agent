/**
 * Day11 对照演示：同一段超长 messages，分别「只丢弃」vs「丢弃+摘要」。
 *
 *   npm run demo:day11
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { estimateMessagesChars, trimMessages } from "./context.js";
import type { Message } from "./types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv(path.join(root, ".env"));

/** 伪造一段「目标在前、大段 tool 噪声在中、最近问题在尾」的历史 */
function buildFatHistory(): Message[] {
  const noise = "x".repeat(800);
  const msgs: Message[] = [
    {
      role: "system",
      content: "你是编码助手。工作区 /playground。",
    },
    {
      role: "user",
      content: "目标：最终告诉我 secret_token 的值；它写在配置备注里。路径是 notes/secret.md。",
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
        content: "secret_token=ALPHA-42\n（后面是噪声）\n" + noise,
      }),
    },
    {
      role: "assistant",
      content: "已读到 secret_token=ALPHA-42，先去做别的探索。",
    },
  ];

  // 中间塞多轮无关键噪声，逼迫裁剪丢掉开头
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
    content: "好了，secret_token 到底是什么？只根据已知上下文回答。",
  });
  return msgs;
}

function noticePreview(messages: Message[]): string {
  const hit = messages.find(
    (m) =>
      m.role === "user" &&
      typeof m.content === "string" &&
      (m.content.startsWith("[context trimmed]") ||
        m.content.startsWith("[context summary]")),
  );
  if (!hit?.content) return "（无裁剪通知）";
  return hit.content.length > 500
    ? hit.content.slice(0, 500) + "…"
    : hit.content;
}

async function main() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error("缺少 OPENAI_API_KEY");
    process.exit(1);
  }

  const fat = buildFatHistory();
  const maxChars = Number(process.env.CONTEXT_MAX_CHARS || 3500);
  console.log(`原始消息 ${fat.length} 条，约 ${estimateMessagesChars(fat)} chars`);
  console.log(`预算 CONTEXT_MAX_CHARS=${maxChars}\n`);

  console.log("—— A：只丢弃（无摘要）——");
  const a = await trimMessages(fat, { maxChars, summarize: false });
  console.log(
    `after=${a.stats.afterChars} dropped=${a.stats.droppedMessages} summarized=${a.stats.summarized}`,
  );
  console.log(noticePreview(a.messages));
  console.log();

  console.log("—— B：丢弃 + LLM 摘要 ——");
  const b = await trimMessages(fat, { maxChars, summarize: true });
  console.log(
    `after=${b.stats.afterChars} dropped=${b.stats.droppedMessages} summarized=${b.stats.summarized}`,
  );
  console.log(noticePreview(b.messages));
  console.log();

  const aHas = noticePreview(a.messages).includes("ALPHA-42");
  const bHas = noticePreview(b.messages).includes("ALPHA-42");
  console.log(`丢弃占位是否含 ALPHA-42: ${aHas}`);
  console.log(`摘要是否含 ALPHA-42: ${bHas}`);
  console.log(
    bHas && !aHas
      ? "\n结论：摘要保住了关键事实；纯丢弃占位没有。"
      : "\n结论：请人工看上面两段通知（模型有时摘要也会漏；或噪声未挤掉目标段）。",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
