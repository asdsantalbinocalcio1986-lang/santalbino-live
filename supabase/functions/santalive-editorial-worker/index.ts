import { createClient } from "npm:@supabase/supabase-js@2.119.2";
import {
  classifyMetaFailure,
  graphGet,
  graphPost,
  MetaRequestError,
  safeError,
} from "../santalive-social-publish/index.ts";

const corsHeaders = { "Content-Type": "application/json" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type EditorialPost = {
  id: string;
  caption: string;
  asset_path: string;
  asset_sha256: string;
  platforms: { facebook?: boolean; instagram?: boolean };
  claim_token: string;
};
type EditorialDelivery = {
  platform: "facebook" | "instagram";
  external_container_id?: string | null;
};
type EditorialClaim = { post: EditorialPost; deliveries: EditorialDelivery[] };

function hex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(bytes: Uint8Array) {
  const ownedBytes = bytes.slice();
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", ownedBytes.buffer as ArrayBuffer)));
}

export function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 &&
      String.fromCharCode(...bytes.slice(1, 4)) === "PNG" &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function validateEditorialAsset(
  bytes: Uint8Array,
  contentType: string,
  expectedSha256: string,
) {
  if (!bytes.length || bytes.length > MAX_ASSET_BYTES) {
    throw new Error("Asset editoriale vuoto o superiore al limite di 8 MB");
  }
  const detected = detectImageMime(bytes);
  const declared = contentType.split(";")[0].trim().toLowerCase();
  if (!detected || !ALLOWED_IMAGE_TYPES.has(declared) || declared !== detected) {
    throw new Error("Formato immagine editoriale non valido");
  }
  const actualHash = await sha256Hex(bytes);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || actualHash !== expectedSha256) {
    throw new Error("Verifica SHA-256 dell'immagine editoriale non riuscita");
  }
  return { contentType: detected, sha256: actualHash };
}

export function validateEditorialAssetPath(path: string) {
  return typeof path === "string" &&
    path.startsWith("social-editorial/") &&
    path.length <= 520 &&
    !path.includes("..") &&
    /^[a-zA-Z0-9/_\-.]+$/.test(path);
}

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

type WorkerDependencies = {
  loadAsset: (post: EditorialPost) => Promise<{ publicUrl: string }>;
  graphPost: typeof graphPost;
  graphGet: typeof graphGet;
  recordContainer: (postId: string, token: string, containerId: string) => Promise<boolean>;
  complete: (
    postId: string,
    platform: "facebook" | "instagram",
    token: string,
    status: "published" | "failed_retryable" | "unknown",
    externalPostId?: string | null,
    errorSafe?: string | null,
  ) => Promise<void>;
  pageId: string;
  pageToken: string;
  instagramId: string;
  delay?: (ms: number) => Promise<void>;
};

async function completeSafely(
  deps: WorkerDependencies,
  post: EditorialPost,
  platform: "facebook" | "instagram",
  status: "published" | "failed_retryable" | "unknown",
  externalPostId: string | null = null,
  error: unknown = null,
) {
  await deps.complete(
    post.id,
    platform,
    post.claim_token,
    status,
    externalPostId,
    error ? safeError(error, deps.pageToken) : null,
  );
}

async function processOneDelivery(
  post: EditorialPost,
  delivery: EditorialDelivery,
  assetUrl: string,
  deps: WorkerDependencies,
) {
  if (delivery.platform === "facebook") {
    try {
      const result = await deps.graphPost(`${deps.pageId}/photos`, {
        url: assetUrl,
        caption: post.caption,
        published: "true",
        access_token: deps.pageToken,
      });
      const postId = String(result.post_id || result.id || "");
      if (!postId) throw new MetaRequestError("Meta non ha restituito l'ID del post Facebook", "unknown");
      await completeSafely(deps, post, "facebook", "published", postId);
    } catch (error) {
      await completeSafely(deps, post, "facebook", classifyMetaFailure(error), null, error);
    }
    return;
  }

  try {
    let containerId = String(delivery.external_container_id || "");
    if (!containerId) {
      const container = await deps.graphPost(`${deps.instagramId}/media`, {
        image_url: assetUrl,
        caption: post.caption,
        access_token: deps.pageToken,
      });
      containerId = String(container.id || "");
      if (!containerId) throw new MetaRequestError("Meta non ha restituito l'ID del container Instagram", "unknown");
      if (!await deps.recordContainer(post.id, post.claim_token, containerId)) {
        throw new MetaRequestError("Container Instagram creato ma claim non più valido: riconciliazione richiesta", "unknown");
      }
    }

    let ready = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const state = await deps.graphGet(containerId, {
        fields: "status_code",
        access_token: deps.pageToken,
      });
      if (state.status_code === "ERROR") {
        throw new MetaRequestError("Container Instagram in errore: riconciliazione richiesta", "unknown");
      }
      if (!state.status_code || state.status_code === "FINISHED") {
        ready = true;
        break;
      }
      await (deps.delay || (ms => new Promise(resolve => setTimeout(resolve, ms))))(1500);
    }
    if (!ready) {
      throw new MetaRequestError("Container Instagram ancora in elaborazione", "failed_retryable");
    }

    const published = await deps.graphPost(`${deps.instagramId}/media_publish`, {
      creation_id: containerId,
      access_token: deps.pageToken,
    });
    const mediaId = String(published.id || "");
    if (!mediaId) throw new MetaRequestError("Meta non ha restituito l'ID del post Instagram", "unknown");
    await completeSafely(deps, post, "instagram", "published", mediaId);
  } catch (error) {
    await completeSafely(deps, post, "instagram", classifyMetaFailure(error), null, error);
  }
}

export async function processEditorialClaim(claim: EditorialClaim, deps: WorkerDependencies) {
  const post = claim.post;
  let assetUrl: string;
  try {
    if (!validateEditorialAssetPath(post.asset_path)) {
      throw new Error("Percorso asset editoriale non valido");
    }
    const asset = await deps.loadAsset(post);
    assetUrl = asset.publicUrl;
    const url = new URL(assetUrl);
    if (url.protocol !== "https:") throw new Error("URL asset editoriale non sicuro");
  } catch (error) {
    for (const delivery of claim.deliveries) {
      await completeSafely(deps, post, delivery.platform, "unknown", null, error);
    }
    return;
  }

  for (const delivery of claim.deliveries) {
    await processOneDelivery(post, delivery, assetUrl, deps);
  }
}

function equalSecret(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export async function dispatchEditorialQueue(
  adminClient: RpcClient,
  dispatchEnabled: boolean,
  limit = 10,
) {
  if (!dispatchEnabled) return { claimed: 0, processed: 0, disabled: true };
  const { data, error } = await adminClient.rpc("claim_santalbino_editorial_queue", {
    p_limit: Math.max(1, Math.min(20, limit)),
    p_dispatch_enabled: true,
  });
  if (error) throw new Error("Claim della coda editoriale non riuscito");
  const claims = Array.isArray(data) ? data as EditorialClaim[] : [];
  return { claimed: claims.length, processed: claims.length, disabled: false, claims };
}

if (import.meta.main) Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authorization = req.headers.get("Authorization") || "";
  if (!serviceKey || !equalSecret(authorization, `Bearer ${serviceKey}`)) {
    return json({ error: "Non autorizzato" }, 401);
  }

  const dispatchEnabled =
    Deno.env.get("SOCIAL_EDITORIAL_DISPATCH_ENABLED") === "true" &&
    Deno.env.get("META_PUBLISH_ENABLED") === "true";
  if (!dispatchEnabled) {
    return json({ claimed: 0, processed: 0, disabled: true });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const pageId = Deno.env.get("META_PAGE_ID") || "";
  const pageToken = Deno.env.get("META_PAGE_ACCESS_TOKEN") || "";
  const instagramId = Deno.env.get("META_IG_USER_ID") || "";
  const graphVersion = Deno.env.get("META_GRAPH_API_VERSION") || "v27.0";
  if (!supabaseUrl || !pageId || !pageToken || !instagramId || !/^v\d+\.\d+$/.test(graphVersion)) {
    return json({ error: "Configurazione server-side incompleta" }, 503);
  }

  try {
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const rpcClient = adminClient as unknown as RpcClient;
    const { data, error } = await rpcClient.rpc("claim_santalbino_editorial_queue", {
      p_limit: 10,
      p_dispatch_enabled: true,
    });
    if (error) throw new Error("Claim della coda editoriale non riuscito");
    const claims = Array.isArray(data) ? data as EditorialClaim[] : [];

    for (const claim of claims) {
      const deps: WorkerDependencies = {
        pageId,
        pageToken,
        instagramId,
        graphPost,
        graphGet,
        loadAsset: async (post) => {
          const bucket = Deno.env.get("SOCIAL_EDITORIAL_STORAGE_BUCKET") || "santalbino-editorial";
          const storage = adminClient.storage.from(bucket);
          const { data: file, error: downloadError } = await storage.download(post.asset_path);
          if (downloadError || !file) throw new Error("Download asset editoriale non riuscito");
          const bytes = new Uint8Array(await file.arrayBuffer());
          await validateEditorialAsset(bytes, file.type || "", post.asset_sha256);
          const { data: signed, error: signedError } = await storage.createSignedUrl(post.asset_path, 600);
          if (signedError || !signed?.signedUrl) throw new Error("URL firmato asset editoriale non disponibile");
          const rawSignedUrl = signed.signedUrl;
          const normalizedSignedUrl = rawSignedUrl.startsWith("http")
            ? rawSignedUrl
            : new URL(
              rawSignedUrl.startsWith("/storage/v1/")
                ? rawSignedUrl
                : `/storage/v1${rawSignedUrl.startsWith("/") ? rawSignedUrl : `/${rawSignedUrl}`}`,
              supabaseUrl,
            ).toString();
          const parsedSignedUrl = new URL(normalizedSignedUrl);
          const signedUrl = parsedSignedUrl.toString();
          if (parsedSignedUrl.origin !== new URL(supabaseUrl).origin || parsedSignedUrl.protocol !== "https:") {
            throw new Error("URL firmato asset editoriale non valido");
          }
          return { publicUrl: signedUrl };
        },
        recordContainer: async (postId, token, containerId) => {
          const { data: recorded, error: recordError } = await rpcClient.rpc(
            "record_santalbino_editorial_container",
            { p_post_id: postId, p_platform: "instagram", p_claim_token: token, p_container_id: containerId },
          );
          return !recordError && recorded === true;
        },
        complete: async (postId, platform, token, status, externalPostId, errorSafe) => {
          const { error: completionError } = await rpcClient.rpc("complete_santalbino_editorial_delivery", {
            p_post_id: postId,
            p_platform: platform,
            p_claim_token: token,
            p_status: status,
            p_external_post_id: externalPostId || null,
            p_error_safe: errorSafe || null,
          });
          if (completionError) throw new Error("Registrazione esito delivery non riuscita");
        },
      };
      await processEditorialClaim(claim, deps);
    }

    return json({ claimed: claims.length, processed: claims.length, disabled: false });
  } catch (error) {
    console.error("SANTA Live editorial worker:", safeError(error, pageToken));
    return json({ error: "Errore interno del worker editoriale" }, 500);
  }
});
