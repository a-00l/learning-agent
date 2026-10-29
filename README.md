# mini-cursor

手写编码 Agent。当前：**Day 13（长期记忆）**。

## 命令

```bash
npm start
npm run demo:day13          # 记住 → 读出 → 拼进 messages
npm run demo:day12
npm run demo:day11
npm run server
npm run eval
```

## Day13 要点

- `记住：…` 写入 `memory/user.json`（跨会话）  
- `LONG_TERM_MEMORY=1` 时新任务开场注入 `[long-term memory]`  
- `mem` 查看，`忘记：关键词` 删除  
- 尚非向量 RAG（D2.3）  

课时笔记见 [`lessons/`](./lessons/)。
