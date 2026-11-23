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
  return message.slice(0, 500);
}

async function graphGet(path: string, params: Record<string, string>) {
  const url = new URL(`${graphBase}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `Meta Graph API HTTP ${response.status}`);
  }
  return data;
}

async function graphPost(path: string, params: Record<string, string>) {
  const response = await fetch(`${graphBase}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `Meta Graph API HTTP ${response.status}`);
  }
  return data;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req: Request) => {
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
    const imageCheck = await fetch(imageUrl, { method: "HEAD" });
    if (!imageCheck.ok || !String(imageCheck.headers.get("content-type") || "").startsWith("image/")) {
      return json({ error: "Immagine non raggiungibile o formato non supportato" }, 400);
    }
    const contentLength = Number(imageCheck.headers.get("content-length") || 0);
    if (contentLength && contentLength > 8 * 1024 * 1024) {
      return json({ error: "Immagine superiore al limite di 8 MB" }, 400);
    }

    const { data: existing, error: lookupError } = await adminClient
      .from("santalbino_social_publications")
      .select("*")
      .eq("event_id", eventId)
      .maybeSingle();
    if (lookupError) return json({ error: "Lettura registro social non riuscita" }, 500);
    if (existing?.overall_status === "published") {
      return json({ status: "published", duplicate: true, facebook: existing.facebook_status, instagram: existing.instagram_status });
    }
    if (existing?.overall_status === "processing" &&
        Date.now() - new Date(existing.updated_at).getTime() < 120000) {
      return json({ status: "processing", duplicate: true, message: "Questo evento è già in elaborazione" }, 202);
    }

    const initial = {
      event_id: eventId,
      match_id: matchId || null,
      event_type: eventType,
      caption,
      image_url: imageUrl,
      platforms,
      overall_status: "processing",
      facebook_status: platforms.facebook
        ? (existing?.facebook_status === "published" ? "published" : "processing")
        : (existing?.facebook_status === "published" ? "published" : "skipped"),
      instagram_status: platforms.instagram
        ? (existing?.instagram_status === "published" ? "published" : "processing")
        : (existing?.instagram_status === "published" ? "published" : "skipped"),
      facebook_error: null,
      instagram_error: null,
      updated_at: new Date().toISOString(),
    };
    let row = existing;
    if (row) {
      const { data, error } = await adminClient.from("santalbino_social_publications")
        .update(initial).eq("id", row.id).select("*").single();
      if (error) return json({ error: "Aggiornamento registro social non riuscito" }, 500);
      row = data;
    } else {
      const { data, error } = await adminClient.from("santalbino_social_publications")
        .insert(initial).select("*").single();
      if (error) {
        if (error.code === "23505") {
          return json({ status: "processing", duplicate: true, message: "Evento già acquisito dal registro" }, 202);
        }
        return json({ error: "Creazione registro social non riuscita" }, 500);
      }
      row = data;
    }

    let facebookStatus = initial.facebook_status;
    let instagramStatus = initial.instagram_status;
    let facebookPostId = row.facebook_post_id || null;
    let instagramContainerId = row.instagram_container_id || null;
    let instagramMediaId = row.instagram_media_id || null;
    let facebookError: string | null = null;
    let instagramError: string | null = null;

    const persist = async () => {
      const { error } = await adminClient.from("santalbino_social_publications").update({
        facebook_status: facebookStatus,
        instagram_status: instagramStatus,
        facebook_post_id: facebookPostId,
        instagram_container_id: instagramContainerId,
        instagram_media_id: instagramMediaId,
        facebook_error: facebookError,
        instagram_error: instagramError,
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      if (error) throw new Error("Salvataggio esito pubblicazione non riuscito");
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
        facebookStatus = "failed";
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
        instagramStatus = "failed";
        instagramError = safeError(error, pageToken);
      }
      await persist();
    }

    const allPublished = (!platforms.facebook || facebookStatus === "published") &&
      (!platforms.instagram || instagramStatus === "published");
    const anyPublished = (platforms.facebook && facebookStatus === "published") ||
      (platforms.instagram && instagramStatus === "published");
    const overallStatus = allPublished ? "published" : anyPublished ? "partial" : "failed";
    const { error: finalError } = await adminClient.from("santalbino_social_publications").update({
      overall_status: overallStatus,
      published_at: allPublished ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    if (finalError) return json({ error: "Pubblicazione completata ma registro finale non aggiornato" }, 500);

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
