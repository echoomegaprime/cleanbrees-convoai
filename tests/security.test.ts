import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import app, {
  timingSafeEqual,
  computeTwilioSignature,
  verifyTwilioSignature,
  verifyConvoAISecret,
  requireAdminAuth,
  type Env,
} from "../src/index";

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

describe("timingSafeEqual", () => {
  it("accepts identical strings, rejects mismatches/empties without throwing", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("short", "longer")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(false);
  });
});

describe("Twilio webhook signature verification (CRITICAL fix)", () => {
  it("REGRESSION: /twilio/voice, /twilio/status, /twilio/forward previously had NO signature check", () => {
    expect(typeof verifyTwilioSignature).toBe("function");
  });

  it("accepts a correctly computed signature", async () => {
    const env = fakeEnv();
    const url = "https://worker.example/twilio/voice";
    const params = { CallSid: "CA123", From: "+15550001111", To: env.BUSINESS_PHONE };
    const sig = await computeTwilioSignature(env.TWILIO_AUTH_TOKEN, url, params);
    const request = new Request(url, { method: "POST", headers: { "X-Twilio-Signature": sig } });
    expect(await verifyTwilioSignature(request, params, env)).toBe(true);
  });

  it("rejects a missing signature header", async () => {
    const env = fakeEnv();
    const url = "https://worker.example/twilio/voice";
    const params = { CallSid: "CA123" };
    const request = new Request(url, { method: "POST" });
    expect(await verifyTwilioSignature(request, params, env)).toBe(false);
  });

  it("rejects a signature computed with the wrong auth token (forged)", async () => {
    const env = fakeEnv();
    const url = "https://worker.example/twilio/voice";
    const params = { CallSid: "CA123" };
    const forgedSig = await computeTwilioSignature("wrong-token", url, params);
    const request = new Request(url, { method: "POST", headers: { "X-Twilio-Signature": forgedSig } });
    expect(await verifyTwilioSignature(request, params, env)).toBe(false);
  });

  it("rejects when a form param is tampered with after signing (tamper detection)", async () => {
    const env = fakeEnv();
    const url = "https://worker.example/twilio/voice";
    const signedParams = { CallSid: "CA123", From: "+15550001111" };
    const sig = await computeTwilioSignature(env.TWILIO_AUTH_TOKEN, url, signedParams);
    const tamperedParams = { CallSid: "CA123", From: "+19995551234" };
    const request = new Request(url, { method: "POST", headers: { "X-Twilio-Signature": sig } });
    expect(await verifyTwilioSignature(request, tamperedParams, env)).toBe(false);
  });

  it("fails closed when TWILIO_AUTH_TOKEN is unconfigured", async () => {
    const env = fakeEnv({ TWILIO_AUTH_TOKEN: "" });
    const url = "https://worker.example/twilio/voice";
    const params = { CallSid: "CA123" };
    const sig = await computeTwilioSignature("some-token", url, params);
    const request = new Request(url, { method: "POST", headers: { "X-Twilio-Signature": sig } });
    expect(await verifyTwilioSignature(request, params, env)).toBe(false);
  });
});

describe("ConvoAI shared-secret verification (CRITICAL fix)", () => {
  it("REGRESSION: /convoai/tools previously had NO auth -- open SMS-send + booking-write endpoint", () => {
    expect(typeof verifyConvoAISecret).toBe("function");
  });

  it("accepts the correct secret header", () => {
    const env = fakeEnv();
    const request = new Request("https://worker.example/convoai/tools", {
      method: "POST",
      headers: { "X-ConvoAI-Secret": env.CONVOAI_WEBHOOK_SECRET },
    });
    expect(verifyConvoAISecret(request, env)).toBe(true);
  });

  it("rejects a missing or wrong secret header", () => {
    const env = fakeEnv();
    const missing = new Request("https://worker.example/convoai/tools", { method: "POST" });
    const wrong = new Request("https://worker.example/convoai/tools", {
      method: "POST",
      headers: { "X-ConvoAI-Secret": "wrong-secret" },
    });
    expect(verifyConvoAISecret(missing, env)).toBe(false);
    expect(verifyConvoAISecret(wrong, env)).toBe(false);
  });

  it("fails closed when CONVOAI_WEBHOOK_SECRET is unconfigured", () => {
    const env = fakeEnv({ CONVOAI_WEBHOOK_SECRET: "" });
    const request = new Request("https://worker.example/convoai/tools", {
      method: "POST",
      headers: { "X-ConvoAI-Secret": "anything" },
    });
    expect(verifyConvoAISecret(request, env)).toBe(false);
  });
});

describe("requireAdminAuth (/setup/agent, /setup/twilio, /setup/db)", () => {
  it("accepts the correct admin key", () => {
    const env = fakeEnv();
    const request = new Request("https://worker.example/setup/db", {
      method: "POST",
      headers: { "X-Echo-API-Key": env.ADMIN_API_KEY },
    });
    expect(requireAdminAuth(request, env)).toBeNull();
  });

  it("rejects a missing or wrong admin key with 401", () => {
    const env = fakeEnv();
    const missing = new Request("https://worker.example/setup/db", { method: "POST" });
    const wrong = new Request("https://worker.example/setup/db", {
      method: "POST",
      headers: { "X-Echo-API-Key": "wrong" },
    });
    expect(requireAdminAuth(missing, env)?.status).toBe(401);
    expect(requireAdminAuth(wrong, env)?.status).toBe(401);
  });

  it("fails closed 503 when ADMIN_API_KEY is unconfigured", () => {
    const env = fakeEnv({ ADMIN_API_KEY: "" });
    const request = new Request("https://worker.example/setup/db", {
      method: "POST",
      headers: { "X-Echo-API-Key": "anything" },
    });
    expect(requireAdminAuth(request, env)?.status).toBe(503);
  });
});

describe("End-to-end route enforcement (not just the pure functions)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POST /convoai/tools with no secret is REJECTED with 403 and never calls send_sms/Twilio", async () => {
    const env = fakeEnv();
    const request = new Request("https://worker.example/convoai/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Tool-Name": "send_sms" },
      body: JSON.stringify({ to: "+15551234567", message: "forged" }),
    });
    const response = await app.fetch(request, env);
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POST /convoai/tools with the correct secret is processed", async () => {
    const env = fakeEnv();
    const request = new Request("https://worker.example/convoai/tools", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tool-Name": "calculate_quote",
        "X-ConvoAI-Secret": env.CONVOAI_WEBHOOK_SECRET,
      },
      body: JSON.stringify({ service_type: "residential", bedrooms: 2, bathrooms: 1 }),
    });
    const response = await app.fetch(request, env);
    expect(response.status).toBe(200);
    const json = (await response.json()) as unknown as { result: string };
    expect(json.result).toContain("TOTAL");
  });

  it("POST /setup/agent with no admin key is REJECTED with 401 and never calls the ElevenLabs API", async () => {
    const env = fakeEnv();
    const request = new Request("https://worker.example/setup/agent", { method: "POST" });
    const response = await app.fetch(request, env);
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POST /setup/twilio with no admin key is REJECTED with 401 and never calls the Twilio API", async () => {
    const env = fakeEnv();
    const request = new Request("https://worker.example/setup/twilio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number_sid: "PNforged" }),
    });
    const response = await app.fetch(request, env);
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POST /setup/db with no admin key is REJECTED with 401 and never touches D1", async () => {
    const env = fakeEnv();
    const request = new Request("https://worker.example/setup/db", { method: "POST" });
    const response = await app.fetch(request, env);
    expect(response.status).toBe(401);
    expect(env.DB.exec).not.toHaveBeenCalled();
  });

  it("POST /twilio/voice with no signature is REJECTED with 403", async () => {
    const env = fakeEnv();
    const request = new Request("https://worker.example/twilio/voice", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "CallSid=CA123&From=%2B15550001111",
    });
    const response = await app.fetch(request, env);
    expect(response.status).toBe(403);
  });
});
