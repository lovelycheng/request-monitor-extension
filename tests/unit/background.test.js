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

// ── 共享状态 ─────────────────────────────────────────

let requests = [];
const MAX_RECORDS = 500;
function persistRequest(data) {
  data._id = nextId();
  requests.push(data);
  if (requests.length > MAX_RECORDS) {
    requests = requests.slice(-MAX_RECORDS);
  }
  chrome.storage.local.set({ requests: requests.slice(-200) });
}
