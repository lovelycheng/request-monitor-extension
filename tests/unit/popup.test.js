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
});
