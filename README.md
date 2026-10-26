# mini-cursor

手写编码 Agent。当前：**Day 8（运行中干预）**。

## 命令

```bash
npm start           # CLI；任务中可 !pause / !resume / !cancel / !inject …
npm run server      # http://127.0.0.1:8787 （页面含控制按钮）
npm run replay -- traces/xxx.json
npm run eval
```

## Day8 要点

- **步间**暂停/继续/取消（不硬掐上游流）
- **inject** 往 messages 追加运行中指令
- **ask_user** 工具做人机协作点
