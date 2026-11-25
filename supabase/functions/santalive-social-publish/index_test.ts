import { classifyMetaFailure, graphPost, MetaRequestError } from "./index.ts";

Deno.test("explicit Meta rejection is retryable", () => {
  const error = new MetaRequestError("Meta HTTP 400: rejected", "failed_retryable");
  if (classifyMetaFailure(error) !== "failed_retryable") {
    throw new Error("Expected explicit rejection to be retryable");
  }
});

Deno.test("network and unexpected failures remain unknown", () => {
  if (classifyMetaFailure(new TypeError("connection reset")) !== "unknown") {
    throw new Error("Unexpected network failure must remain unknown");
  }
  if (classifyMetaFailure(new Error("missing remote id")) !== "unknown") {
    throw new Error("Unclassified post failure must remain unknown");
  }
});

Deno.test("an ambiguous Meta outcome is never automatically retryable", () => {
  const error = new MetaRequestError("request outcome unknown", "unknown");
  if (classifyMetaFailure(error) !== "unknown") {
    throw new Error("Ambiguous Meta outcome must require reconciliation");
  }
});

Deno.test("Graph POST uses injected transport and never needs a Facebook test page", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async (_input, init) => {
    calls++;
    if (init?.method !== "POST") throw new Error("Expected POST");
    if (!init.signal) throw new Error("Expected a bounded request timeout");
    return new Response(JSON.stringify({ id: "mock-post-123" }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  };
  const result = await graphPost("mock/photos", { caption: "test" }, fakeFetch);
  if (result.id !== "mock-post-123" || calls !== 1) {
    throw new Error("Injected Meta transport was not used exactly once");
  }
});

Deno.test("Graph POST classifies transport failure as unknown", async () => {
  const fakeFetch: typeof fetch = async () => {
    throw new TypeError("simulated connection reset after request");
  };
  try {
    await graphPost("mock/photos", { caption: "test" }, fakeFetch);
    throw new Error("Expected the transport failure to throw");
  } catch (error) {
    if (classifyMetaFailure(error) !== "unknown") {
      throw new Error("Transport failure must require reconciliation");
    }
  }
});

Deno.test("Graph POST classifies explicit 4xx rejection as retryable", async () => {
  const fakeFetch: typeof fetch = async () => new Response(
    JSON.stringify({ error: { message: "invalid test payload" } }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );
  try {
    await graphPost("mock/photos", { caption: "test" }, fakeFetch);
    throw new Error("Expected the explicit rejection to throw");
  } catch (error) {
    if (classifyMetaFailure(error) !== "failed_retryable") {
      throw new Error("Explicit 4xx rejection should be retryable");
    }
  }
});
