import { describe, it, expect, vi, afterEach } from "vitest";
import app, { OwnerNotify, notifyOwnerOfContactLead, contactLeadSms, type Env } from "../src/index";

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: vi.fn().mockResolvedValue(null),
          run: vi.fn().mockResolvedValue({ meta: { last_row_id: 1 } }),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      }),
      exec: vi.fn().mockResolvedValue(undefined),
    } as unknown as D1Database,
    ELEVENLABS_API_KEY: "test-elevenlabs-key",
    TWILIO_ACCOUNT_SID: "ACtest",
    TWILIO_AUTH_TOKEN: "test-twilio-auth-token",
    GOOGLE_MAPS_API_KEY: "",
    CLEANBREES_API_URL: "https://cleanbrees-api.example.dev",
    BREE_VOICE_ID: "voice-id",
    BUSINESS_PHONE: "+14329997402",
    CONVOAI_AGENT_ID: "agent-id",
    OWNER_PHONE: "+14322248166",
    ADMIN_API_KEY: "test-admin-key",
    CONVOAI_WEBHOOK_SECRET: "test-convoai-secret",
    ...overrides,
  };
}

function jsonReply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("contactLeadSms", () => {
  it("flattens line breaks and clips long fields", () => {
    const text = contactLeadSms({ ref: "CB-ABC", name: "Jane\r\nSmith", email: "jane@example.com", phone: "432-555-0100", message: "x".repeat(400) });
    expect(text).toContain("CB-ABC");
    expect(text).toContain("Jane Smith");
    expect(text).not.toMatch(/[\r\n]/);
    expect(text.length).toBeLessThan(560);
  });
});

describe("notifyOwnerOfContactLead", () => {
  it("reports owner_phone_unset without calling Twilio", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(notifyOwnerOfContactLead({ ref: "CB-1" }, fakeEnv({ OWNER_PHONE: "" }))).resolves.toEqual({ sent: false, reason: "owner_phone_unset" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports twilio_unset without calling Twilio", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(notifyOwnerOfContactLead({ ref: "CB-1" }, fakeEnv({ TWILIO_AUTH_TOKEN: "" }))).resolves.toEqual({ sent: false, reason: "twilio_unset" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("texts the owner from the business number and reports ok", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonReply(201, { sid: "SM123" }));
    const res = await notifyOwnerOfContactLead({ ref: "CB-2", name: "Jane", message: "hi" }, fakeEnv());
    expect(res).toEqual({ sent: true, reason: "ok" });
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain("/Accounts/ACtest/Messages.json");
    const form = new URLSearchParams(String((init as RequestInit).body));
    expect(form.get("To")).toBe("+14322248166");
    expect(form.get("From")).toBe("+14329997402");
    expect(form.get("Body")).toContain("CB-2");
  });

  it("captures only the numeric Twilio error code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonReply(400, { code: 21608, message: "The number is unverified", status: 400 }));
    const res = await notifyOwnerOfContactLead({ ref: "CB-3" }, fakeEnv());
    expect(res).toEqual({ sent: false, reason: "twilio_21608" });
    expect(JSON.stringify(res)).not.toContain("unverified");
  });

  it("falls back to the HTTP status for a non-JSON error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("gateway down", { status: 502 }));
    await expect(notifyOwnerOfContactLead({ ref: "CB-4" }, fakeEnv())).resolves.toEqual({ sent: false, reason: "twilio_http_502" });
  });

  it("reports sms_exception when the request throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(notifyOwnerOfContactLead({ ref: "CB-5" }, fakeEnv())).resolves.toEqual({ sent: false, reason: "sms_exception" });
  });
});

describe("OwnerNotify entrypoint", () => {
  it("contactLead uses the worker's own env", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonReply(201, { sid: "SM9" }));
    const entry = new OwnerNotify({} as ExecutionContext, fakeEnv());
    await expect(entry.contactLead({ ref: "CB-6" })).resolves.toEqual({ sent: true, reason: "ok" });
  });
});

describe("GET /schedule/:date requires admin auth (customer names and addresses)", () => {
  it("fails closed with 503 when ADMIN_API_KEY is unset", async () => {
    const res = await app.request("/schedule/2026-12-01", {}, fakeEnv({ ADMIN_API_KEY: "" }));
    expect(res.status).toBe(503);
  });

  it("returns 401 without the admin key", async () => {
    const res = await app.request("/schedule/2026-12-01", {}, fakeEnv());
    expect(res.status).toBe(401);
  });

  it("returns 200 with the admin key", async () => {
    const res = await app.request("/schedule/2026-12-01", { headers: { "X-Echo-API-Key": "test-admin-key" } }, fakeEnv());
    expect(res.status).toBe(200);
  });
});

describe("send_sms tool replies are unchanged by the Twilio helper refactor", () => {
  const call = (env: Env) =>
    app.request(
      "/convoai/tools",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-ConvoAI-Secret": "test-convoai-secret" },
        body: JSON.stringify({ tool_name: "send_sms", parameters: { to: "4325550100", message: "hi" } }),
      },
      env,
    );

  it("success reply", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonReply(201, { sid: "SM1" }));
    const res = await call(fakeEnv());
    expect(await res.json()).toEqual({ result: "SMS sent successfully to 4325550100!" });
  });

  it("failure reply repeats Twilio's body exactly as before", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"code":21211}', { status: 400 }));
    const res = await call(fakeEnv());
    expect(await res.json()).toEqual({ result: 'Failed to send SMS: {"code":21211}' });
  });
});
