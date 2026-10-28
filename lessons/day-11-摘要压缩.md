# Day 11：摘要压缩（D1.2）

> 对应：D1.2  
> 代码：`src/summarize.ts`、`src/context.ts`、`src/demo_day11.ts`、`src/loop.ts`

---

## 本节目标

超预算时不只「省略 N 条」，而是对将丢弃的消息 **再调一次 LLM**，压成短摘要后塞回上下文，尽量保住目标与关键事实。

---

## 知识点

### 1. 压缩 ≠ 改写 system prompt

压缩对象是 **中间历史 messages**（旧的 user / assistant / tool）。  
`system` 与最近几轮通常原样保留。

### 2. 三级策略

| 级 | 做什么 |
|----|--------|
| ① 截断 | 单条 tool 过长 → 砍尾 |
| ② 丢弃 | 总量仍超 → 丢掉较早消息（Day4） |
| ③ 摘要 | 对丢弃段 `chat()` 无 tools → `[context summary]…`（Day11） |

摘要失败则回退到 Day4 的 `[context trimmed]` 占位。

### 3. 开关

```bash
CONTEXT_SUMMARY=1          # 开启摘要
CONTEXT_MAX_CHARS=3500     # 调小预算更容易触发
```

`npm run demo:day11` 会在同一份伪造历史上对照 A（只丢弃）与 B（摘要）。

### 4. 代价与风险

- 多一次延迟与费用  
- 摘要可能漏掉关键数字/路径 → 提示词里要求保留字段  
- 摘要输入本身也要截断（见 `renderDroppedForSummary`）

### 5. 和下节的关系

仍可能丢细节 → D1.3 会把「目标 / 决策 / 待办」抽到旁路结构，不完全依赖自由文本摘要。

---

## 怎么跑

```bash
npm run demo:day11
```

交互里体验：

```bash
# Windows CMD 示例
set CONTEXT_SUMMARY=1
set CONTEXT_MAX_CHARS=4000
npm start
```

看 CLI `[trim]` 是否出现 `摘要` / `summarized=true`。

---

## 自测题

1. 摘要调用为什么通常 **不带 tools**？  
2. 为什么 notice 预算要从 120 提到约 600？  
3. 纯丢弃占位里为什么几乎不可能出现 `ALPHA-42`？  

---

## 验收

- [x] `summarizeDroppedMessages`  
- [x] `trimMessages` async + `CONTEXT_SUMMARY`  
- [x] `demo:day11` 对照  
- [x] Trace `trim.summarized`  
