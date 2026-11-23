import { createClient } from "npm:@supabase/supabase-js@2.119.2";
import webpush from "npm:web-push@3.6.7";

const CATEGORIES = new Set([
  "kickoff", "halftime", "fulltime", "goal",
  "yellow_card", "red_card", "substitution", "injury", "mvp",
]);
const DEFAULT_CATEGORIES = ["kickoff", "halftime", "fulltime", "goal"];
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function validCategories(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= CATEGORIES.size &&
    value.every((item) => typeof item === "string" && CATEGORIES.has(item)) &&
    new Set(value).size === value.length;
}
async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function validTarget(value: unknown) {
  if (typeof value !== "string" || value.length > 500) return false;
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ||
    (() => { try { return new URL(value).protocol === "https:"; } catch { return false; } })();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Metodo non consentito" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return reply(503, { error: "Configurazione server incompleta" });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const userClient = token ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  }) : null;

  try {
    const input = await req.json();
    const action = cleanText(input?.action, 40);
    const matchKey = cleanText(input?.matchKey, 180);
    if (!matchKey) return reply(400, { error: "Partita non valida" });

    if (action === "subscribe") {
      const subscription = input?.subscription;
      const subscriptionToken = cleanText(input?.subscriptionToken, 160);
      const categories = input?.categories ?? DEFAULT_CATEGORIES;
      const endpoint = cleanText(subscription?.endpoint, 2000);
      const p256dh = cleanText(subscription?.keys?.p256dh, 256);
      const authKey = cleanText(subscription?.keys?.auth, 256);
      if (!subscriptionToken || subscriptionToken.length < 32 ||
          !endpoint.startsWith("https://") || !p256dh || !authKey ||
          !validCategories(categories)) {
        return reply(400, { error: "Sottoscrizione o preferenze non valide" });
      }
      const tokenHash = await sha256(subscriptionToken);
      const { error } = await adminClient.from("santalbino_notification_subscriptions").upsert({
        match_key: matchKey, endpoint, p256dh, auth_key: authKey,
        subscription_token_hash: tokenHash, enabled_categories: categories,
        active: true, revoked_at: null, updated_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });
      if (error) throw error;
      return reply(200, { ok: true, subscribed: true });
    }

    if (action === "unsubscribe" || action === "preferences") {
      const subscriptionToken = cleanText(input?.subscriptionToken, 160);
      if (!subscriptionToken || subscriptionToken.length < 32) {
        return reply(400, { error: "Token di sottoscrizione non valido" });
      }
      const tokenHash = await sha256(subscriptionToken);
      if (action === "unsubscribe") {
        const { error } = await adminClient.from("santalbino_notification_subscriptions")
          .update({ active: false, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("match_key", matchKey).eq("subscription_token_hash", tokenHash);
        if (error) throw error;
        return reply(200, { ok: true, unsubscribed: true });
      }
      if (!validCategories(input?.categories)) return reply(400, { error: "Preferenze non valide" });
      const { error } = await adminClient.from("santalbino_notification_subscriptions")
        .update({ enabled_categories: input.categories, updated_at: new Date().toISOString() })
        .eq("match_key", matchKey).eq("subscription_token_hash", tokenHash).eq("active", true);
      if (error) throw error;
      return reply(200, { ok: true, preferencesUpdated: true });
    }

    if (action === "set-settings" || action === "approve-and-send") {
      if (!userClient || !token) return reply(401, { error: "Accesso regia richiesto" });
      const { data: userData, error: userError } = await userClient.auth.getUser(token);
      if (userError || !userData.user) return reply(401, { error: "Sessione non valida" });
      const { data: isAdmin, error: adminError } = await userClient.rpc("is_santalbino_admin");
      if (adminError || isAdmin !== true) return reply(403, { error: "Amministratore non autorizzato" });

      if (action === "set-settings") {
        if (!validCategories(input?.enabledCategories)) {
          return reply(400, { error: "Categorie abilitate non valide" });
        }
        const { error } = await adminClient.from("santalbino_notification_settings").upsert({
          match_key: matchKey,
          enabled_categories: input.enabledCategories,
          updated_at: new Date().toISOString(),
          updated_by: userData.user.id,
        }, { onConflict: "match_key" });
        if (error) throw error;
        return reply(200, { ok: true, settingsSaved: true });
      }

      const eventId = cleanText(input?.eventId, 180);
      const category = cleanText(input?.category, 40);
      const title = cleanText(input?.title, 120);
      const body = cleanText(input?.body, 500);
      const targetUrl = input?.targetUrl ?? "/";
      if (!eventId || !CATEGORIES.has(category) || !title || !body || !validTarget(targetUrl)) {
        return reply(400, { error: "Dati della notifica non validi" });
      }
      const { data: settings } = await adminClient.from("santalbino_notification_settings")
        .select("enabled_categories").eq("match_key", matchKey).maybeSingle();
      const enabled = settings?.enabled_categories ?? DEFAULT_CATEGORIES;
      if (!enabled.includes(category) && input?.override !== true) {
        return reply(409, { error: "Categoria disattivata: serve una conferma esplicita della regia" });
      }

      const { data: outbox, error: outboxError } = await adminClient
        .from("santalbino_notification_outbox")
        .insert({
          match_key: matchKey, event_id: eventId, category, title, body,
          target_url: targetUrl, approved_by: userData.user.id, status: "sending",
        }).select("id").single();
      if (outboxError?.code === "23505") {
        return reply(409, { error: "Questa notifica per l'evento è già stata approvata o inviata" });
      }
      if (outboxError || !outbox) throw outboxError ?? new Error("Outbox non disponibile");

      const { data: subscribers, error: subscribersError } = await adminClient
        .from("santalbino_notification_subscriptions")
        .select("id,endpoint,p256dh,auth_key")
        .eq("match_key", matchKey).eq("active", true).contains("enabled_categories", [category]);
      if (subscribersError) throw subscribersError;

      const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
      const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
      const subject = Deno.env.get("VAPID_SUBJECT") ?? "";
      if (!publicKey || !privateKey || !subject) {
        await adminClient.from("santalbino_notification_outbox").update({
          status: "failed", last_error: "VAPID non configurate", completed_at: new Date().toISOString(),
        }).eq("id", outbox.id);
        return reply(503, { error: "Chiavi VAPID non configurate: nessuna notifica inviata" });
      }

      webpush.setVapidDetails(subject, publicKey, privateKey);
      const payload = JSON.stringify({
        title, body, url: targetUrl, category,
        icon: "/santa-live-icon.svg", badge: "/santa-live-icon.svg",
        tag: `santalive-${matchKey}-${eventId}`,
      });
      const results = await Promise.allSettled((subscribers ?? []).map(async (subscriber) => {
        try {
          await webpush.sendNotification({
            endpoint: subscriber.endpoint,
            keys: { p256dh: subscriber.p256dh, auth: subscriber.auth_key },
          }, payload, { TTL: 300, urgency: "high" });
          return { id: subscriber.id, sent: true };
        } catch (error) {
          const statusCode = (error as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await adminClient.from("santalbino_notification_subscriptions").update({
              active: false, revoked_at: new Date().toISOString(),
            }).eq("id", subscriber.id);
          }
          throw error;
        }
      }));
      const delivered = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - delivered;
      const status = failed === 0 ? "sent" : delivered === 0 ? "failed" : "sent_with_errors";
      const errorSummary = failed ? `${failed} invii non riusciti; endpoint scaduti disattivati quando riconosciuti` : null;
      const { error: updateError } = await adminClient.from("santalbino_notification_outbox").update({
        status, recipient_count: results.length, delivered_count: delivered,
        failed_count: failed, last_error: errorSummary, completed_at: new Date().toISOString(),
      }).eq("id", outbox.id);
      if (updateError) throw updateError;
      return reply(200, { ok: true, status, recipients: results.length, delivered, failed });
    }

    return reply(400, { error: "Azione non riconosciuta" });
  } catch (error) {
    console.error("santalive-notifications:", error);
    return reply(500, { error: "Operazione notifiche non riuscita" });
  }
});
