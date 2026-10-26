# Day 8：运行中干预（暂停 / 继续 / 取消 / 注入 / ask_user）

> 对应：G2.1–G2.3  
> 代码：`control.ts`、`loop.ts`、`tools/ask_user.ts`、`cli.ts`、`server.ts`

---

## 本节目标

Agent **跑着的时候**人还能插手：暂停、继续、取消、中途改需求，以及模型主动 `ask_user`。

---

## 知识点

### 1. 步间控制（不是掐断正在飞的 HTTP）

每轮 LLM **之前**检查：

- `cancelled` → 存档 `cancelled`，退出  
- `paused` → 阻塞等待 `resume` / `cancel`  
- `inject` 队列 → 刷成 `user` 消息再继续  

### 2. 三个动作

| 动作 | 效果 |
|------|------|
| pause | 红灯，保留 messages |
| resume | 绿灯，同一对话接着想 |
| cancel | 收工；**不自动回滚已写文件** |

### 3. inject ≠ 新开任务

往当前 `messages` 追加 `[运行中指令] ...`，模型下一轮看见。

### 4. ask_user 工具

模型点名 → CLI 提问 / SSE 推 `ask` 事件 → 回答回灌为 tool 结果。

---

## 怎么用

```bash
npm start
# 任务跑起来后另起一行输入：
!pause
!inject 不要改 hello，改 world.js
!resume
!cancel
```

SSE：

```bash
npm run server
# 打开 http://127.0.0.1:8787 ，用页面按钮
# 或 POST /api/control { "checkpointId","action","text?" }
```

---

## 自测题

1. 暂停和 Checkpoint resume 差在哪？  
2. 取消后磁盘上的 write_file 会怎样？  
3. inject 的消息为什么用 role:user？  

---

## 验收

- [x] 步间 pause/resume/cancel  
- [x] inject 进入 messages  
- [x] ask_user 工具  
- [x] CLI `!` 命令 + SSE `/api/control`  
