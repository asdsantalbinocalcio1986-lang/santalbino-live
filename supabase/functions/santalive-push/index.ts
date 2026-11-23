import { createClient } from "npm:@supabase/supabase-js@2.119.2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:polisportivasantalbinocalcio1986@gmail.com";
const ALLOWED_ORIGINS = new Set([
  "https://asdsantalbinocalcio1986-lang.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
]);
const EVENT_TYPES = new Set(["kickoff","halftime","fulltime","goal","yellow","red","sub","mvp"]);
const DEFAULT_EVENT_TYPES = ["kickoff","halftime","fulltime","goal"];

const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://asdsantalbinocalcio1986-lang.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
});
const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } });

function validSubscription(value: any) {
  try {
    const endpoint = new URL(String(value?.endpoint || ""));
    return endpoint.protocol === "https:" &&
      typeof value?.keys?.p256dh === "string" && value.keys.p256dh.length >= 20 &&
      typeof value?.keys?.auth === "string" && value.keys.auth.length >= 10;
  } catch { return false; }
}
function configureVapid() {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error("VAPID_NOT_CONFIGURED");
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}
function safeMatchUrl(value: unknown) {
  const fallback = "https://asdsantalbinocalcio1986-lang.github.io/santalbino-live/home.html";
  try {
    const url = new URL(String(value || fallback));
    if (url.origin !== "https://asdsantalbinocalcio1986-lang.github.io" ||
        !url.pathname.startsWith("/santalbino-live/")) return fallback;
    return url.href;
  } catch { return fallback; }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origine non autorizzata" }, 403, origin);

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Servizio database non configurato" }, 503, origin);
    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json();
    const action = String(body?.action || "");

    if (action === "public-key") {
      if (!VAPID_PUBLIC_KEY) return json({ error: "Servizio notifiche non ancora configurato" }, 503, origin);
      return json({ publicKey: VAPID_PUBLIC_KEY }, 200, origin);
    }

    if (action === "subscribe") {
      const subscription = body?.subscription;
      if (!validSubscription(subscription)) return json({ error: "Sottoscrizione non valida" }, 400, origin);
      const requested = Array.isArray(body?.eventTypes) ? body.eventTypes : DEFAULT_EVENT_TYPES;
      const eventTypes = [...new Set(requested.map((x: unknown) => String(x)).filter((x: string) => EVENT_TYPES.has(x)))];
      if (!eventTypes.length) return json({ error: "Seleziona almeno una tipologia di notifica" }, 400, origin);
      const { error } = await service.from("santalbino_push_subscriptions").upsert({
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        match_id: String(body?.matchId || "").slice(0, 160) || null,
        event_types: eventTypes,
        updated_at: new Date().toISOString()
      }, { onConflict: "endpoint" });
      if (error) throw error;
      return json({ status: "subscribed", eventTypes }, 200, origin);
    }

    if (action === "unsubscribe") {
      const endpoint = String(body?.subscription?.endpoint || "");
      if (!endpoint.startsWith("https://")) return json({ error: "Endpoint non valido" }, 400, origin);
      const { error } = await service.from("santalbino_push_subscriptions").delete().eq("endpoint", endpoint);
      if (error) throw error;
      return json({ status: "unsubscribed" }, 200, origin);
    }

    if (action !== "send") return json({ error: "Azione non riconosciuta" }, 400, origin);
    if (body?.approved !== true) return json({ error: "Invio non approvato dalla regia" }, 403, origin);
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token || !SUPABASE_ANON_KEY) return json({ error: "Sessione amministratore richiesta" }, 401, origin);
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: userResult, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userResult?.user) return json({ error: "Sessione non valida" }, 401, origin);
    const { data: admin, error: adminError } = await service.from("santalbino_admins")
      .select("user_id").eq("user_id", userResult.user.id).maybeSingle();
    if (adminError || !admin) return json({ error: "Amministratore non autorizzato" }, 403, origin);

    const eventId = String(body?.eventId || "").slice(0, 180);
    const eventType = String(body?.eventType || "");
    if (!eventId || !EVENT_TYPES.has(eventType)) return json({ error: "Evento non valido" }, 400, origin);
    const { data: live, error: liveError } = await service.from("live_state").select("state").eq("id", 1).maybeSingle();
    if (liveError || !live?.state) return json({ error: "Stato partita non disponibile" }, 409, origin);
    const state = live.state;
    const prefs = state.notifications || {};
    if (prefs.enabled !== true || prefs.types?.[eventType] !== true) {
      return json({ error: "Questa tipologia è disattivata nelle preferenze della regia" }, 403, origin);
    }
    const isMvpInvite = eventType === "mvp" && eventId === String(state.match?.pollId || "") + ":mvp";
    const eventExists = (state.events || []).some((event: any) => String(event.id) === eventId && event.type === eventType);
    if (!eventExists && !isMvpInvite) return json({ error: "L'evento non risulta registrato nella partita ufficiale" }, 409, origin);
    if (isMvpInvite) {
      const hasFullTime = (state.events || []).some((event: any) => event.type === "fulltime");
      const selected = state.mvp?.selectedCandidates;
      const hasHome = Array.isArray(selected) && selected.some((key: string) => key.startsWith("home|"));
      const hasAway = Array.isArray(selected) && selected.some((key: string) => key.startsWith("away|"));
      if (!hasFullTime || !Array.isArray(selected) || selected.length !== 4 || !hasHome || !hasAway) {
        return json({ error: "La votazione MVP non è pronta" }, 409, origin);
      }
    }

    const { data: previous } = await service.from("santalbino_push_deliveries")
      .select("status").eq("event_id", eventId).maybeSingle();
    if (previous?.status === "sent") return json({ status: "already_sent", sent: 0 }, 200, origin);
    const { error: logError } = await service.from("santalbino_push_deliveries").upsert({
      event_id: eventId, event_type: eventType, status: "sending", last_error: null, updated_at: new Date().toISOString()
    }, { onConflict: "event_id" });
    if (logError) throw logError;

    const matchId = String(state.match?.pollId || "");
    const title = String(body?.title || "SANTALive").slice(0, 90);
    const message = String(body?.body || "Aggiornamento della partita").slice(0, 180);
    const url = safeMatchUrl(body?.url);
    const { error: noticeError } = await service.from("santalbino_live_notifications").upsert({
      event_id: eventId, match_id: matchId, event_type: eventType, title, body: message, url
    }, { onConflict: "event_id", ignoreDuplicates: true });
    if (noticeError) throw noticeError;
    const { data: rows, error: rowsError } = await service.from("santalbino_push_subscriptions")
      .select("endpoint,p256dh,auth,match_id,event_types").contains("event_types", [eventType]);
    if (rowsError) throw rowsError;
    const recipients = (rows || []).filter((row: any) => !row.match_id || row.match_id === matchId);
    if (!recipients.length) {
      await service.from("santalbino_push_deliveries").update({ status: "no_subscribers", sent_count: 0, failed_count: 0, updated_at: new Date().toISOString() }).eq("event_id", eventId);
      return json({ status: "no_subscribers", sent: 0, message: "Avviso in-app pubblicato; nessun dispositivo push iscritto a questa tipologia" }, 200, origin);
    }

    configureVapid();
    const payload = JSON.stringify({ title, body: message, url, tag: "santalive-" + eventId });
    let sent = 0, failed = 0;
    const results = await Promise.allSettled(recipients.map(async (row: any) => {
      const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        await webpush.sendNotification(subscription, payload, { TTL: 300 });
        sent++;
      } catch (error: any) {
        failed++;
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await service.from("santalbino_push_subscriptions").delete().eq("endpoint", row.endpoint);
        }
        throw error;
      }
    }));
    const errors = results.filter(result => result.status === "rejected").length;
    const status = sent > 0 ? "sent" : "failed";
    await service.from("santalbino_push_deliveries").update({
      status, sent_count: sent, failed_count: errors,
      last_error: errors ? "Uno o più dispositivi non hanno ricevuto la notifica" : null,
      updated_at: new Date().toISOString()
    }).eq("event_id", eventId);
    return json({ status, sent, failed: errors }, 200, origin);
  } catch (error: any) {
    console.error("SANTA Live push:", error);
    const message = error?.message === "VAPID_NOT_CONFIGURED"
      ? "Configura VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT in Supabase"
      : "Invio notifiche non riuscito";
    return json({ error: message }, 500, origin);
  }
});
