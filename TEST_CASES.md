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
