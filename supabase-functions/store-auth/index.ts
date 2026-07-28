import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REFERRAL_CODE_RE = /^VENUS-[A-Z0-9]{4}$/;
const PROFILE_COLS =
  "snapchat_name, referral_code, phone_country_code, phone_national, location_label, location_lat, location_lng, verified, verified_at";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function snapchatToEmail(snapchatName: string): string {
  const bytes = new TextEncoder().encode(snapchatName);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${b64}@accounts.venus-store.local`;
}

function normalizeRecoveryKey(key: string): string {
  return key.replace(/[-\s]/g, "").toUpperCase();
}

/** Accept full VENUS-XXXX or just the 4-char suffix. */
function normalizeReferralCode(raw: string): string {
  let code = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!code) return "";
  if (!code.startsWith("VENUS-") && /^[A-Z0-9]{4}$/.test(code)) {
    code = `VENUS-${code}`;
  }
  return code;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomFromAlphabet(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

function generateRecoveryKey(): string {
  return randomFromAlphabet(20).match(/.{1,4}/g)!.join("-");
}

function generateReferralCode(): string {
  return `VENUS-${randomFromAlphabet(4)}`;
}

async function mintUniqueReferralCode(
  // deno-lint-ignore no-explicit-any
  admin: any,
): Promise<string> {
  for (let attempt = 0; attempt < 32; attempt++) {
    const code = generateReferralCode();
    const { data, error } = await admin
      .from("store_accounts")
      .select("id")
      .eq("referral_code", code)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return code;
  }
  throw new Error("Could not mint a unique referral code.");
}

function profilePayload(row: Record<string, unknown>) {
  return {
    snapchat_name: row.snapchat_name || "",
    referral_code: row.referral_code || "",
    phone_country_code: row.phone_country_code || "256",
    phone_national: row.phone_national || "",
    location_label: row.location_label || "",
    location_lat: row.location_lat ?? null,
    location_lng: row.location_lng ?? null,
    verified: Boolean(row.verified),
    verified_at: row.verified_at ?? null,
  };
}

function bearerToken(req: Request): string {
  const header = req.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const payload = await req.json();
    const action = String(payload?.action || "");
    const snapchatName =
      typeof payload?.snapchat_name === "string"
        ? payload.snapchat_name.trim()
        : "";
    const password =
      typeof payload?.password === "string" ? payload.password : "";
    const recoveryKey =
      typeof payload?.recovery_key === "string" ? payload.recovery_key : "";
    const newPassword =
      typeof payload?.new_password === "string" ? payload.new_password : "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);
    const anon = createClient(supabaseUrl, anonKey);

    async function requireUser() {
      const token = bearerToken(req);
      if (!token || token === anonKey) {
        return { error: json({ error: "Sign in to manage your account." }, 401) };
      }
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) {
        return { error: json({ error: "Session expired. Please sign in again." }, 401) };
      }
      return { user: data.user };
    }

    if (action === "admin_list_users") {
      const { data, error } = await admin
        .from("store_accounts")
        .select(
          "id, snapchat_name, referral_code, referred_by, phone_country_code, phone_national, location_label, location_lat, location_lng, verified, verified_at, created_at, updated_at",
        )
        .order("created_at", { ascending: true });
      if (error) return json({ error: error.message }, 500);

      const rows = data || [];
      const referrerIds = [
        ...new Set(
          rows
            .map((row: { referred_by?: string | null }) => row.referred_by)
            .filter((id: string | null | undefined): id is string => Boolean(id)),
        ),
      ];

      /** @type {Record<string, { snapchat_name: string; referral_code: string }> } */
      const referrersById: Record<
        string,
        { snapchat_name: string; referral_code: string }
      > = {};

      if (referrerIds.length) {
        const { data: referrers, error: referrerErr } = await admin
          .from("store_accounts")
          .select("id, snapchat_name, referral_code")
          .in("id", referrerIds);
        if (referrerErr) return json({ error: referrerErr.message }, 500);
        for (const ref of referrers || []) {
          referrersById[ref.id] = {
            snapchat_name: ref.snapchat_name || "",
            referral_code: ref.referral_code || "",
          };
        }
      }

      const users = rows.map(
        (row: Record<string, unknown> & { referred_by?: string | null }) => {
          const referrer = row.referred_by
            ? referrersById[row.referred_by]
            : null;
          return {
            ...row,
            verified: Boolean(row.verified),
            referred_by_name: referrer?.snapchat_name || "",
            referred_by_code: referrer?.referral_code || "",
          };
        },
      );

      return json({ users });
    }

    if (action === "admin_delete_user") {
      const userId = typeof payload?.user_id === "string" ? payload.user_id.trim() : "";
      if (!userId) return json({ error: "user_id is required." }, 400);
      const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
      if (deleteErr) return json({ error: deleteErr.message }, 500);
      await admin.from("store_accounts").delete().eq("id", userId);
      return json({ ok: true });
    }

    if (action === "admin_set_verified") {
      const userId = typeof payload?.user_id === "string" ? payload.user_id.trim() : "";
      if (!userId) return json({ error: "user_id is required." }, 400);
      const verified = Boolean(payload?.verified);
      const now = new Date().toISOString();
      const { data, error } = await admin
        .from("store_accounts")
        .update({
          verified,
          verified_at: verified ? now : null,
          updated_at: now,
        })
        .eq("id", userId)
        .select("id, verified, verified_at")
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "Account not found." }, 404);
      return json({ ok: true, verified: Boolean(data.verified), verified_at: data.verified_at });
    }

    if (action === "get_profile" || action === "update_profile" || action === "delete_account") {
      const auth = await requireUser();
      if ("error" in auth && auth.error) return auth.error;
      const user = auth.user!;

      if (action === "get_profile") {
        const { data: account, error: accountErr } = await admin
          .from("store_accounts")
          .select(PROFILE_COLS)
          .eq("id", user.id)
          .maybeSingle();

        if (accountErr) return json({ error: accountErr.message }, 500);
        if (!account) return json({ error: "Account not found." }, 404);

        if (!account.referral_code) {
          try {
            const code = await mintUniqueReferralCode(admin);
            const { data: patched, error: patchErr } = await admin
              .from("store_accounts")
              .update({ referral_code: code, updated_at: new Date().toISOString() })
              .eq("id", user.id)
              .select(PROFILE_COLS)
              .single();
            if (!patchErr && patched) {
              return json({ profile: profilePayload(patched) });
            }
          } catch (_) {
            /* fall through with empty code */
          }
        }

        return json({ profile: profilePayload(account) });
      }

      if (action === "delete_account") {
        const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id);
        if (deleteErr) return json({ error: deleteErr.message }, 500);
        return json({ ok: true });
      }

      const { data: current, error: currentErr } = await admin
        .from("store_accounts")
        .select(PROFILE_COLS)
        .eq("id", user.id)
        .maybeSingle();

      if (currentErr) return json({ error: currentErr.message }, 500);
      if (!current) return json({ error: "Account not found." }, 404);

      const nextName =
        typeof payload?.snapchat_name === "string"
          ? payload.snapchat_name.trim()
          : current.snapchat_name;

      if (!nextName || nextName.length > 64) {
        return json({ error: "Enter a valid Snapchat name." }, 400);
      }

      const phoneCountryCode =
        typeof payload?.phone_country_code === "string"
          ? payload.phone_country_code.replace(/\D/g, "").slice(0, 4) || "256"
          : current.phone_country_code || "256";
      const phoneNational =
        typeof payload?.phone_national === "string"
          ? payload.phone_national.replace(/\D/g, "").slice(0, 15)
          : current.phone_national || "";
      const locationLabel =
        typeof payload?.location_label === "string"
          ? payload.location_label.trim().slice(0, 240)
          : current.location_label || "";

      let locationLat =
        payload?.location_lat === null
          ? null
          : typeof payload?.location_lat === "number"
          ? payload.location_lat
          : current.location_lat;
      let locationLng =
        payload?.location_lng === null
          ? null
          : typeof payload?.location_lng === "number"
          ? payload.location_lng
          : current.location_lng;

      if (typeof locationLat === "number" && !Number.isFinite(locationLat)) locationLat = null;
      if (typeof locationLng === "number" && !Number.isFinite(locationLng)) locationLng = null;

      if (nextName !== current.snapchat_name) {
        const { data: clash, error: clashErr } = await admin
          .from("store_accounts")
          .select("id")
          .eq("snapchat_name", nextName)
          .neq("id", user.id)
          .maybeSingle();

        if (clashErr) return json({ error: clashErr.message }, 500);
        if (clash) {
          return json({ error: "That Snapchat name already has an account." }, 409);
        }

        const { error: authUpdateErr } = await admin.auth.admin.updateUserById(user.id, {
          email: snapchatToEmail(nextName),
          user_metadata: { snapchat_name: nextName },
          email_confirm: true,
        });
        if (authUpdateErr) return json({ error: authUpdateErr.message }, 500);
      }

      const { data: updated, error: updateErr } = await admin
        .from("store_accounts")
        .update({
          snapchat_name: nextName,
          phone_country_code: phoneCountryCode,
          phone_national: phoneNational,
          location_label: locationLabel,
          location_lat: locationLat,
          location_lng: locationLng,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)
        .select(PROFILE_COLS)
        .single();

      if (updateErr) return json({ error: updateErr.message }, 500);
      return json({ ok: true, profile: profilePayload(updated) });
    }

    if (!snapchatName || snapchatName.length > 64) {
      return json({ error: "Enter your exact Snapchat name." }, 400);
    }

    const email = snapchatToEmail(snapchatName);

    if (action === "signup") {
      if (password.length < 6) {
        return json({ error: "Password must be at least 6 characters." }, 400);
      }

      const referralInput =
        typeof payload?.referral_code === "string" ? payload.referral_code : "";
      const referralCode = normalizeReferralCode(referralInput);
      if (!referralCode) {
        return json({ error: "Enter a referral code from an existing user." }, 400);
      }
      if (!REFERRAL_CODE_RE.test(referralCode)) {
        return json({ error: "Referral code must look like VENUS-XXXX." }, 400);
      }

      const { data: referrer, error: referrerErr } = await admin
        .from("store_accounts")
        .select("id, snapchat_name")
        .eq("referral_code", referralCode)
        .maybeSingle();

      if (referrerErr) return json({ error: referrerErr.message }, 500);
      if (!referrer) {
        return json({ error: "That referral code is not valid." }, 400);
      }

      const { data: existing, error: existingErr } = await admin
        .from("store_accounts")
        .select("id")
        .eq("snapchat_name", snapchatName)
        .maybeSingle();

      if (existingErr) return json({ error: existingErr.message }, 500);
      if (existing) {
        return json({ error: "That Snapchat name already has an account." }, 409);
      }

      const plainRecoveryKey = generateRecoveryKey();
      const recovery_key_hash = await sha256Hex(normalizeRecoveryKey(plainRecoveryKey));
      const own_referral_code = await mintUniqueReferralCode(admin);

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { snapchat_name: snapchatName },
        app_metadata: { store_auth: true },
      });

      if (createErr || !created.user) {
        return json({ error: createErr?.message || "Could not create account." }, 400);
      }

      const { error: insertErr } = await admin.from("store_accounts").insert({
        id: created.user.id,
        snapchat_name: snapchatName,
        recovery_key_hash,
        referral_code: own_referral_code,
        referred_by: referrer.id,
      });

      if (insertErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: insertErr.message }, 500);
      }

      const { data: sessionData, error: signInErr } = await anon.auth.signInWithPassword({
        email,
        password,
      });

      if (signInErr || !sessionData.session) {
        return json({
          recovery_key: plainRecoveryKey,
          referral_code: own_referral_code,
          session: null,
          snapchat_name: snapchatName,
          message: "Account created. Copy your recovery key, then log in.",
        });
      }

      return json({
        recovery_key: plainRecoveryKey,
        referral_code: own_referral_code,
        session: sessionData.session,
        snapchat_name: snapchatName,
      });
    }

    if (action === "login") {
      if (!password) return json({ error: "Enter your password." }, 400);

      const { data: account, error: accountErr } = await admin
        .from("store_accounts")
        .select("id")
        .eq("snapchat_name", snapchatName)
        .maybeSingle();

      if (accountErr) return json({ error: accountErr.message }, 500);
      if (!account) {
        return json({ error: "No account found for that Snapchat name." }, 404);
      }

      const { data, error } = await anon.auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        return json({ error: "Wrong Snapchat name or password." }, 401);
      }

      return json({ session: data.session, snapchat_name: snapchatName });
    }

    if (action === "reset") {
      if (!recoveryKey) return json({ error: "Enter your recovery key." }, 400);
      if (newPassword.length < 6) {
        return json({ error: "New password must be at least 6 characters." }, 400);
      }

      const { data: account, error: accountErr } = await admin
        .from("store_accounts")
        .select("id, recovery_key_hash")
        .eq("snapchat_name", snapchatName)
        .maybeSingle();

      if (accountErr) return json({ error: accountErr.message }, 500);
      if (!account) {
        return json({ error: "No account found for that Snapchat name." }, 404);
      }

      const providedHash = await sha256Hex(normalizeRecoveryKey(recoveryKey));
      if (providedHash !== account.recovery_key_hash) {
        return json({ error: "Invalid recovery key." }, 401);
      }

      const { error: updateErr } = await admin.auth.admin.updateUserById(account.id, {
        password: newPassword,
      });
      if (updateErr) return json({ error: updateErr.message }, 500);

      const { data, error } = await anon.auth.signInWithPassword({
        email,
        password: newPassword,
      });

      if (error || !data.session) {
        return json({ ok: true, session: null, message: "Password updated. Please log in." });
      }

      return json({ ok: true, session: data.session, snapchat_name: snapchatName });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error.";
    return json({ error: message }, 500);
  }
});
