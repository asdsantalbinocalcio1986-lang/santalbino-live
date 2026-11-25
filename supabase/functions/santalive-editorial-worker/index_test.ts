import {
  dispatchEditorialQueue,
  processEditorialClaim,
  sha256Hex,
  validateEditorialAsset,
  validateEditorialAssetPath,
} from "./index.ts";

Deno.test("editorial asset paths are confined to the social-editorial prefix", () => {
  if (!validateEditorialAssetPath("social-editorial/test/post.jpg")) throw new Error("Expected a valid editorial asset path");
  for (const path of ["../secret.jpg", "social-editorial/../../secret.jpg", "other/post.jpg", "social-editorial/white space.jpg"]) {
    if (validateEditorialAssetPath(path)) throw new Error(`Unsafe asset path accepted: ${path}`);
  }
});

Deno.test("asset bytes must match the declared image type and approved SHA-256", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]);
  const hash = await sha256Hex(jpeg);
  const valid = await validateEditorialAsset(jpeg, "image/jpeg", hash);
  if (valid.contentType !== "image/jpeg" || valid.sha256 !== hash) throw new Error("Valid JPEG was not accepted");
  let rejected = false;
  try { await validateEditorialAsset(jpeg, "image/png", hash); } catch { rejected = true; }
  if (!rejected) throw new Error("Mismatched MIME type was accepted");
  rejected = false;
  try { await validateEditorialAsset(jpeg, "image/jpeg", "0".repeat(64)); } catch { rejected = true; }
  if (!rejected) throw new Error("Mismatched SHA-256 was accepted");
});

Deno.test("worker processes Facebook and Instagram independently through the shared Meta adapter", async () => {
  const post = {
    id: "post-1",
    caption: "Test SANTA Live",
    asset_path: "social-editorial/test/post.jpg",
    asset_sha256: "a".repeat(64),
    platforms: { facebook: true, instagram: true },
    claim_token: "claim-1",
  };
  const completed: Array<{ platform: string; status: string; externalId: string | null }> = [];
  const calls: string[] = [];
  await processEditorialClaim({
    post,
    deliveries: [{ platform: "facebook" }, { platform: "instagram" }],
  }, {
    loadAsset: async () => ({ publicUrl: "https://storage.example/social-editorial/test/post.jpg" }),
    graphPost: async (path: string) => {
      calls.push(path);
      if (path.endsWith("/photos")) return { id: "fb-post-1" };
      if (path.endsWith("/media")) return { id: "ig-container-1" };
      if (path.endsWith("/media_publish")) return { id: "ig-media-1" };
      throw new Error("Unexpected Graph endpoint");
    },
    graphGet: async () => ({ status_code: "FINISHED" }),
    recordContainer: async (_postId: string, _token: string, id: string) => id === "ig-container-1",
    complete: async (_postId: string, platform: string, _token: string, status: string, externalId?: string | null) => {
      completed.push({ platform, status, externalId: externalId || null });
    },
    pageId: "page-test",
    pageToken: "token-test",
    instagramId: "ig-test",
    delay: async () => {},
  } as never);
  if (completed.length !== 2 ||
      completed[0].platform !== "facebook" || completed[0].status !== "published" ||
      completed[1].platform !== "instagram" || completed[1].status !== "published") {
    throw new Error(`Platform completion mismatch: ${JSON.stringify(completed)}`);
  }
  if (!calls.includes("page-test/photos") || !calls.includes("ig-test/media") || !calls.includes("ig-test/media_publish")) {
    throw new Error(`Expected Meta calls were not made: ${calls.join(",")}`);
  }
});

Deno.test("ambiguous Meta transport failures are recorded as unknown, never retryable", async () => {
  const completed: string[] = [];
  await processEditorialClaim({
    post: {
      id: "post-2", caption: "Test", asset_path: "social-editorial/test/post.jpg",
      asset_sha256: "b".repeat(64), platforms: { facebook: true }, claim_token: "claim-2",
    },
    deliveries: [{ platform: "facebook" }],
  }, {
    loadAsset: async () => ({ publicUrl: "https://storage.example/social-editorial/test/post.jpg" }),
    graphPost: async () => { throw new TypeError("connection reset after submit"); },
    graphGet: async () => ({ status_code: "FINISHED" }),
    recordContainer: async () => true,
    complete: async (_id: string, _platform: string, _token: string, status: string) => { completed.push(status); },
    pageId: "page-test", pageToken: "token-test", instagramId: "ig-test",
  } as never);
  if (completed.length !== 1 || completed[0] !== "unknown") {
    throw new Error(`Ambiguous result was not held for reconciliation: ${completed}`);
  }
});

Deno.test("a container that cannot be persisted is not published", async () => {
  const completed: string[] = [];
  const endpoints: string[] = [];
  await processEditorialClaim({
    post: {
      id: "post-3", caption: "Test", asset_path: "social-editorial/test/post.jpg",
      asset_sha256: "c".repeat(64), platforms: { instagram: true }, claim_token: "claim-3",
    },
    deliveries: [{ platform: "instagram" }],
  }, {
    loadAsset: async () => ({ publicUrl: "https://storage.example/social-editorial/test/post.jpg" }),
    graphPost: async (path: string) => {
      endpoints.push(path);
      return { id: "ig-container-3" };
    },
    graphGet: async () => ({ status_code: "FINISHED" }),
    recordContainer: async () => false,
    complete: async (_id: string, _platform: string, _token: string, status: string) => { completed.push(status); },
    pageId: "page-test", pageToken: "token-test", instagramId: "ig-test",
  } as never);
  if (completed[0] !== "unknown" || endpoints.some(path => path.endsWith("/media_publish"))) {
    throw new Error("Worker attempted Instagram publish without persisting the container ID");
  }
});

Deno.test("dispatch kill switch prevents all queue claims", async () => {
  let called = false;
  const result = await dispatchEditorialQueue({
    rpc: async () => { called = true; return { data: [], error: null }; },
  } as never, false);
  if (called || result.disabled !== true || result.claimed !== 0) {
    throw new Error("Queue kill switch did not prevent a claim");
  }
});


Deno.test("worker does not call Meta after losing the editorial lease", async () => {
  let metaCalls = 0;
  const completed: string[] = [];
  await processEditorialClaim({
    post: {
      id: "post-lease", caption: "Lease test", asset_path: "social-editorial/test/post.jpg",
      asset_sha256: "d".repeat(64), platforms: { facebook: true }, claim_token: "claim-lease",
    },
    deliveries: [{ platform: "facebook" }],
  }, {
    loadAsset: async () => ({ publicUrl: "https://storage.example/social-editorial/test/post.jpg" }),
    renewClaim: async () => false,
    graphPost: async () => { metaCalls++; return { id: "unexpected-post" }; },
    graphGet: async () => ({ status_code: "FINISHED" }),
    recordContainer: async () => true,
    complete: async (_id: string, _platform: string, _token: string, status: string) => { completed.push(status); },
    pageId: "page-test", pageToken: "token-test", instagramId: "ig-test",
  } as never);
  if (metaCalls !== 0 || completed.length !== 0) {
    throw new Error("Worker called Meta or attempted completion after losing its claim");
  }
});


Deno.test("asset failures before any Meta request are safely retryable", async () => {
  const completed: string[] = [];
  let metaCalls = 0;
  await processEditorialClaim({
    post: {
      id: "post-asset-failure", caption: "Asset test", asset_path: "social-editorial/test/missing.jpg",
      asset_sha256: "e".repeat(64), platforms: { facebook: true }, claim_token: "claim-asset",
    },
    deliveries: [{ platform: "facebook" }],
  }, {
    loadAsset: async () => { throw new Error("temporary storage download failure"); },
    graphPost: async () => { metaCalls++; return { id: "unexpected" }; },
    graphGet: async () => ({ status_code: "FINISHED" }),
    recordContainer: async () => true,
    complete: async (_id: string, _platform: string, _token: string, status: string) => { completed.push(status); },
    pageId: "page-test", pageToken: "token-test", instagramId: "ig-test",
  } as never);
  if (metaCalls !== 0 || completed.length !== 1 || completed[0] !== "failed_retryable") {
    throw new Error("Pre-publication asset failure was not safely retried");
  }
});
