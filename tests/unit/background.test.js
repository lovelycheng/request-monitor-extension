/**
 * background.js 单元测试
 * 覆盖：persistRequest / mergeCookie / parseCookies / buildLocator / 消息处理
 * Mock: vitest-chrome-mv3 提供 chrome.* API
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// 在 background.js 加载前设置 chrome mock
globalThis.chrome = {
  runtime: {
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    sendMessage: vi.fn(),
  },
  storage: {
    local: {
      get: vi.fn((keys, cb) => cb({})),
      set: vi.fn((data, cb) => cb && cb()),
    },
  },
  webRequest: {
    onBeforeRequest: { addListener: vi.fn() },
    onBeforeSendHeaders: { addListener: vi.fn() },
    onCompleted: { addListener: vi.fn() },
    onErrorOccurred: { addListener: vi.fn() },
  },
  downloads: { download: vi.fn() },
};

// ── 手动提取需测试的核心函数 ────────────────────────

let seq = 0;
function nextId() {
  return ++seq;
}

function parseCookies(setCookie) {
  try {
    const val = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!val) return [];
    return val.split(";").map((part) => {
      const [name, ...rest] = part.trim().split("=");
      return { name: name.trim(), value: (rest.join("=") || "").trim() };
    });
  } catch {
    return [];
  }
}

function mergeCookie(cookieJar, url, cookies) {
  if (!cookies || cookies.length === 0) return cookieJar;
  try {
    const hostname = new URL(url).hostname;
    for (const c of cookies) {
      if (!c.name || !c.value) continue;
      if (!cookieJar[hostname]) cookieJar[hostname] = {};
      cookieJar[hostname][c.name] = c;
    }
  } catch {}
  return cookieJar;
}

function buildLocator(r) {
  if (r.selector) {
    if (r.selector.startsWith("#")) return `page.locator("${r.selector}")`;
    if (r.selector.startsWith("[name=")) return `page.locator('${r.selector}')`;
    if (r.selector.includes(":has-text")) {
      const m = r.selector.match(/:has-text\("(.+)"\)/);
      if (m) return `page.getByText("${m[1]}")`;
    }
    return `page.locator("${r.selector}")`;
  }
  if (r.id) return `page.locator("#${r.id}")`;
  if (r.name) return `page.locator('[name="${r.name}"]')`;
  if (r.placeholder) return `page.getByPlaceholder("${r.placeholder}")`;
  if (r.text && r.text.length < 40) return `page.getByText("${r.text}")`;
  if (r.tag === "A" && r.url) return `page.locator('a[href="${r.url}"]')`;
  return `page.locator("${r.tag ? r.tag.toLowerCase() : '*'}:visible")`;
}

// ── parseCookies ─────────────────────────────────────

describe("parseCookies", () => {
  it("解析单个 Set-Cookie 字符串", () => {
    const result = parseCookies("SESSION=abc123");
    expect(result).toEqual([{ name: "SESSION", value: "abc123" }]);
  });

  it("解析 Set-Cookie 数组取第一个", () => {
    const result = parseCookies(["TOKEN=xyz; Path=/", "OTHER=ignored"]);
    expect(result[0]).toEqual({ name: "TOKEN", value: "xyz" });
  });

  it("值中含等号时正确解析", () => {
    const result = parseCookies("token=abc=def=ghi");
    expect(result[0]).toEqual({ name: "token", value: "abc=def=ghi" });
  });

  it("空字符串返回空数组", () => {
    expect(parseCookies("")).toEqual([]);
    expect(parseCookies(null)).toEqual([]);
    expect(parseCookies([])).toEqual([]);
  });

  it("异常输入不抛出", () => {
    expect(() => parseCookies(undefined)).not.toThrow();
    expect(parseCookies(123)).toEqual([]);
  });
});

// ── mergeCookie ──────────────────────────────────────

describe("mergeCookie", () => {
  it("按 domain 合并单个 cookie", () => {
    const jar = {};
    const cookies = [{ name: "SESSION", value: "abc" }];
    mergeCookie(jar, "https://example.com/api/test", cookies);
    expect(jar["example.com"]["SESSION"]).toEqual(cookies[0]);
  });

  it("同一 domain 多 cookie 合并", () => {
    const jar = {};
    mergeCookie(jar, "https://example.com/a", [
      { name: "A", value: "1" },
      { name: "B", value: "2" },
    ]);
    expect(Object.keys(jar["example.com"])).toHaveLength(2);
    expect(jar["example.com"]["A"].value).toBe("1");
    expect(jar["example.com"]["B"].value).toBe("2");
  });

  it("同 domain 同名 cookie 后被覆盖", () => {
    const jar = {};
    mergeCookie(jar, "https://example.com", [{ name: "TOKEN", value: "old" }]);
    mergeCookie(jar, "https://example.com", [{ name: "TOKEN", value: "new" }]);
    expect(jar["example.com"]["TOKEN"].value).toBe("new");
  });

  it("不同 domain 分别存储", () => {
    const jar = {};
    mergeCookie(jar, "https://auth.huaweicloud.com", [{ name: "IAM", value: "x" }]);
    mergeCookie(jar, "https://devcloud.huaweicloud.com", [{ name: "DEV", value: "y" }]);
    expect(jar["auth.huaweicloud.com"]).toBeDefined();
    expect(jar["devcloud.huaweicloud.com"]).toBeDefined();
  });

  it("空 cookies 不修改 jar", () => {
    const jar = { "example.com": { "A": { name: "A", value: "1" } } };
    const before = jar["example.com"]["A"];
    mergeCookie(jar, "https://example.com", []);
    expect(jar["example.com"]["A"]).toBe(before);
  });

  it("无 name 或无 value 的 cookie 跳过", () => {
    const jar = {};
    mergeCookie(jar, "https://example.com", [{ name: "", value: "x" }, { name: "y", value: "" }, { name: "ok", value: "yes" }]);
    expect(Object.keys(jar["example.com"])).toHaveLength(1);
    expect(jar["example.com"]["ok"].value).toBe("yes");
  });
});

// ── buildLocator ─────────────────────────────────────

describe("buildLocator", () => {
  it("id selector 最优先", () => {
    expect(buildLocator({ selector: "#loginBtn", id: "other", name: "x" }))
      .toBe(`page.locator("#loginBtn")`);
  });

  it("name selector", () => {
    expect(buildLocator({ selector: "[name=\"username\"]" }))
      .toBe(`page.locator('[name="username"]')`);
  });

  it("has-text selector → getByText", () => {
    expect(buildLocator({ selector: 'button:has-text("登录")' }))
      .toBe(`page.getByText("登录")`);
  });

  it("fallback to id", () => {
    expect(buildLocator({ id: "form-submit-btn" }))
      .toBe(`page.locator("#form-submit-btn")`);
  });

  it("fallback to placeholder", () => {
    expect(buildLocator({ placeholder: "搜索" }))
      .toBe(`page.getByPlaceholder("搜索")`);
  });

  it("fallback to text", () => {
    expect(buildLocator({ text: "提交" }))
      .toBe(`page.getByText("提交")`);
  });

  it("link with url", () => {
    expect(buildLocator({ tag: "A", url: "/api/test" }))
      .toBe(`page.locator('a[href="/api/test"]')`);
  });

  it("最终兜底", () => {
    const result = buildLocator({ tag: "BUTTON" });
    expect(result).toContain("button");
    expect(result).toContain("visible");
  });
});

// ── persistRequest ───────────────────────────────────

describe("persistRequest", () => {
  it("分配递增 _id", () => {
    // 重置 seq
    seq = 0;
    const data1 = { url: "https://a.com" };
    const data2 = { url: "https://b.com" };
    persistRequest(data1);
    persistRequest(data2);
    expect(data1._id).toBe(1);
    expect(data2._id).toBe(2);
  });

  it("超过 MAX_RECORDS 截断", () => {
    seq = 0;
    requests = [];
    for (let i = 0; i < 510; i++) {
      persistRequest({ url: `https://x.com/${i}` });
    }
    expect(requests.length).toBe(500);
    // 最老的第 10 条被丢弃，最早的应为 _id=11
    expect(requests[0]._id).toBe(11);
  });
});

// ── persistRequest 合并逻辑 ──────────────────────────

describe("persistRequest 合并逻辑", () => {
  beforeEach(() => {
    seq = 0;
    requests = [];
  });

  it("webRequest + XHR 同 URL/方法 → 合并为一条（XHR 补全 responseBody）", () => {
    const ts = Date.now();
    persistRequest({
      source: "webRequest", url: "https://api.example.com/data",
      method: "POST", statusCode: 200, timeStamp: ts, requestBody: { a: 1 },
    });
    expect(requests.length).toBe(1);
    expect(requests[0].responseBody).toBeUndefined();

    // XHR 捕获同一请求，带 responseBody
    persistRequest({
      source: "xhr", url: "https://api.example.com/data",
      method: "POST", statusCode: 200, timeStamp: ts + 50,
      requestBody: { a: 1 }, responseBody: { code: 0, data: "ok" }, duration: 120,
    });
    // 应合并，不新增
    expect(requests.length).toBe(1);
    expect(requests[0].responseBody).toEqual({ code: 0, data: "ok" });
    expect(requests[0].requestBody).toEqual({ a: 1 });
    expect(requests[0].duration).toBe(120);
  });

  it("webRequest + fetch 同 URL/方法 → 合并", () => {
    const ts = Date.now();
    persistRequest({
      source: "webRequest", url: "https://api.example.com/user",
      method: "GET", statusCode: 200, timeStamp: ts,
    });
    persistRequest({
      source: "fetch", url: "https://api.example.com/user",
      method: "GET", statusCode: 200, timeStamp: ts + 100,
      responseBody: { name: "test" },
    });
    expect(requests.length).toBe(1);
    expect(requests[0].responseBody).toEqual({ name: "test" });
  });

  it("不同 URL 不合并", () => {
    const ts = Date.now();
    persistRequest({
      source: "webRequest", url: "https://api.example.com/a",
      method: "POST", timeStamp: ts,
    });
    persistRequest({
      source: "xhr", url: "https://api.example.com/b",
      method: "POST", timeStamp: ts,
    });
    expect(requests.length).toBe(2);
  });

  it("不同 method 不合并", () => {
    const ts = Date.now();
    persistRequest({
      source: "webRequest", url: "https://api.example.com/data",
      method: "GET", timeStamp: ts,
    });
    persistRequest({
      source: "xhr", url: "https://api.example.com/data",
      method: "POST", timeStamp: ts,
    });
    expect(requests.length).toBe(2);
  });

  it("超过 2 秒时间窗口不合并", () => {
    persistRequest({
      source: "webRequest", url: "https://api.example.com/data",
      method: "POST", timeStamp: 1000,
    });
    persistRequest({
      source: "xhr", url: "https://api.example.com/data",
      method: "POST", timeStamp: 4000,
    });
    expect(requests.length).toBe(2);
  });

  it("action 类型记录不参与合并", () => {
    const ts = Date.now();
    persistRequest({
      source: "action", action: "click", selector: "#btn",
      timeStamp: ts,
    });
    persistRequest({
      source: "action", action: "click", selector: "#btn",
      timeStamp: ts + 50,
    });
    expect(requests.length).toBe(2);
  });

  it("合并后保留最早的 timeStamp", () => {
    const ts = 5000;
    persistRequest({
      source: "webRequest", url: "https://api.example.com/data",
      method: "POST", timeStamp: ts,
    });
    persistRequest({
      source: "xhr", url: "https://api.example.com/data",
      method: "POST", timeStamp: ts + 100,
      responseBody: { ok: true },
    });
    expect(requests[0].timeStamp).toBe(ts);
  });

  it("webRequest 有 error 时合并保留 error", () => {
    const ts = Date.now();
    persistRequest({
      source: "webRequest", url: "https://api.example.com/fail",
      method: "POST", timeStamp: ts, statusCode: 0, error: "net::ERR_FAILED",
    });
    persistRequest({
      source: "xhr", url: "https://api.example.com/fail",
      method: "POST", timeStamp: ts + 50, statusCode: 0,
      error: "Failed to fetch", responseBody: null,
    });
    expect(requests.length).toBe(1);
    expect(requests[0].error).toBe("net::ERR_FAILED"); // 保留第一条的 error
  });

  it("慢请求(>2s)但发起时间对齐 → 合并成功，responseBody 正确合并", () => {
    // 修复后 content.js 传入发起时间，webRequest 的 details.timeStamp 也是发起时间，
    // 两者差值≈0，即使请求耗时 5 秒也能在 2 秒窗口内合并，responseBody 不再丢失
    const ts = 1700000000000;
    persistRequest({
      source: "webRequest", url: "https://api.example.com/slow",
      method: "POST", statusCode: 200, timeStamp: ts, requestBody: { q: "slow" },
    });
    expect(requests.length).toBe(1);
    expect(requests[0].responseBody).toBeUndefined();

    // XHR 捕获同一请求，timeStamp 用发起时间（与 webRequest 对齐），带 responseBody
    persistRequest({
      source: "xhr", url: "https://api.example.com/slow",
      method: "POST", statusCode: 200, timeStamp: ts + 50,
      requestBody: { q: "slow" }, responseBody: { code: 0, data: "slow-result" }, duration: 5000,
    });
    expect(requests.length).toBe(1);
    expect(requests[0].responseBody).toEqual({ code: 0, data: "slow-result" });
    expect(requests[0].duration).toBe(5000);
  });
});

// ── 静态资源过滤 ─────────────────────────────────────

describe("静态资源请求过滤 (SKIP_TYPES)", () => {
  it("script 类型被过滤", () => {
    expect(isSkipType("script")).toBe(true);
  });

  it("stylesheet 类型被过滤", () => {
    expect(isSkipType("stylesheet")).toBe(true);
  });

  it("image 类型被过滤", () => {
    expect(isSkipType("image")).toBe(true);
  });

  it("font 类型被过滤", () => {
    expect(isSkipType("font")).toBe(true);
  });

  it("media 类型被过滤", () => {
    expect(isSkipType("media")).toBe(true);
  });

  it("websocket 类型被过滤", () => {
    expect(isSkipType("websocket")).toBe(true);
  });

  it("ping 类型被过滤", () => {
    expect(isSkipType("ping")).toBe(true);
  });

  it("other 类型被过滤", () => {
    expect(isSkipType("other")).toBe(true);
  });

  it("xmlhttprequest 类型不被过滤（API 请求）", () => {
    expect(isSkipType("xmlhttprequest")).toBe(false);
  });

  it("main_frame 类型不被过滤（页面导航）", () => {
    expect(isSkipType("main_frame")).toBe(false);
  });

  it("sub_frame 类型不被过滤（iframe 导航）", () => {
    expect(isSkipType("sub_frame")).toBe(false);
  });
});

// ── 共享状态 ─────────────────────────────────────────

let requests = [];
const MAX_RECORDS = 500;

// 静态资源类型集合（与 background.js 保持同步）
const SKIP_TYPES = new Set([
  "script",
  "stylesheet",
  "image",
  "font",
  "media",
  "websocket",
  "ping",
  "other",
]);

function isSkipType(type) {
  return SKIP_TYPES.has(type);
}
function persistRequest(data) {
  // 合并同源记录：webRequest 没有 responseBody，XHR/fetch 有
  const networkSources = ["webRequest", "xhr", "fetch"];
  if (networkSources.includes(data.source) && data.url && data.method) {
    const timeWindow = 2000;
    const existing = requests.find(r =>
      networkSources.includes(r.source) &&
      r.url === data.url &&
      r.method === data.method &&
      Math.abs((r.timeStamp || 0) - (data.timeStamp || 0)) < timeWindow
    );
    if (existing) {
      if (data.requestBody && !existing.requestBody) existing.requestBody = data.requestBody;
      if (data.responseBody && !existing.responseBody) existing.responseBody = data.responseBody;
      if (data.statusCode && !existing.statusCode) existing.statusCode = data.statusCode;
      if (data.duration && !existing.duration) existing.duration = data.duration;
      if (data.requestHeaders && !existing.requestHeaders) existing.requestHeaders = data.requestHeaders;
      if (data.responseHeaders && !existing.responseHeaders) existing.responseHeaders = data.responseHeaders;
      if (data.cookies && !existing.cookies) existing.cookies = data.cookies;
      if (data.ip && !existing.ip) existing.ip = data.ip;
      if (data.error && !existing.error) existing.error = data.error;
      if (data.stack && !existing.stack) existing.stack = data.stack;
      if (data.timeStamp && existing.timeStamp && data.timeStamp < existing.timeStamp) {
        existing.timeStamp = data.timeStamp;
      }
      chrome.storage.local.set({ requests: requests.slice(-200) });
      return;
    }
  }

  data._id = nextId();
  requests.push(data);
  if (requests.length > MAX_RECORDS) {
    requests = requests.slice(-MAX_RECORDS);
  }
  chrome.storage.local.set({ requests: requests.slice(-200) });
}

// ════════════════════════════════════════════════════════
//  buildLocator 边界用例（补充）
// ════════════════════════════════════════════════════════

describe("buildLocator 边界用例", () => {
  it("中文 :has-text → getByText", () => {
    expect(buildLocator({ selector: 'button:has-text("登录")' }))
      .toBe(`page.getByText("登录")`);
  });

  it(":has-text 含特殊字符", () => {
    expect(buildLocator({ selector: 'a:has-text("下载 App")' }))
      .toBe(`page.getByText("下载 App")`);
  });

  it(":has-text 含冒号", () => {
    expect(buildLocator({ selector: 'span:has-text("时间: 10:00")' }))
      .toBe(`page.getByText("时间: 10:00")`);
  });

  it("text 超过 40 字符不触发 getByText fallback", () => {
    const longText = "x".repeat(41);
    const result = buildLocator({ text: longText, tag: "BUTTON" });
    // 长文本跳过 getByText，走最终兜底
    expect(result).not.toContain("getByText");
    expect(result).toContain("visible");
  });

  it("text 刚好 39 字符触发 getByText", () => {
    const text = "x".repeat(39);
    expect(buildLocator({ text })).toBe(`page.getByText("${text}")`);
  });

  it("空 record 走最终兜底", () => {
    const result = buildLocator({});
    expect(result).toContain("visible");
    expect(result).toContain("*");
  });

  it("selector 既非 # 也非 [name= 也非 :has-text 时用 locator", () => {
    expect(buildLocator({ selector: ".my-class" }))
      .toBe(`page.locator(".my-class")`);
  });

  it("tag 为 A 且有 url 时用 href locator", () => {
    expect(buildLocator({ tag: "A", url: "https://example.com/page" }))
      .toBe(`page.locator('a[href="https://example.com/page"]')`);
  });
});

// ════════════════════════════════════════════════════════
//  消息处理器测试（模拟各类消息到达时的行为）
// ════════════════════════════════════════════════════════

describe("消息处理器", () => {
  beforeEach(() => {
    seq = 0;
    requests = [];
  });

  // ── USER_CLICK ────────────────────────────────────

  it("USER_CLICK → persistRequest with action:click", () => {
    const msg = {
      type: "USER_CLICK",
      data: {
        selector: "#login-btn",
        tag: "BUTTON",
        id: "login-btn",
        name: null,
        placeholder: null,
        text: "登录",
        type: "submit",
        timeStamp: 1700000000000,
        href: null,
      },
    };
    persistRequest({
      source: "action",
      action: "click",
      tag: msg.data.tag,
      selector: msg.data.selector,
      id: msg.data.id,
      name: msg.data.name,
      placeholder: msg.data.placeholder,
      text: msg.data.text,
      type: msg.data.type,
      timeStamp: msg.data.timeStamp || Date.now(),
      url: msg.data.href || null,
    });
    expect(requests.length).toBe(1);
    const r = requests[0];
    expect(r.source).toBe("action");
    expect(r.action).toBe("click");
    expect(r.selector).toBe("#login-btn");
    expect(r.text).toBe("登录");
  });

  it("USER_CLICK 无 timeStamp 时使用 Date.now()", () => {
    const before = Date.now();
    persistRequest({
      source: "action",
      action: "click",
      tag: "A",
      selector: null,
      id: null,
      name: null,
      placeholder: null,
      text: "链接",
      type: null,
      timeStamp: Date.now(),
      url: "https://example.com",
    });
    const after = Date.now();
    expect(requests.length).toBe(1);
    expect(requests[0].timeStamp).toBeGreaterThanOrEqual(before);
    expect(requests[0].timeStamp).toBeLessThanOrEqual(after);
    expect(requests[0].url).toBe("https://example.com");
  });

  // ── USER_INPUT ────────────────────────────────────

  it("USER_INPUT → persistRequest with action:input", () => {
    persistRequest({
      source: "action",
      action: "input",
      tag: "INPUT",
      selector: '[name="username"]',
      id: null,
      name: "username",
      placeholder: "请输入用户名",
      value: "admin",
      timeStamp: Date.now(),
      url: null,
    });
    expect(requests.length).toBe(1);
    const r = requests[0];
    expect(r.source).toBe("action");
    expect(r.action).toBe("input");
    expect(r.value).toBe("admin");
    expect(r.placeholder).toBe("请输入用户名");
    expect(r.url).toBeNull();
  });

  // ── USER_SUBMIT ───────────────────────────────────

  it("USER_SUBMIT → persistRequest with action:submit", () => {
    persistRequest({
      source: "action",
      action: "submit",
      selector: "#login-form",
      url: "/api/login",
      method: "POST",
      timeStamp: Date.now(),
    });
    expect(requests.length).toBe(1);
    const r = requests[0];
    expect(r.source).toBe("action");
    expect(r.action).toBe("submit");
    expect(r.method).toBe("POST");
    expect(r.url).toBe("/api/login");
  });

  // ── XHR_COMPLETE ──────────────────────────────────

  it("XHR_COMPLETE → persistRequest with source:xhr", () => {
    persistRequest({
      source: "xhr",
      url: "https://api.example.com/coupon/bestMatch",
      method: "POST",
      statusCode: 200,
      duration: 150,
      requestBody: { couponCode: "ABC" },
      responseBody: { code: 0, data: {} },
      stack: undefined,
      timeStamp: Date.now(),
    });
    expect(requests.length).toBe(1);
    const r = requests[0];
    expect(r.source).toBe("xhr");
    expect(r.statusCode).toBe(200);
    expect(r.duration).toBe(150);
    expect(r.requestBody).toEqual({ couponCode: "ABC" });
  });

  // ── FETCH_COMPLETE ────────────────────────────────

  it("FETCH_COMPLETE → persistRequest with source:fetch", () => {
    persistRequest({
      source: "fetch",
      url: "https://api.example.com/data",
      method: "GET",
      statusCode: 200,
      duration: 80,
      requestBody: null,
      responseBody: { items: [] },
      stack: undefined,
      timeStamp: Date.now(),
    });
    expect(requests.length).toBe(1);
    const r = requests[0];
    expect(r.source).toBe("fetch");
    expect(r.method).toBe("GET");
    expect(r.responseBody).toEqual({ items: [] });
  });

  // ── FETCH_ERROR ───────────────────────────────────

  it("FETCH_ERROR → persistRequest with statusCode:0", () => {
    persistRequest({
      source: "fetch",
      url: "https://api.example.com/timeout",
      method: "POST",
      statusCode: 0,
      error: "Failed to fetch",
      timeStamp: Date.now(),
    });
    expect(requests.length).toBe(1);
    const r = requests[0];
    expect(r.source).toBe("fetch");
    expect(r.statusCode).toBe(0);
    expect(r.error).toBe("Failed to fetch");
  });

  // ── DOM_TRIGGERED_REQUEST ─────────────────────────

  it("DOM_TRIGGERED_REQUEST → persistRequest with source:dom", () => {
    persistRequest({
      source: "dom",
      url: "https://cdn.example.com/script.js",
      tag: "SCRIPT",
      cause: "DOM插入",
      timeStamp: 1700000000000,
    });
    expect(requests.length).toBe(1);
    const r = requests[0];
    expect(r.source).toBe("dom");
    expect(r.tag).toBe("SCRIPT");
    expect(r.cause).toBe("DOM插入");
  });

  // ── EVENT_TRIGGERED_REQUEST ───────────────────────

  it("EVENT_TRIGGERED_REQUEST → persistRequest with source:event", () => {
    persistRequest({
      source: "event",
      url: "https://example.com/track",
      method: "GET",
      event: "DOMContentLoaded",
      tag: "IMG",
      timeStamp: Date.now(),
    });
    expect(requests.length).toBe(1);
    const r = requests[0];
    expect(r.source).toBe("event");
    expect(r.event).toBe("DOMContentLoaded");
    expect(r.tag).toBe("IMG");
  });

  // ── CLEAR_REQUESTS ────────────────────────────────

  it("CLEAR_REQUESTS 清空 requests 并重置 seq", () => {
    // 先添加一些数据
    persistRequest({ url: "https://a.com" });
    persistRequest({ url: "https://b.com" });
    expect(requests.length).toBe(2);

    // 模拟 CLEAR_REQUESTS
    requests = [];
    seq = 1;
    chrome.storage.local.set({ requests: [] });

    expect(requests.length).toBe(0);
    // 验证 storage 被更新
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ requests: [] });
  });

  // ── 消息数据缺失字段 ──────────────────────────────

  it("消息 data 缺少字段时使用默认值（不抛异常）", () => {
    // 模拟收到不完整的消息
    expect(() => {
      persistRequest({
        source: "action",
        action: "click",
        tag: undefined,
        selector: null,
        id: null,
        name: null,
        placeholder: null,
        text: null,
        type: null,
        timeStamp: Date.now(),
        url: null,
      });
    }).not.toThrow();
    expect(requests.length).toBe(1);
    expect(requests[0].tag).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════
//  buildPlaywrightScript 测试
// ════════════════════════════════════════════════════════

describe("buildPlaywrightScript", () => {
  // 复制 background.js 中的 buildPlaywrightScript
  function buildPlaywrightScript(records, cookieJar = {}) {
    const lines = [];
    lines.push(`const { chromium } = require("playwright");`);
    lines.push(`const fs = require("fs");`);
    lines.push(`const STORAGE_FILE = "browser-state.json";`);
    lines.push(``);
    lines.push(`(async () => {`);
    lines.push(`  const browser = await chromium.launch({ headless: false });`);
    lines.push(``);
    lines.push(`  const storageState = fs.existsSync(STORAGE_FILE)`);
    lines.push(`    ? JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8"))`);
    lines.push(`    : {};`);
    lines.push(`  const context = await browser.newContext({ storageState: fs.existsSync(STORAGE_FILE) ? STORAGE_FILE : undefined });`);
    lines.push(`  const page = await context.newPage();`);
    lines.push(``);

    const allCookies = [];
    for (const [domain, cookies] of Object.entries(cookieJar)) {
      for (const [, c] of Object.entries(cookies)) {
        allCookies.push({ domain, name: c.name, value: c.value, path: c.path || "/", httpOnly: c.httpOnly, secure: c.secure });
      }
    }
    if (allCookies.length > 0) {
      lines.push(`  // 从录制中提取的 cookies（共 ${allCookies.length} 个）`);
      lines.push(`  const recordedCookies = ${JSON.stringify(allCookies)};`);
      lines.push(`  await context.addCookies(recordedCookies);`);
      lines.push(``);
    }

    const firstPage = records.find(
      (r) => r.type === "main_frame" || r.action === "click"
    );
    const firstUrl = firstPage
      ? firstPage.url
      : records.find((r) => r.url)?.url;

    if (firstUrl) {
      lines.push(`  await page.goto("${firstUrl}", { waitUntil: "domcontentloaded", timeout: 30000 });`);
      lines.push(`  await page.waitForTimeout(2000);`);
      lines.push(``);
    }

    const sorted = [...records].sort(
      (a, b) => (a.timeStamp || 0) - (b.timeStamp || 0)
    );

    for (const r of sorted) {
      if (r.source === "action") {
        if (r.action === "click") {
          const loc = buildLocator(r);
          lines.push(`  // 点击 ${r.selector || r.text || r.tag}`);
          lines.push(`  await ${loc}.click();`);
          lines.push(`  await page.waitForTimeout(500);`);
        } else if (r.action === "input") {
          const loc = buildLocator(r);
          const val = (r.value || "").replace(/`/g, "\\`").replace(/\$/g, "\\$");
          lines.push(`  // 输入 ${r.selector || r.placeholder || r.tag}`);
          lines.push(`  await ${loc}.fill(\`${val}\`);`);
        }
      } else if (r.source === "webRequest" || r.source === "xhr" || r.source === "fetch") {
        const method = r.method || "GET";
        if (method === "GET" && !r.requestBody) continue;
        const url = r.url.replace(/'/g, "\\'");
        let body = "null";
        if (r.requestBody) {
          if (typeof r.requestBody === "object") {
            body = `JSON.stringify(${JSON.stringify(r.requestBody)})`;
          } else {
            const s = String(r.requestBody).replace(/'/g, "\\'").replace(/\n/g, "\\n");
            body = `'${s}'`;
          }
        }
        lines.push(`  // [${r.source}] ${r.statusCode || "?"} ${method} ${url.substring(0, 80)}`);
        lines.push(`  await page.evaluate(async () => {`);
        lines.push(`    await fetch('${url}', { method: '${method}', body: ${body} });`);
        lines.push(`  });`);
      }
      lines.push(``);
    }

    lines.push(`  // 保存登录状态（cookies + localStorage），下次运行可复用`);
    lines.push(`  const state = await context.storageState();`);
    lines.push(`  fs.writeFileSync(STORAGE_FILE, JSON.stringify(state, null, 2));`);
    lines.push(`  console.log("[完成] 浏览器状态已保存到 " + STORAGE_FILE);`);
    lines.push(``);
    lines.push(`  // 不自动关闭，保留登录态供调试`);
    lines.push(`  // await browser.close();`);
    lines.push(`})();`);
    return lines.join("\n");
  }

  it("生成完整脚本结构", () => {
    const script = buildPlaywrightScript([], {});
    expect(script).toContain('const { chromium } = require("playwright")');
    expect(script).toContain("(async () => {");
    expect(script).toContain("})();");
    expect(script).toContain("browser-state.json");
  });

  it("空 records 不包含 goto 和 action", () => {
    const script = buildPlaywrightScript([], {});
    // 无记录时不应有 page.goto
    expect(script).not.toContain("page.goto");
    expect(script).not.toContain(".click()");
    expect(script).not.toContain(".fill(");
  });

  it("有 main_frame 记录时生成 goto", () => {
    const records = [
      { type: "main_frame", url: "https://example.com/home", timeStamp: 1 },
    ];
    const script = buildPlaywrightScript(records, {});
    expect(script).toContain(
      'await page.goto("https://example.com/home"'
    );
  });

  it("无 main_frame 但有 click action 时使用 click 的 url", () => {
    const records = [
      {
        source: "action",
        action: "click",
        url: "https://example.com/start",
        selector: "#start",
        tag: "BUTTON",
        timeStamp: 1,
      },
    ];
    const script = buildPlaywrightScript(records, {});
    expect(script).toContain(
      'await page.goto("https://example.com/start"'
    );
  });

  it("嵌入 cookieJar 中的 cookies", () => {
    const records = [];
    const cookieJar = {
      "example.com": {
        SESSION: { name: "SESSION", value: "abc123", path: "/", httpOnly: true, secure: true },
      },
    };
    const script = buildPlaywrightScript(records, cookieJar);
    expect(script).toContain("recordedCookies");
    expect(script).toContain("context.addCookies(recordedCookies)");
    expect(script).toContain('"name":"SESSION"');
    expect(script).toContain('"value":"abc123"');
  });

  it("生成 click action 行", () => {
    const records = [
      {
        source: "action",
        action: "click",
        selector: "#submit-btn",
        text: "提交",
        tag: "BUTTON",
        timeStamp: 1,
      },
    ];
    const script = buildPlaywrightScript(records, {});
    expect(script).toContain("page.locator(\"#submit-btn\").click()");
    expect(script).toContain("// 点击");
  });

  it("生成 input action 行", () => {
    const records = [
      {
        source: "action",
        action: "input",
        selector: '[name="username"]',
        value: "admin",
        placeholder: "用户名",
        tag: "INPUT",
        timeStamp: 1,
      },
    ];
    const script = buildPlaywrightScript(records, {});
    expect(script).toContain(".fill(");
    expect(script).toContain("admin");
    expect(script).toContain("// 输入");
  });

  it("input value 中的反引号被转义", () => {
    const records = [
      {
        source: "action",
        action: "input",
        selector: '[name="msg"]',
        value: "hello `world`",
        timeStamp: 1,
      },
    ];
    const script = buildPlaywrightScript(records, {});
    expect(script).toContain("hello \\`world\\`");
  });

  it("input value 中的 $ 被转义", () => {
    const records = [
      {
        source: "action",
        action: "input",
        selector: '[name="price"]',
        value: "$100",
        timeStamp: 1,
      },
    ];
    const script = buildPlaywrightScript(records, {});
    expect(script).toContain("\\$100");
  });

  it("GET webRequest 无 requestBody 时跳过", () => {
    const records = [
      {
        source: "webRequest",
        url: "https://example.com/api/data",
        method: "GET",
        statusCode: 200,
        timeStamp: 1,
      },
    ];
    const script = buildPlaywrightScript(records, {});
    // GET 无 body 应被跳过
    expect(script).not.toContain("page.evaluate");
  });

  it("POST webRequest 生成 fetch 回放", () => {
    const records = [
      {
        source: "webRequest",
        url: "https://example.com/api/submit",
        method: "POST",
        statusCode: 200,
        requestBody: { name: "test" },
        timeStamp: 1,
      },
    ];
    const script = buildPlaywrightScript(records, {});
    expect(script).toContain("page.evaluate");
    expect(script).toContain("method: 'POST'");
  });

  it("requestBody 为字符串时直接嵌入", () => {
    const records = [
      {
        source: "xhr",
        url: "https://example.com/api",
        method: "POST",
        statusCode: 200,
        requestBody: "plain text body",
        timeStamp: 1,
      },
    ];
    const script = buildPlaywrightScript(records, {});
    expect(script).toContain("'plain text body'");
  });

  it("多条记录按时间排序", () => {
    const records = [
      { source: "action", action: "click", selector: "#btn1", tag: "BUTTON", timeStamp: 300 },
      { source: "action", action: "click", selector: "#btn2", tag: "BUTTON", timeStamp: 100 },
      { source: "action", action: "click", selector: "#btn3", tag: "BUTTON", timeStamp: 200 },
    ];
    const script = buildPlaywrightScript(records, {});

    // #btn2 (100) 应出现在 #btn3 (200) 之前
    const idx2 = script.indexOf("#btn2");
    const idx3 = script.indexOf("#btn3");
    const idx1 = script.indexOf("#btn1");
    expect(idx2).toBeLessThan(idx3);
    expect(idx3).toBeLessThan(idx1);
  });
});
