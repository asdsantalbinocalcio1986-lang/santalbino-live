import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const allowedEvents = new Set(["goal", "red", "halftime", "fulltime"]);
const graphVersion = Deno.env.get("META_GRAPH_API_VERSION") || "v27.0";
const graphBase = `https://graph.facebook.com/${graphVersion}`;

function safeError(error: unknown, token?: string) {
  let message = error instanceof Error ? error.message : String(error);
  if (token) message = message.split(token).join("[token oscurato]");
  message = message.replace(/access_token=[^&\\s]+/gi, "access_token=[redacted]");
  return message.slice(0, 300);
}

export class MetaRequestError extends Error {
  constructor(message: string, readonly outcome: "unknown" | "failed_retryable") {
    super(message);
    this.name = "MetaRequestError";
  }
}

export function classifyMetaFailure(error: unknown): "unknown" | "failed_retryable" {
  return error instanceof MetaRequestError ? error.outcome : "unknown";
}

async function graphGet(path: string, params: Record<string, string>) {
  const url = new URL(`${graphBase}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new MetaRequestError("Lettura Meta temporaneamente non disponibile", "failed_retryable");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.error || !data) {
    throw new MetaRequestError(`Lettura Meta HTTP ${response.status}`, "failed_retryable");
  }
  return data;
}

async function graphPost(path: string, params: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(`${graphBase}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    // La richiesta potrebbe essere stata accettata prima dell'interruzione.
    throw new MetaRequestError("Esito della richiesta Meta non determinabile", "unknown");
  }
  const data = await response.json().catch(() => null);
  if (!data) {
    throw new MetaRequestError("Risposta Meta illeggibile: esito non determinabile", "unknown");
  }
  if (!response.ok || data.error) {
    if (response.status >= 500 || response.status === 0) {
      throw new MetaRequestError(`Meta Graph API HTTP ${response.status}: esito non determinabile`, "unknown");
    }
    throw new MetaRequestError(`Meta Graph API HTTP ${response.status}: richiesta rifiutata`, "failed_retryable");
  }
  return data;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

if (import.meta.main) Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: "Configurazione Supabase incompleta" }, 503);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) return json({ error: "Autenticazione richiesta" }, 401);

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(bearer);
    if (userError || !userData.user) return json({ error: "Sessione non valida" }, 401);

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: admin, error: adminError } = await adminClient
      .from("santalbino_admins")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (adminError) return json({ error: "Verifica autorizzazioni non riuscita" }, 500);
    if (!admin) return json({ error: "Solo l'amministratore SANTA Live può pubblicare" }, 403);

    const pageId = Deno.env.get("META_PAGE_ID") || "";
    const pageToken = Deno.env.get("META_PAGE_ACCESS_TOKEN") || "";
    const instagramId = Deno.env.get("META_IG_USER_ID") || "";
    const publishingEnabled = Deno.env.get("META_PUBLISH_ENABLED") === "true";
    if (!/^v\d+\.\d+$/.test(graphVersion)) {
      return json({ ready: false, missing: ["META_GRAPH_API_VERSION"], message: "Versione Graph API non valida" });
    }

    const body = await req.json().catch(() => ({}));
    if (body.action === "status") {
      const missing = [
        ...(!pageId ? ["META_PAGE_ID"] : []),
        ...(!pageToken ? ["META_PAGE_ACCESS_TOKEN"] : []),
        ...(!instagramId ? ["META_IG_USER_ID"] : []),
      ];
      if (missing.length) return json({ ready: false, publishingEnabled, missing, message: "Inserisci i segreti Meta in Supabase" });
      try {
        const page = await graphGet(pageId, {
          fields: "id,name,connected_instagram_account{id,username}",
          access_token: pageToken,
        });
        const linkedInstagram = page.connected_instagram_account || null;
        const linkedInstagramId = String(linkedInstagram?.id || "");
        if (!linkedInstagramId) {
          return json({
            ready: false,
            publishingEnabled,
            missing: [],
            message: "La Pagina Facebook non restituisce un account Instagram collegato. Controlla Account collegati nelle impostazioni della Pagina.",
          });
        }
        if (linkedInstagramId !== instagramId) {
          return json({
            ready: false,
            publishingEnabled,
            missing: [],
            message: "L'ID Instagram configurato non coincide con l'account collegato alla Pagina Facebook.",
          });
        }
        return json({
          ready: true,
          publishingEnabled,
          page: { id: page.id, name: page.name || "" },
          instagram: { id: linkedInstagramId, username: linkedInstagram.username || "" },
        });
      } catch (error) {
        return json({ ready: false, publishingEnabled, missing: [], message: safeError(error, pageToken) });
      }
    }

    if (body.action !== "publish") return json({ error: "Azione non riconosciuta" }, 400);
    if (!publishingEnabled) {
      return json({ error: "Pubblicazione bloccata lato server: META_PUBLISH_ENABLED non è attivo." }, 403);
    }
    const eventId = String(body.eventId || "").trim();
    const matchId = String(body.matchId || "").trim().slice(0, 180);
    const eventType = String(body.eventType || "");
    const caption = String(body.caption || "").trim().slice(0, 2200);
    const imageUrl = String(body.imageUrl || "");
    const platforms = {
      facebook: body.platforms?.facebook === true,
      instagram: body.platforms?.instagram === true,
    };
    if (!eventId || eventId.length > 180 || !allowedEvents.has(eventType) || !caption ||
        (!platforms.facebook && !platforms.instagram)) {
      return json({ error: "Dati evento o piattaforme non validi" }, 400);
    }
    if ((platforms.facebook && (!pageId || !pageToken)) || (platforms.instagram && (!instagramId || !pageToken))) {
      return json({ error: "Segreti Meta mancanti: verifica la configurazione" }, 503);
    }

    let image: URL;
    try { image = new URL(imageUrl); } catch { return json({ error: "URL immagine non valido" }, 400); }
    const projectOrigin = new URL(supabaseUrl).origin;
    if (image.origin !== projectOrigin ||
        !image.pathname.startsWith("/storage/v1/object/public/santalbino-media/social/")) {
      return json({ error: "L'immagine deve provenire dall'archivio social pubblico SANTA Live" }, 400);
    }
    const imageCheck = await fetch(imageUrl, { method: "HEAD", signal: AbortSignal.timeout(10000) });
    if (!imageCheck.ok || !String(imageCheck.headers.get("content-type") || "").startsWith("image/")) {
      return json({ error: "Immagine non raggiungibile o formato non supportato" }, 400);
    }
    const contentLength = Number(imageCheck.headers.get("content-length") || 0);
    if (contentLength && contentLength > 8 * 1024 * 1024) {
      return json({ error: "Immagine superiore al limite di 8 MB" }, 400);
    }

    const { data: claim, error: claimError } = await adminClient.rpc(
      "claim_santalbino_social_publication",
      {
        p_event_id: eventId,
        p_match_id: matchId,
        p_event_type: eventType,
        p_caption: caption,
        p_image_url: imageUrl,
        p_platforms: platforms,
      },
    );
    if (claimError || !claim) {
      return json({ error: "Acquisizione pubblicazione non riuscita" }, 500);
    }
    if (claim.result !== "claimed") {
      const status = claim.result === "already_published" ? "published"
        : claim.result === "reconciliation_required" ? "reconciliation_required"
        : "processing";
      return json({
        status,
        duplicate: true,
        message: claim.result === "reconciliation_required"
          ? "Esito precedente da riconciliare: nessun nuovo invio a Meta è stato avviato."
          : "Evento già acquisito o pubblicato.",
      }, status === "published" ? 200 : 202);
    }

    const row = claim.row;
    const claimToken = String(claim.claim_token || "");
    if (!row?.id || !claimToken) {
      return json({ error: "Claim incompleto: pubblicazione bloccata in sicurezza" }, 500);
    }
    const initial = {
      facebook_status: row.facebook_status,
      instagram_status: row.instagram_status,
    };
    let facebookStatus = initial.facebook_status;
    let instagramStatus = initial.instagram_status;
    let facebookPostId = row.facebook_post_id || null;
    let instagramContainerId = row.instagram_container_id || null;
    let instagramMediaId = row.instagram_media_id || null;
    let facebookError: string | null = null;
    let instagramError: string | null = null;

    const persist = async () => {
      const { data, error } = await adminClient.from("santalbino_social_publications").update({
        facebook_status: facebookStatus,
        instagram_status: instagramStatus,
        facebook_post_id: facebookPostId,
        instagram_container_id: instagramContainerId,
        instagram_media_id: instagramMediaId,
        facebook_error: facebookError,
        instagram_error: instagramError,
        updated_at: new Date().toISOString(),
      }).eq("id", row.id).eq("claim_token", claimToken).select("id").maybeSingle();
      if (error || !data) throw new Error("Salvataggio esito pubblicazione non riuscito o claim non più valido");
    };

    if (platforms.facebook && facebookStatus !== "published") {
      try {
        const result = await graphPost(`${pageId}/photos`, {
          url: imageUrl,
          caption,
          published: "true",
          access_token: pageToken,
        });
        facebookPostId = String(result.post_id || result.id || "");
        if (!facebookPostId) throw new Error("Meta non ha restituito l'ID del post Facebook");
        facebookStatus = "published";
      } catch (error) {
        facebookStatus = classifyMetaFailure(error);
        facebookError = safeError(error, pageToken);
      }
      await persist();
    }

    if (platforms.instagram && instagramStatus !== "published") {
      try {
        if (!instagramContainerId) {
          const container = await graphPost(`${instagramId}/media`, {
            image_url: imageUrl,
            caption,
            access_token: pageToken,
          });
          instagramContainerId = String(container.id || "");
          if (!instagramContainerId) throw new Error("Meta non ha restituito l'ID del contenitore Instagram");
          await persist();
        }
        let ready = false;
        for (let attempt = 0; attempt < 8; attempt++) {
          const state = await graphGet(instagramContainerId, { fields: "status_code", access_token: pageToken });
          if (state.status_code === "ERROR") throw new Error("Meta non ha elaborato l'immagine Instagram");
          if (!state.status_code || state.status_code === "FINISHED") { ready = true; break; }
          await wait(1500);
        }
        if (!ready) throw new Error("Elaborazione immagine Instagram ancora in corso; riprova dal registro");
        const published = await graphPost(`${instagramId}/media_publish`, {
          creation_id: instagramContainerId,
          access_token: pageToken,
        });
        instagramMediaId = String(published.id || "");
        if (!instagramMediaId) throw new Error("Meta non ha restituito l'ID del post Instagram");
        instagramStatus = "published";
      } catch (error) {
        instagramStatus = classifyMetaFailure(error);
        instagramError = safeError(error, pageToken);
      }
      await persist();
    }

    const allPublished = (!platforms.facebook || facebookStatus === "published") &&
      (!platforms.instagram || instagramStatus === "published");
    const anyPublished = (platforms.facebook && facebookStatus === "published") ||
      (platforms.instagram && instagramStatus === "published");
    const hasUnknown = facebookStatus === "unknown" || instagramStatus === "unknown";
    const overallStatus = hasUnknown ? "reconciliation_required"
      : allPublished ? "published" : anyPublished ? "partial" : "failed";
    const { data: finalized, error: finalError } = await adminClient.from("santalbino_social_publications").update({
      overall_status: overallStatus,
      published_at: allPublished ? new Date().toISOString() : null,
      claim_token: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id).eq("claim_token", claimToken).select("id").maybeSingle();
    if (finalError || !finalized) return json({ error: "Pubblicazione completata ma registro finale non aggiornato; riconciliazione necessaria" }, 500);

    return json({
      status: overallStatus,
      facebook: facebookStatus,
      instagram: instagramStatus,
      facebookError,
      instagramError,
    });
  } catch (error) {
    console.error("SANTA Live social publisher:", safeError(error));
    return json({ error: "Errore interno durante la pubblicazione social" }, 500);
  }
});
