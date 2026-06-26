# Request Monitor Extension — 测试用例

> **原则**：任何代码改动必须同步改动测试。修改后运行 `npx vitest run` 通过方可提交。

## 覆盖率目标

| 文件 | 语句 | 分支 | 函数 |
|------|------|------|------|
| `background.js` | ≥ 60% | ≥ 50% | ≥ 60% |
| `popup.js` | ≥ 60% | ≥ 40% | ≥ 50% |
| `content.js` | ≥ 40% | ≥ 30% | ≥ 40% |

## 一、background.js 单元测试 (21 条)

### parseCookies

| # | 用例 | 输入 | 预期 |
|---|------|------|------|
| 1 | 解析单个 cookie | `"SESSION=abc123"` | `[{name:"SESSION",value:"abc123"}]` |
| 2 | Set-Cookie 数组取第一个 | `["TOKEN=xyz; Path=/"]` | name=TOKEN |
| 3 | 值中含等号 | `"token=a=b=c"` | value=`a=b=c` |
| 4 | 空输入 | `""`, `null`, `[]` | `[]` |
| 5 | 异常输入不崩溃 | `undefined`, `123` | `[]` |

### mergeCookie

| # | 用例 | 输入 | 预期 |
|---|------|------|------|
| 6 | 按 domain 合并 | `"https://example.com/api"` + 1 cookie | jar 中有 `example.com` |
| 7 | 同 domain 多 cookie | 2 个 cookie 同 domain | jar 中 2 个 key |
| 8 | 同名覆盖 | `TOKEN=old` → `TOKEN=new` | value=`new` |
| 9 | 不同 domain 分离 | auth + devcloud 两个 host | 2 个独立 domain |
| 10 | 空 cookies 不修改 | `[]` | jar 不变 |
| 11 | 无 name/value 跳过 | `[{name:"",value:"x"}]` | 仅 valid 加入 |

### buildLocator

| # | 用例 | 输入 | 预期 |
|---|------|------|------|
| 12 | selector=#id | `{selector:"#loginBtn"}` | `page.locator("#loginBtn")` |
| 13 | selector=[name] | `{selector:'[name="username"]'}` | `page.locator('[name=...]')` |
| 14 | selector=:has-text | `{selector:'button:has-text("登录")'}` | `page.getByText("登录")` |
| 15 | 兜底 id | `{id:"form-btn"}` | `page.locator("#form-btn")` |
| 16 | 兜底 placeholder | `{placeholder:"搜索"}` | `page.getByPlaceholder("搜索")` |
| 17 | 兜底 text | `{text:"提交"}` | `page.getByText("提交")` |
| 18 | 兜底 link | `{tag:"A", url:"/api/test"}` | `a[href="/api/test"]` |
| 19 | 最终兜底 | `{tag:"BUTTON"}` | 含 `button` 和 `visible` |

### persistRequest

| # | 用例 | 输入 | 预期 |
|---|------|------|------|
| 20 | 递增 _id | 连续调用 2 次 | `_id`=1,2 |
| 21 | 超过 500 条截断 | 510 次调用 | `length === 500` |

## 二、popup.js 单元测试 (18 条)

### matchFilter

| # | 用例 | 输入 | 预期 |
|---|------|------|------|
| 22 | 无过滤全部通过 | 3 条，无过滤 | 全部 true |
| 23 | URL 过滤 | filter="coupon" | 仅 coupon 相关 |
| 24 | 大小写不敏感 | filter="COUPON" | 同上 |
| 25 | 方法过滤 | filter=GET | 仅 GET 通过 |
| 26 | 来源过滤 | filter=xhr | 仅 xhr 通过 |
| 27 | 状态码 2xx | filter=2 | 仅 2xx 通过 |
| 28 | 状态码 4xx | filter=4 | 全部 false |
| 29 | 错误请求 | filter=0, statusCode=0 | 通过 |
| 30 | dom 无 statusCode | filter=2 | 被排除 |
| 31 | 多条件 AND | 四项同时 | 取交集 |

### selectedIds

| # | 用例 | 输入 | 预期 |
|---|------|------|------|
| 32 | 初始为空 | new Set() | size=0 |
| 33 | add/delete | add(1,2), delete(1) | has(1)=false |
| 34 | 过滤失效 id | allRequests 不含 id=99 | 99 被清除 |

### ignoredUrls

| # | 用例 | 输入 | 预期 |
|---|------|------|------|
| 35 | 空 Set 不屏蔽 | new Set() | 全部通过 |
| 36 | 匹配 pattern | add("/heartbeat") | 含 pattern 的被屏蔽 |
| 37 | 不匹配通过 | add("/heartbeat") | "/login" 通过 |
| 38 | clear 清空 | 2 项后 clear | size=0 |
| 39 | delete 单个 | 2 项后 delete 1 | 剩 1 项 |

## 三、运行时验证

| # | 操作 | 预期 |
|---|------|------|
| 40 | 修改 background.js → 同步更新 tests/unit/background.test.js | 测试通过 |
| 41 | 修改 popup.js → 同步更新 tests/unit/popup.test.js | 测试通过 |
| 42 | `npx vitest run` 始终 39 passed | 全部绿色 |

## 八、响应体可靠性（供测试人员编写用例）

> 背景：修复「右侧详情不展示返回 body」bug 后新增的测试维度。bug 根因是慢请求(>2s)时间戳失配导致 webRequest 与 XHR/fetch 合并失败，responseBody 丢失到另一条记录。

| # | 场景 | 操作 | 预期 |
|---|------|------|------|
| 43 | 慢请求(>2s)响应体展示 | 触发耗时 3-5 秒的 XHR，点击列表中该请求 | 右侧详情「响应体」区块正常展示返回 body |
| 44 | 慢 fetch 响应体展示 | 触发耗时 >2s 的 fetch 请求 | 详情展示响应体，且列表只出现一条记录（webRequest 与 fetch 合并） |
| 45 | 详情面板数据刷新 | 点击某请求展示详情（此时无响应体），等待数据合并 | 详情面板自动刷新，响应体即时呈现，无需手动重新点击 |
| 46 | XHR responseType=arraybuffer 响应体降级 | 页面发起 responseType=arraybuffer 的 XHR | 详情仍能展示解码后的响应体（非空） |
| 47 | XHR responseType=blob 响应体降级 | 页面发起 responseType=blob 的 XHR | 详情展示响应体或降级为字符串 |
| 48 | fetch 响应体读取失败兜底 | 模拟 clone.text() 失败（如 body 被锁定） | 请求记录不丢失，详情响应体区块不展示（null）但其他字段正常 |
| 49 | 快请求(<1s)响应体展示（回归） | 触发耗时 <500ms 的 XHR | 详情正常展示响应体（回归验证，确保未破坏快路径） |
| 50 | 合并后字段完整 | 同一 POST 请求被 webRequest + XHR 双层捕获 | 单条记录含 requestBody + responseBody + responseHeaders + cookies |

## 九、UI 视觉一致性（供测试人员编写用例）

> 背景：UI 重新设计为「示波器琥珀（Oscilloscope Amber）」设计语言——深青墨底色 + 磷光琥珀强调 + 等宽数据字体，致敬专业测量仪器。

| # | 场景 | 检查点 | 预期 |
|---|------|--------|------|
| 51 | 主背景色调 | 整体背景 | 深青墨色（带蓝绿底调），非纯黑 |
| 52 | 品牌标识 | 顶部「Request Monitor」 | 等宽大写琥珀色，带字间距 |
| 53 | 录制指示灯 | Header 圆点 | 琥珀色脉冲动画 |
| 54 | 来源 badge 配色 | 各来源标签 | webRequest 青绿 / xhr 琥珀 / fetch 紫 / dom 黄 / event 粉 / action 橙 |
| 55 | 方法 badge 配色 | GET/POST/PUT/DELETE/PATCH | GET 青绿 / POST 琥珀 / PUT 黄 / DELETE 红 / PATCH 紫 |
| 56 | 状态码配色 | 2xx/3xx/4xx/5xx | 2xx 青绿 / 3xx 橙 / 4xx-5xx 红，半透明底 |
| 57 | 列表选中态 | 勾选某行 | 左侧 2px 琥珀信号条 + 琥珀半透明底 |
| 58 | 列表活动态 | 点击行展开详情 | 左侧琥珀信号条加亮 + 辉光 |
| 59 | 详情代码块（签名元素） | 请求体/响应体/响应头/Cookies | 深青墨底 + 琥珀等宽字 + 左侧 2px 琥珀边 |
| 60 | 详情标签 | 各区块标题 | 等宽大写 + 琥珀小竖条前缀 |
| 61 | 过滤框聚焦 | 点击 URL 输入框 | 琥珀边框 + 琥珀光晕 |
| 62 | 主按钮 | 「导出脚本」 | 琥珀底深色字 |
| 63 | Modal 样式 | 屏蔽列表弹窗 | 深青墨卡片 + 青线边框 + 背景模糊 |
| 64 | 空状态 | 无请求时列表 | 等宽字 + 琥珀图标 |
