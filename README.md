# mini-cursor

手写编码 Agent。当前：**Day 12（关键事实抽取）**。

## 命令

```bash
npm start
npm run server
npm run demo:day11          # 丢弃 vs 摘要
npm run demo:day12          # 丢弃 vs 事实卡
npm run eval
npm run replay -- traces/xxx.json
```

## Day12 要点

- `TASK_FACTS=1`：维护 goal/paths/notes/todos/failures，裁剪后钉回上下文  
- `TASK_FACTS_LLM=1`：可选再用 LLM 合并  
- 与 Day11 摘要互补：摘要保叙事，事实卡保关键值  

课时笔记见 [`lessons/`](./lessons/)。
