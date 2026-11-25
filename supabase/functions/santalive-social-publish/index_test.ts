import { classifyMetaFailure, MetaRequestError } from "./index.ts";

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
