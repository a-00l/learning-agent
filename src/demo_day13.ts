/**
 * Day13 演示：写入长期记忆 → 再「新开任务」读取并拼进 messages。
 *
 *   npm run demo:day13
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultMemoryPath,
  loadMemory,
  pickForPrompt,
  rememberFromUser,
  renderLongTermMemory,
  upsertLongTermMessage,
} from "./memory.js";
import type { Message } from "./types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoFile = path.join(root, "memory", "demo-day13.json");

async function main() {
  // 用独立 demo 文件，不污染正式 user.json
  try {
    await fs.promises.unlink(demoFile);
  } catch {
    /* ignore */
  }

  console.log(`记忆文件: ${demoFile}\n`);

  console.log("—— 写入（用户显式）——");
  const a = await rememberFromUser(demoFile, "记住：回复使用中文");
  const b = await rememberFromUser(demoFile, "记住：不要默认修改 hello.js");
  console.log("写入:", a?.text, "|", b?.text);

  const store = await loadMemory(demoFile);
  console.log("\n磁盘内容:");
  console.log(JSON.stringify(store, null, 2));

  console.log("\n—— 模拟新会话：load → pick → 拼进 messages ——");
  const picked = pickForPrompt(store, {
    query: "帮我改一下代码",
    limit: 5,
  });
  const card = renderLongTermMemory(picked);

  let messages: Message[] = [
    { role: "system", content: "你是 mini-cursor 助手。" },
    { role: "user", content: "帮我改一下代码" },
  ];
  messages = upsertLongTermMessage(messages, card);

  for (const m of messages) {
    const preview = (m.content ?? "").slice(0, 200);
    console.log(`\n[${m.role}]\n${preview}`);
  }

  console.log("\n正式路径默认:", defaultMemoryPath(root));
  console.log("开启注入: LONG_TERM_MEMORY=1 npm start");
  console.log("CLI 命令: 记住：… / 忘记：… / mem");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
