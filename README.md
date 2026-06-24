# Request Monitor - 浏览器请求监听插件

监听浏览器 **所有网络请求**、**DOM 操作触发的请求**、**用户交互触发的请求**。
支持选中请求导出为 **Playwright 可执行脚本**。

## 数据存储

| 存储 | 位置 | 说明 |
|------|------|------|
| 内存 | background.js `requests[]` | 运行时全量，最多 500 条 |
| chrome.storage.local | 浏览器本地存储 | popup 关闭后保留最近 200 条，打开即恢复 |
| 查看 | popup 弹窗 | 点击插件图标即可查看、搜索、过滤、选中导出 |

## 功能

### 三层捕获
| 层 | 机制 | 捕获内容 |
|----|------|----------|
| **webRequest** | `chrome.webRequest` API | 浏览器级所有 HTTP 请求（含请求头、请求体、响应头、状态码）|
| **页面劫持** | XHR/fetch 原型重写 | 页面内 JS 发起的请求（含响应体、耗时、调用栈）|
| **DOM+事件** | MutationObserver + 事件委托 | 动态插入资源、表单提交、链接点击 |

### Popup 面板
- 按 **URL / Method / 来源 / 状态码** 过滤
- 勾选复选框选中请求
- 点击行展开完整详情（请求头、请求体、响应头、调用栈）
- **导出 JSON** — 导出选中或全部请求
- **导出 Playwright 脚本** — 将选中的 HTTP 请求生成可执行的 `.js` 脚本

### 导出脚本示例

选中几个请求后点击「导出 Playwright 脚本」，生成如下文件：

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // [xhr] 200 POST https://api.example.com/order
  await page.evaluate(async () => {
    const resp = await fetch('https://api.example.com/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer xxx'
      },
      body: JSON.stringify({"pno18":"..."}),
    });
    return resp;
  });

  await browser.close();
})();
```

运行方式：`npx playwright install chromium && node script.js`

## 安装

1. Chrome → `chrome://extensions/`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」→ 选择本目录
4. 点击插件图标打开监控面板

## 文件结构

```
request-monitor-extension/
├── manifest.json    # Manifest V3：webRequest + storage + downloads
├── background.js    # Service Worker：3层消息接收 + 存储 + 脚本生成
├── content.js       # Content Script：XHR/fetch 劫持 + MutationObserver + 事件
├── popup.html       # 弹出面板 UI
├── popup.js         # 面板逻辑：过滤、勾选、详情、导出
├── icons/           # 占位图标（16/48/128）
└── README.md
```

## 作为 opencode Skill 使用

如果你想把录制好的请求脚本作为 opencode 的 Skill 复用：

1. 在浏览器操作一遍业务流程
2. 在 popup 中勾选相关请求
3. 导出为 Playwright 脚本
4. 把脚本放到 skills 目录下，配上 SKILL.md 描述触发条件即可
