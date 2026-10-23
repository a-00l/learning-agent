# mini-cursor

手写编码 Agent。当前：**Day 7（Checkpoint + SSE）**。

## 命令

```bash
npm start           # CLI：流式输出 + 自动 checkpoint；resume <id> / cps
npm run server      # HTTP SSE：http://127.0.0.1:8787
npm run replay -- traces/xxx.json
npm run eval
```

## 架构摘要

- **主路径**：loop ↔ 流式 LLM ↔ tools  
- **旁路**：Trace 落盘  
- **存档**：Checkpoint 保存完整 `messages`，续跑时加载回对话  
- **SSE**：`server.ts` 把 step/token/done 推给浏览器  

课时笔记见 [`lessons/`](./lessons/)。
