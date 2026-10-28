# mini-cursor

手写编码 Agent。当前：**Day 9（Prompt 与工具描述）**。

## 命令

```bash
npm start                 # CLI（PROMPT_PROFILE=good|sloppy）
npm run server            # SSE 演示页
npm run eval              # 默认题库
npm run eval:day9:good    # Day9 题库 + 好 prompt
npm run eval:day9:sloppy  # Day9 题库 + 差 prompt（对照）
npm run replay -- traces/xxx.json
```

## Day9 要点

- `PROMPT_PROFILE=good|sloppy` 对照 system 质量  
- 工具 description 写清「适用 / 不适用」  
- `evals/cases-day9.json`：ask_user、grep 优先、抗 injection  

课时笔记见 [`lessons/`](./lessons/)。
