# Request Monitor Extension — 功能清单

## 一、录制 — 网络层

| # | 功能 | 触发条件 | 代码位置 |
|---|------|----------|----------|
| 1 | 拦截所有 HTTP/HTTPS 请求（URL/方法/请求类型/tabId/请求体） | 任何 tab 发起请求 | `background.js` webRequest.onBeforeRequest |
| 2 | 捕获发送前的请求头 | 请求发出前 | `background.js` webRequest.onBeforeSendHeaders |
| 3 | 捕获响应状态码 + 响应头 | 请求完成 | `background.js` webRequest.onCompleted |
| 4 | 捕获请求错误（超时/断开等） | 请求失败 | `background.js` webRequest.onErrorOccurred |
| 5 | 解析 formData 请求体为对象 | POST application/x-www-form-urlencoded | `background.js` parseRequestBody |
| 6 | 解析 JSON 请求体为对象 | POST application/json | `background.js` parseRequestBody |
| 7 | 拦截 XMLHttpRequest（含响应体、耗时） | 页面 JS 调用 XHR.send | `content.js` XHR.prototype.send 劫持 |
| 8 | 拦截 fetch（含响应体、耗时） | 页面 JS 调用 fetch | `content.js` window.fetch 劫持 |
| 9 | 从 Set-Cookie 解析 cookie name/value | 响应含 set-cookie 头 | `background.js` parseCookies |
| 10 | cookieJar 按 domain 合并 Set-Cookie | 每次响应含 cookie | `background.js` mergeCookie |

## 二、录制 — DOM 层

| # | 功能 | 触发条件 | 代码位置 |
|---|------|----------|----------|
| 11 | 检测动态插入的 script/img/iframe/link/video | MutationObserver childList | `content.js` checkAddedNodes |
| 12 | 检测 src/href/data-src 属性变化 | MutationObserver attributes | `content.js` MutationObserver |
| 13 | 递归检测子元素中的资源标签 | 批量插入节点 | `content.js` checkAddedNodes 内 querySelectorAll |

## 三、录制 — 用户交互

| # | 功能 | 触发条件 | 代码位置 |
|---|------|----------|----------|
| 14 | 记录按钮/链接/input/select 点击（含 selector/id/text） | isTrusted click | `content.js` click 监听 |
| 15 | 记录 input/textarea/select 输入（含 selector/placeholder/值，限 500 字符） | isTrusted input | `content.js` input 监听 |
| 16 | 记录表单提交（含 selector/action/method） | isTrusted submit | `content.js` submit 监听 |
| 17 | 生成元素 CSS selector（优先级: #id > [name] > [placeholder] > :has-text > class > nth-child） | 每次交互记录 | `content.js` buildSelector |
| 18 | 过滤静默事件（mousemove/scroll/keydown 等） | 交互监听 | `content.js` 白名单过滤 |

## 四、存储

| # | 功能 | 位置 | 说明 |
|---|------|------|------|
| 19 | 内存 `requests[]` 数组 | `background.js` | 最多 500 条，超出截断头部 |
| 20 | `chrome.storage.local` 持久化最近 200 条 | `background.js` | popup 关闭后恢复 |
| 21 | 屏蔽列表 `ignoredUrls` Set 持久化 | `chrome.storage.local` | 序列化为数组存储 |
| 22 | cookieJar 内存维护（按 domain 按 name 去重） | `background.js` cookieJar | 每次 Set-Cookie 覆盖同 domain 同 name 条目 |
| 23 | `tabRequestMap` 中间态请求映射 | `background.js` | onBeforeRequest → onCompleted/onError 生命周期 |

## 五、Popup 面板

| # | 功能 | 触发/组件 | 代码位置 |
|---|------|-----------|----------|
| 24 | 实时请求列表 | 1.5 秒轮询 | `popup.js` loadRequests + setInterval |
| 25 | 来源标签（webRequest/xhr/fetch/dom/event/action） | — | `popup.html` .source-badge |
| 26 | 方法标签（GET/POST/PUT/DELETE/PATCH） | — | `popup.html` .method-badge |
| 27 | 状态码标签（2xx/3xx/4xx/5xx/错误） | — | `popup.html` .status-code |
| 28 | 按 URL 文本过滤 | 输入框实时 | `popup.js` filterUrl input |
| 29 | 按 HTTP 方法过滤 | 下拉框 | `popup.js` filterMethod |
| 30 | 按来源过滤 | 下拉框（7 种来源） | `popup.js` filterSource |
| 31 | 按状态码范围过滤 | 下拉框 | `popup.js` filterStatus |
| 32 | 勾选请求 | 复选框 | `popup.js` selectedIds Set |
| 33 | 全选当前过滤结果 | 「全选」按钮 | `popup.js` btn-select-all |
| 34 | 取消全部勾选 | 「取消」按钮 | `popup.js` btn-deselect |
| 35 | 点击行展开详情（所有字段） | 行点击 | `popup.js` showDetail |
| 36 | 清空全部数据 | 「清空」按钮 | `popup.js` CLEAR_REQUESTS message |
| 37 | 复制 JSON 到剪贴板 | 「复制 JSON」按钮 | `popup.js` navigator.clipboard.writeText |
| 38 | 导出 JSON 下载 | 「导出 JSON」按钮 | `popup.js` chrome.downloads.download |
| 39 | 导出 Playwright 脚本下载 | 「导出脚本」按钮 | `background.js` buildPlaywrightScript |
| 40 | 屏蔽某类请求 | hover × 按钮 | `popup.js` ignoredUrls.add |
| 41 | 管理屏蔽列表 | 「管理屏蔽」按钮 → 弹窗 | `popup.js` block-modal |
| 42 | 逐行恢复屏蔽项 | 弹窗内「恢复」按钮 | `popup.js` ignoredUrls.delete |
| 43 | 清空全部屏蔽项 | 弹窗内「清空全部」按钮 | `popup.js` ignoredUrls.clear |

## 六、导出脚本

| # | 功能 | 说明 | 代码位置 |
|---|------|------|----------|
| 44 | 按 timeStamp 排序重放 | 所有记录按时间排序 | `background.js` buildPlaywrightScript |
| 45 | UI 操作 → page.locator().click() / .fill() | 从录制 selector 生成 Playwright locator | `background.js` buildLocator |
| 46 | HTTP 请求 → page.evaluate(fetch(...)) | POST/带 body 的请求 | `background.js` buildPlaywrightScript |
| 47 | 内嵌 cookieJar → context.addCookies() | 脚本启动时设置录制积累的 cookie | `background.js` cookieJar 序列化 |
| 48 | 检测 browser-state.json 存在 → 跳过登录 | 优先恢复持久化登录态 | 生成脚本内的逻辑 |
| 49 | 登录完成后自动保存 context.storageState() | 下次运行复用 | 生成脚本末尾逻辑 |
| 50 | `headless: false`，不自动关闭浏览器 | 保留调试窗口 | 生成脚本硬编码 |

## 七、外部脚本

| # | 功能 | 说明 | 文件 |
|---|------|------|------|
| 51 | 无头浏览器录制 | Playwright 打开页面自动拦截请求 | `record.js` |
| 52 | 登录流程回放（华为云示例） | 密码登录 → SMS → 保存状态 | `login-test.js` |
