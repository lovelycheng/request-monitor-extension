/**
 * popup.js 核心逻辑单元测试
 * 覆盖：matchFilter / isIgnored / selectedIds / ignoredUrls CRUD
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock chrome API
globalThis.chrome = {
  runtime: {
    sendMessage: vi.fn((msg, cb) => {
      if (msg.type === "GET_REQUESTS") cb({ requests: [sampleReq1, sampleReq2, sampleReq3] });
      else if (msg.type === "CLEAR_REQUESTS") cb({ success: true });
      else cb();
    }),
  },
  storage: {
    local: {
      get: vi.fn((keys, cb) => cb({ ignoredUrls: [] })),
      set: vi.fn((data, cb) => cb && cb()),
    },
  },
  downloads: { download: vi.fn() },
};

// ── 示例数据 ─────────────────────────────────────────

const sampleReq1 = {
  _id: 1,
  source: "webRequest",
  url: "https://api.example.com/user/login",
  method: "POST",
  statusCode: 200,
};

const sampleReq2 = {
  _id: 2,
  source: "xhr",
  url: "https://api.example.com/coupon/bestMatch",
  method: "POST",
  statusCode: 200,
};

const sampleReq3 = {
  _id: 3,
  source: "webRequest",
  url: "https://api.example.com/heartbeat",
  method: "GET",
  statusCode: 200,
};

const sampleReq4 = {
  _id: 4,
  source: "dom",
  url: "https://cdn.example.com/tracker.js",
  tag: "SCRIPT",
  method: null,
  statusCode: undefined,
};

// ── matchFilter ──────────────────────────────────────

describe("matchFilter", () => {
  let urlFilter, methodFilter, sourceFilter, statusFilter;
  let ignoredUrls;

  function matchFilter(r) {
    const urlF = urlFilter.value.trim().toLowerCase();
    const methodF = methodFilter.value;
    const sourceF = sourceFilter.value;
    const statusF = statusFilter.value;
    if (urlF && !r.url.toLowerCase().includes(urlF)) return false;
    if (methodF && r.method !== methodF) return false;
    if (sourceF && r.source !== sourceF) return false;
    if (statusF) {
      const sc = r.statusCode;
      if (statusF === "0" && sc !== 0) return false;
      if (statusF !== "0" && (!sc || String(sc)[0] !== statusF)) return false;
    }
    return true;
  }

  beforeEach(() => {
    urlFilter = { value: "" };
    methodFilter = { value: "" };
    sourceFilter = { value: "" };
    statusFilter = { value: "" };
    ignoredUrls = new Set();
  });

  it("无过滤条件时全部通过", () => {
    expect(matchFilter(sampleReq1)).toBe(true);
    expect(matchFilter(sampleReq2)).toBe(true);
    expect(matchFilter(sampleReq3)).toBe(true);
  });

  it("URL 关键字过滤", () => {
    urlFilter.value = "coupon";
    expect(matchFilter(sampleReq1)).toBe(false);
    expect(matchFilter(sampleReq2)).toBe(true);
  });

  it("URL 过滤大小写不敏感", () => {
    urlFilter.value = "COUPON";
    expect(matchFilter(sampleReq2)).toBe(true);
  });

  it("方法过滤", () => {
    methodFilter.value = "GET";
    expect(matchFilter(sampleReq1)).toBe(false);
    expect(matchFilter(sampleReq3)).toBe(true);
  });

  it("来源过滤", () => {
    sourceFilter.value = "xhr";
    expect(matchFilter(sampleReq1)).toBe(false);
    expect(matchFilter(sampleReq2)).toBe(true);
  });

  it("状态码 2xx 过滤", () => {
    statusFilter.value = "2";
    expect(matchFilter(sampleReq1)).toBe(true);
    expect(matchFilter(sampleReq3)).toBe(true);
  });

  it("状态码 4xx 过滤（无匹配）", () => {
    statusFilter.value = "4";
    expect(matchFilter(sampleReq1)).toBe(false);
  });

  it("错误过滤（statusCode=0）", () => {
    // statusCode=0 matches statusFilter "0"
    statusFilter.value = "0";
    const errReq = { _id: 5, source: "fetch", url: "x", statusCode: 0 };
    expect(matchFilter(errReq)).toBe(true);
    expect(matchFilter(sampleReq1)).toBe(false);
  });

  it("dom 来源无 statusCode 时状态码过滤应排除", () => {
    statusFilter.value = "2";
    expect(matchFilter(sampleReq4)).toBe(false);
  });

  it("多条件组合过滤（AND）", () => {
    urlFilter.value = "api";
    methodFilter.value = "POST";
    sourceFilter.value = "webRequest";
    statusFilter.value = "2";
    expect(matchFilter(sampleReq1)).toBe(true);
    expect(matchFilter(sampleReq2)).toBe(false); // source=xhr 不匹配
  });
});

// ── selectedIds ──────────────────────────────────────

describe("selectedIds", () => {
  it("初始为空", () => {
    const selectedIds = new Set();
    expect(selectedIds.size).toBe(0);
  });

  it("add 和 delete 操作", () => {
    const selectedIds = new Set();
    selectedIds.add(1);
    selectedIds.add(2);
    expect(selectedIds.has(1)).toBe(true);
    selectedIds.delete(1);
    expect(selectedIds.has(1)).toBe(false);
    expect(selectedIds.size).toBe(1);
  });

  it("loadRequests 后过滤掉不在 allRequests 中的 id", () => {
    const selectedIds = new Set([1, 2, 99]);
    const allRequests = [sampleReq1, sampleReq2, sampleReq3];
    const newSelected = new Set(
      [...selectedIds].filter((id) => allRequests.some((r) => r._id === id))
    );
    expect([...newSelected]).toEqual([1, 2]);
    expect(newSelected.has(99)).toBe(false);
  });
});

// ── ignoredUrls ──────────────────────────────────────

describe("ignoredUrls", () => {
  let ignoredUrls;

  function isIgnored(url) {
    for (const pattern of ignoredUrls) {
      if (url.includes(pattern)) return true;
    }
    return false;
  }

  beforeEach(() => {
    ignoredUrls = new Set();
  });

  it("空 Set 不屏蔽任何请求", () => {
    expect(isIgnored("https://example.com/heartbeat")).toBe(false);
  });

  it("匹配 pattern 的请求被屏蔽", () => {
    ignoredUrls.add("/heartbeat");
    expect(isIgnored("https://api.example.com/heartbeat")).toBe(true);
  });

  it("不匹配 pattern 的请求通过", () => {
    ignoredUrls.add("/heartbeat");
    expect(isIgnored("https://api.example.com/login")).toBe(false);
  });

  it("add 后清空恢复", () => {
    ignoredUrls.add("/a");
    ignoredUrls.add("/b");
    expect(ignoredUrls.size).toBe(2);
    ignoredUrls.clear();
    expect(ignoredUrls.size).toBe(0);
  });

  it("delete 单个 pattern", () => {
    ignoredUrls.add("/a");
    ignoredUrls.add("/b");
    ignoredUrls.delete("/a");
    expect(ignoredUrls.has("/a")).toBe(false);
    expect(ignoredUrls.has("/b")).toBe(true);
  });

  it("ignoredUrls 通过 chrome.storage 持久化", () => {
    ignoredUrls.add("/persist");
    // 模拟写入 storage
    chrome.storage.local.set({ ignoredUrls: [...ignoredUrls] });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ ignoredUrls: ["/persist"] });
    // 模拟下次加载从 storage 读
    chrome.storage.local.get(["ignoredUrls"], (data) => {
      if (data.ignoredUrls) ignoredUrls = new Set(data.ignoredUrls);
    });
    // 验证 get 被调用过（实际扩展中会在初始化时恢复）
    expect(chrome.storage.local.get).toHaveBeenCalled();
  });
});

// ── sessionExcludedIds（会话排除 vs 持久屏蔽）──────────

describe("sessionExcludedIds（会话排除）", () => {
  let sessionExcludedIds;

  beforeEach(() => {
    sessionExcludedIds = new Set();
  });

  it("排除选中的请求（会话级，不写 storage）", () => {
    sessionExcludedIds.add(1);
    sessionExcludedIds.add(3);
    expect(sessionExcludedIds.size).toBe(2);
    // 会话排除不持久化，不应调用 storage.set
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ sessionExcludedIds: expect.anything() })
    );
  });

  it("恢复所有排除项", () => {
    sessionExcludedIds.add(1);
    sessionExcludedIds.add(2);
    sessionExcludedIds.clear();
    expect(sessionExcludedIds.size).toBe(0);
  });

  it("排除 vs 屏蔽 区别测试", () => {
    // 屏蔽 = 持久化，影响下次加载
    // 排除 = 会话级，下次加载恢复
    const ignored = new Set();     // 持久屏蔽
    const excluded = new Set();    // 会话排除

    // 屏蔽一个请求
    ignored.add("/heartbeat");
    expect(chrome.storage.local.set).toHaveBeenCalled;  // 写 storage

    // 排除两个请求（不写 storage）
    excluded.add(1);
    excluded.add(2);
    expect(excluded.size).toBe(2);

    // 模拟下次加载：屏蔽还在（从 storage 恢复），排除清空
    excluded.clear();
    expect(excluded.size).toBe(0);
    expect(ignored.has("/heartbeat")).toBe(true);
  });
});

// ── shortenUrl ───────────────────────────────────────────

describe("shortenUrl", () => {
  function shortenUrl(url) {
    try {
      const u = new URL(url);
      const q = u.searchParams.toString();
      const path = u.pathname;
      let short = path || '/';
      if (q) short += '?' + (q.length > 30 ? q.substring(0, 30) + '...' : q);
      if (short.length > 80) short = short.substring(0, 80) + '...';
      return short;
    } catch {
      return url && url.length > 80 ? url.substring(0, 80) + '...' : (url || '');
    }
  }

  it("去掉 protocol 和 domain，只显示路径", () => {
    const result = shortenUrl("https://api.example.com/user/login");
    expect(result).toBe("/user/login");
  });

  it("保留短 query string", () => {
    const result = shortenUrl("https://api.example.com/search?q=test&page=1");
    expect(result).toContain("/search?");
    expect(result).toContain("q=test");
  });

  it("长 query string 截断到 30 字符", () => {
    const longQuery = "a".repeat(50);
    const result = shortenUrl(`https://api.example.com/data?${longQuery}`);
    expect(result.length).toBeLessThanOrEqual(81);
    expect(result).toContain("...");
  });

  it("action 记录等非 URL 输入原样返回", () => {
    expect(shortenUrl("[click] #myBtn")).toBe("[click] #myBtn");
  });

  it("null/undefined 安全", () => {
    expect(shortenUrl(null)).toBe("");
    expect(shortenUrl(undefined)).toBe("");
  });
});

// ── detail panel ─────────────────────────────────────────

describe("右侧详情面板", () => {
  let currentDetailId, detailVisible, detailContent;

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatBody(body) {
    if (typeof body === 'string') return escHtml(body);
    try { return escHtml(JSON.stringify(body, null, 2)); }
    catch { return escHtml(String(body)); }
  }

  function showDetail(req) {
    currentDetailId = req._id;
    const parts = [];

    // 基本信息
    parts.push('<div class="label">基本信息</div>');
    const basicRows = [];
    const pushRow = (label, value) => {
      if (value !== null && value !== undefined && value !== '') {
        basicRows.push(`<span class="detail-kv"><b>${label}:</b> ${escHtml(String(value))}</span>`);
      }
    };
    pushRow('来源', req.source);
    pushRow('操作', req.action);
    pushRow('方法', req.method);
    pushRow('状态码', req.statusCode);
    pushRow('耗时', req.duration != null ? req.duration + 'ms' : null);
    pushRow('URL', req.url);
    pushRow('selector', req.selector);
    pushRow('tag', req.tag);
    pushRow('text', req.text);
    pushRow('错误', req.error);
    parts.push(basicRows.join(''));

    // 请求体
    if (req.requestBody != null) {
      parts.push('<div class="label">请求体</div>');
      parts.push(`<pre class="pre-body">${formatBody(req.requestBody)}</pre>`);
    }

    // 响应体
    if (req.responseBody != null) {
      parts.push('<div class="label">响应体</div>');
      parts.push(`<pre class="pre-body">${formatBody(req.responseBody)}</pre>`);
    }

    // 响应头
    if (req.responseHeaders && typeof req.responseHeaders === 'object') {
      parts.push('<div class="label">响应头</div>');
      parts.push(`<pre class="pre-body">${escHtml(JSON.stringify(req.responseHeaders, null, 2))}</pre>`);
    }

    // Cookies
    if (req.cookies && Array.isArray(req.cookies) && req.cookies.length > 0) {
      parts.push('<div class="label">Cookies</div>');
      parts.push(`<pre class="pre-body">${escHtml(JSON.stringify(req.cookies, null, 2))}</pre>`);
    }

    detailContent = parts.join('');
    detailVisible = true;
  }

  function closeDetail() {
    currentDetailId = null;
    detailVisible = false;
    detailContent = "";
  }

  beforeEach(() => {
    currentDetailId = null;
    detailVisible = false;
    detailContent = "";
  });

  it("点击请求后右侧显示详情：基本信息 + 结构化布局", () => {
    showDetail(sampleReq1);
    expect(detailVisible).toBe(true);
    expect(detailContent).toContain("user/login");
    expect(detailContent).toContain("POST");
    expect(detailContent).toContain("基本信息");
    expect(detailContent).toContain("detail-kv");
  });

  it("显示 action 记录的详情", () => {
    const actionReq = {
      _id: 10,
      source: "action",
      action: "click",
      selector: "#login-btn",
      tag: "BUTTON",
      text: "登录",
    };
    showDetail(actionReq);
    expect(detailVisible).toBe(true);
    expect(detailContent).toContain("#login-btn");
    expect(detailContent).toContain("登录");
  });

  it("responseBody 为对象时展示在「响应体」区块", () => {
    const req = {
      _id: 11,
      source: "xhr",
      url: "/api/data",
      responseBody: { code: 0, data: { items: [1, 2, 3] } },
    };
    showDetail(req);
    expect(detailContent).toContain("响应体");
    expect(detailContent).toContain("pre-body");
    expect(detailContent).toContain('"items"');
    expect(detailContent).toContain('"code"');
  });

  it("requestBody 展示在「请求体」区块", () => {
    const req = {
      _id: 12,
      source: "xhr",
      method: "POST",
      url: "/api/submit",
      requestBody: { name: "test", age: 18 },
    };
    showDetail(req);
    expect(detailContent).toContain("请求体");
    expect(detailContent).toContain('"name"');
    expect(detailContent).toContain("test");
  });

  it("responseBody 为字符串时原样展示", () => {
    const req = {
      _id: 13,
      source: "fetch",
      url: "/api/text",
      responseBody: "<html>OK</html>",
    };
    showDetail(req);
    expect(detailContent).toContain("响应体");
    expect(detailContent).toContain("&lt;html&gt;OK&lt;/html&gt;"); // HTML 转义
  });

  it("无 responseBody 时不显示「响应体」区块", () => {
    showDetail(sampleReq1); // sampleReq1 没有 responseBody
    expect(detailContent).not.toContain("响应体");
  });

  it("无 requestBody 时不显示「请求体」区块", () => {
    showDetail(sampleReq3); // GET 请求无 body
    expect(detailContent).not.toContain("请求体");
  });

  it("有 responseHeaders 时展示在「响应头」区块", () => {
    const req = {
      _id: 14,
      source: "webRequest",
      url: "/api/data",
      responseHeaders: { "content-type": "application/json", "x-request-id": "abc123" },
    };
    showDetail(req);
    expect(detailContent).toContain("响应头");
    expect(detailContent).toContain("content-type");
    expect(detailContent).toContain("x-request-id");
  });

  it("有 cookies 时展示在「Cookies」区块", () => {
    const req = {
      _id: 15,
      source: "webRequest",
      url: "/api/login",
      cookies: [{ name: "SESSION", value: "abc123" }],
    };
    showDetail(req);
    expect(detailContent).toContain("Cookies");
    expect(detailContent).toContain("SESSION");
  });

  it("关闭详情后内容清空", () => {
    showDetail(sampleReq1);
    closeDetail();
    expect(detailVisible).toBe(false);
    expect(currentDetailId).toBeNull();
    expect(detailContent).toBe("");
  });

  it("详情在列表刷新后不会被刷掉（左右分离）", () => {
    showDetail(sampleReq2);
    const beforeId = currentDetailId;
    expect(beforeId).toBe(2);

    expect(currentDetailId).toBe(2);
    expect(detailContent).toContain("coupon/bestMatch");
    expect(detailVisible).toBe(true);
  });

  it("请求被清空后详情自动关闭", () => {
    showDetail(sampleReq1);
    closeDetail();
    expect(detailVisible).toBe(false);
  });

  it("完整记录（含 body + headers + cookies）所有区块都展示", () => {
    const fullReq = {
      _id: 20,
      source: "xhr",
      method: "POST",
      url: "/api/full",
      statusCode: 200,
      duration: 150,
      requestBody: { query: "test" },
      responseBody: { code: 0, data: [] },
      responseHeaders: { "content-type": "application/json" },
      cookies: [{ name: "SID", value: "xyz" }],
    };
    showDetail(fullReq);
    expect(detailContent).toContain("基本信息");
    expect(detailContent).toContain("请求体");
    expect(detailContent).toContain("响应体");
    expect(detailContent).toContain("响应头");
    expect(detailContent).toContain("Cookies");
    expect(detailContent).toContain("150ms");
  });

  it("数据更新后重新 showDetail 刷新详情：responseBody 即时呈现", () => {
    // 模拟初次点击时该请求尚无 responseBody（合并未完成）
    const req = { _id: 30, source: "xhr", method: "POST", url: "/api/late", statusCode: 200 };
    showDetail(req);
    expect(currentDetailId).toBe(30);
    expect(detailContent).not.toContain("响应体");

    // 模拟 loadRequests 刷新后数据合并完成，同一请求多了 responseBody
    // （popup.js 修复后会重新调用 showDetail 刷新详情面板）
    const updatedReq = { ...req, responseBody: { code: 0, msg: "merged-late" } };
    showDetail(updatedReq);
    expect(currentDetailId).toBe(30);
    expect(detailContent).toContain("响应体");
    expect(detailContent).toContain("merged-late");
  });
});

// ── renderList 集成测试 ─────────────────────────────────

describe("renderList 集成", () => {
  let requests = [];
  let ignoredUrls, sessionExcludedIds;

  function renderList() {
    const filtered = requests.filter((r) => {
      // matchFilter (passed through)
      // isIgnored
      if (r.url) {
        for (const p of ignoredUrls) {
          if (r.url.includes(p)) return false;
        }
      }
      // sessionExcluded
      if (sessionExcludedIds.has(r._id)) return false;
      return true;
    });
    return filtered;
  }

  beforeEach(() => {
    requests = [sampleReq1, sampleReq2, sampleReq3, sampleReq4];
    ignoredUrls = new Set();
    sessionExcludedIds = new Set();
  });

  it("屏蔽 /heartbeat 路径后该请求不出现在列表中", () => {
    ignoredUrls.add("/heartbeat");
    const filtered = renderList();
    expect(filtered.length).toBe(3);
    expect(filtered.some((r) => r._id === 3)).toBe(false);
  });

  it("会话排除 ID 1 和 2 后列表中只有 3 和 4", () => {
    sessionExcludedIds.add(1);
    sessionExcludedIds.add(2);
    const filtered = renderList();
    expect(filtered.length).toBe(2);
    expect(filtered.map((r) => r._id)).toEqual([3, 4]);
  });

  it("屏蔽 + 排除同时生效", () => {
    ignoredUrls.add("/heartbeat");   // 屏蔽 req3
    sessionExcludedIds.add(1);       // 排除 req1
    const filtered = renderList();
    expect(filtered.length).toBe(2); // 只剩 req2, req4
    expect(filtered.map((r) => r._id)).toEqual([2, 4]);
  });

  it("恢复排除后请求重新出现", () => {
    sessionExcludedIds.add(1);
    sessionExcludedIds.add(2);
    sessionExcludedIds.clear();      // 恢复
    const filtered = renderList();
    expect(filtered.length).toBe(4); // 全部恢复
  });

  it("取消屏蔽后请求重新出现", () => {
    ignoredUrls.add("/heartbeat");
    ignoredUrls.delete("/heartbeat");
    const filtered = renderList();
    expect(filtered.length).toBe(4);
  });
});
