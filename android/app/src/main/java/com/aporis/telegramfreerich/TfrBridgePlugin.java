package com.aporis.telegramfreerich;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebResourceResponse;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

import org.json.JSONArray;
import org.json.JSONObject;

import okhttp3.Credentials;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * TfrBridge — the Electron main process, redone natively for Android.
 *
 * The ten IPC channels the renderer knows become ten plugin methods:
 *
 *   tgApi        the Telegram HTTP client — the token is attached HERE, never
 *                in the web layer; JSON for plain bodies, multipart for the
 *                `_files` attachments; system / manual / direct proxy modes
 *   saveSettings / loadSettings — Keystore-encrypted settings (AES-256-GCM,
 *                the key is generated inside AndroidKeyStore and never lands
 *                in a file), the no-token-out contract of loadSettings kept
 *   testConnection / testProxy — the two Settings-panel probes
 *   draftsList / Save / Load / Delete — drafts.json in app-private storage
 *   pickMedia    the Android document picker; picked files are copied into
 *                the app's private cache and returned as absolute paths
 *   windowControl — minimize returns the task to the background, the rest
 *                no-op because the system owns Android's window
 *
 * The method allowlist, the field regexes and the size caps mirror
 * src/main/security/validation.js and net/proxy.js — a request the desktop
 * app refuses is refused here too.
 *
 * The plugin method bodies run on Capacitor's background thread pool; the
 * heavy jobs additionally serialize through one dedicated executor, so a
 * second send can never interleave its chunks into the first one's.
 */
@CapacitorPlugin(name = "TfrBridge")
public class TfrBridgePlugin extends Plugin {

    /* ═════ validation — mirrors security/validation.js ═════ */

    private static final Pattern TOKEN = Pattern.compile("\\d+:[A-Za-z0-9_-]{35,}");
    private static final Pattern CHAT_NUM = Pattern.compile("-?\\d+");
    private static final Pattern CHAT_NAME = Pattern.compile("@\\w{5,}");
    private static final Pattern BIZ_ID = Pattern.compile("[A-Za-z0-9_-]{4,128}");
    private static final Pattern DRAFT_ID = Pattern.compile(
            "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    private static final Pattern ATTACHMENT_NAME = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final Pattern HOST_IPV4 = Pattern.compile("(\\d{1,3})\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}");
    private static final Pattern HOST_IPV6 = Pattern.compile("\\[[0-9a-fA-F:]+\\]");
    private static final Pattern HOST_NAME = Pattern.compile(
            "[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*");

    private static final List<String> ALLOWED_METHODS = Collections.unmodifiableList(Arrays.asList(
            "sendRichMessage", "sendRichMessageDraft", "editMessageText", "sendChecklist", "getMe"));
    private static final List<String> PROXY_MODES = Collections.unmodifiableList(
            Arrays.asList("system", "manual", "direct"));
    private static final List<String> PROXY_SCHEMES = Collections.unmodifiableList(
            Arrays.asList("http", "https", "socks4", "socks5"));

    /** Rich messages cap a document at 50 MB — be no more permissive. */
    private static final long MAX_UPLOAD_BYTES = 50L * 1024 * 1024;
    /** Draft caps, exactly the desktop's. */
    private static final int DRAFT_NAME_CAP = 80;
    private static final int DRAFT_HTML_CAP = 4 * 32768 + 8192;
    /** One drafts file holds at most 100 entries, exactly the desktop's. */
    private static final int DRAFTS_MAX = 100;

    private static final Map<String, String> MEDIA_MIME = new HashMap<String, String>();

    static {
        for (String[] pair : new String[][] {
                {"png", "image/png"}, {"jpg", "image/jpeg"}, {"jpeg", "image/jpeg"},
                {"webp", "image/webp"}, {"gif", "image/gif"}, {"bmp", "image/bmp"},
                {"avif", "image/avif"}, {"mp4", "video/mp4"}, {"webm", "video/webm"},
                {"mov", "video/quicktime"}, {"mkv", "video/x-matroska"},
                {"m4v", "video/x-m4v"}, {"avi", "video/x-msvideo"},
                {"mp3", "audio/mpeg"}, {"ogg", "audio/ogg"}, {"oga", "audio/ogg"},
                {"opus", "audio/opus"}, {"wav", "audio/wav"}, {"m4a", "audio/mp4"},
                {"flac", "audio/flac"}, {"aac", "audio/aac"},
                {"pdf", "application/pdf"}, {"zip", "application/zip"},
        }) {
            MEDIA_MIME.put(pair[0], pair[1]);
        }
    }

    /** Serialized heavy jobs — one send at a time, settings writes included. */
    private final ExecutorService jobs = Executors.newSingleThreadExecutor();

    /* ═════ secure settings — Keystore AES-GCM ═════ */

    private static final String PREFS = "tfr_secure";
    private static final String PREF_BLOB = "settings-blob";
    private static final String KS_ALIAS = "tfr-settings-key";

    /** AES-256-GCM with the key held in AndroidKeyStore; the ciphertext
        (iv || body, base64) lives in one private preferences file. */
    @SuppressWarnings("UnusedReturnValue")
    private synchronized String readBlob() {
        String raw = bridge.getContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREF_BLOB, null);
        if (raw == null) return null;
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            SecretKey key = (SecretKey) ks.getKey(KS_ALIAS, null);
            if (key == null) return null;
            byte[] all = Base64.decode(raw, Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, all, 0, 12));
            return new String(cipher.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
        } catch (Exception e) {
            Log.e("TfrBridge", "settings read failed", e);
            return null;
        }
    }

    private synchronized boolean writeBlob(String json) {
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            SecretKey key = (SecretKey) ks.getKey(KS_ALIAS, null);
            if (key == null) {
                KeyGenerator gen = KeyGenerator.getInstance(
                        KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                gen.init(new KeyGenParameterSpec.Builder(KS_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build());
                key = gen.generateKey();
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            byte[] iv = cipher.getIV();
            byte[] ct = cipher.doFinal(json.getBytes(StandardCharsets.UTF_8));
            byte[] all = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, all, 0, iv.length);
            System.arraycopy(ct, 0, all, iv.length, ct.length);
            bridge.getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(PREF_BLOB, Base64.encodeToString(all, Base64.NO_WRAP))
                    .apply();
            return true;
        } catch (Exception e) {
            Log.e("TfrBridge", "settings write failed", e);
            return false;
        }
    }

    private JSONObject settings() throws Exception {
        String blob = readBlob();
        return blob == null ? new JSONObject() : new JSONObject(blob);
    }

    /* ═════ proxy — mirrors net/proxy.js ═════ */

    private static boolean validProxyHost(String host) {
        if (host == null) return false;
        String v = host.trim();
        if (v.isEmpty() || v.length() > 255) return false;
        if (v.length() != v.replaceFirst("[\\s/\\\\@?#]", "").length()) return false;
        if (HOST_IPV4.matcher(v).matches()) {
            for (String part : v.split("\\.")) {
                if (Integer.parseInt(part) > 255) return false;
            }
            return true;
        }
        return HOST_IPV6.matcher(v).matches() || HOST_NAME.matcher(v).matches();
    }

    private static boolean validProxyPort(int port) {
        return port >= 1 && port <= 65535;
    }

    /** The full stored proxy, password included — server-side only. */
    private static final class StoredProxy {
        final String mode;
        final String scheme;
        final String host;
        final int port;
        final String username;
        final String password;

        StoredProxy(String mode, String scheme, String host, int port,
                    String username, String password) {
            this.mode = mode;
            this.scheme = scheme;
            this.host = host;
            this.port = port;
            this.username = username;
            this.password = password;
        }

        boolean manualValid() {
            return PROXY_SCHEMES.contains(scheme) && validProxyHost(host) && validProxyPort(port);
        }
    }

    /** Bad values fall back to the v2rayN defaults instead of throwing —
        a corrupted store can never stop the app from starting. */
    private static StoredProxy normalizeProxy(JSONObject raw) {
        String mode = raw.optString("mode", "system");
        if (!PROXY_MODES.contains(mode)) mode = "system";
        String scheme = raw.optString("scheme", "socks5");
        if (!PROXY_SCHEMES.contains(scheme)) scheme = "socks5";
        String host = raw.optString("host", "127.0.0.1");
        if (!validProxyHost(host)) host = "127.0.0.1";
        int port = raw.optInt("port", 10808);
        if (!validProxyPort(port)) port = 10808;
        String username = raw.opt("username") instanceof String ? raw.optString("username") : "";
        String password = raw.opt("password") instanceof String ? raw.optString("password") : "";
        return new StoredProxy(mode, scheme, host, port, username, password);
    }

    /** The view the renderer gets — hasPassword, never the secret. */
    private static JSONObject publicProxy(StoredProxy p) throws Exception {
        JSONObject out = new JSONObject();
        out.put("mode", p.mode);
        out.put("scheme", p.scheme);
        out.put("host", p.host);
        out.put("port", p.port);
        out.put("username", p.username);
        out.put("hasPassword", !p.password.isEmpty());
        return out;
    }

    private static String describeProxy(StoredProxy p) {
        if ("direct".equals(p.mode)) return "direct";
        if ("manual".equals(p.mode)) return "MANUAL " + p.scheme + "://" + p.host + ":" + p.port;
        return "SYSTEM (the OS proxy decides)";
    }

    /* ═════ HTTP — the Telegram client ═════ */

    private OkHttpClient client(StoredProxy proxy) {
        OkHttpClient.Builder b = new OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS);
        if ("direct".equals(proxy.mode)) {
            b.proxy(Proxy.NO_PROXY);
        } else if ("manual".equals(proxy.mode)) {
            Proxy.Type type = proxy.scheme.startsWith("socks") ? Proxy.Type.SOCKS : Proxy.Type.HTTP;
            b.proxy(new Proxy(type, new InetSocketAddress(proxy.host, proxy.port)));
            // HTTP CONNECT auth rides Proxy-Authorization; SOCKS user/pass is
            // not surfaced by OkHttp — the common local tunnels (v2rayN) run
            // without auth, so this covers the HTTP case only.
            if (!proxy.scheme.startsWith("socks") && !proxy.username.isEmpty()) {
                final String user = proxy.username;
                final String pass = proxy.password;
                b.proxyAuthenticator((route, response) -> {
                    if (response.request().header("Proxy-Authorization") != null) {
                        return null; // credentials already sent and refused
                    }
                    return response.request().newBuilder()
                            .header("Proxy-Authorization", Credentials.basic(user, pass))
                            .build();
                });
            }
        }
        // "system" sets no proxy — OkHttp then follows whatever the OS or a
        // VPN's TUN resolves, which is what system mode means here.
        return b.build();
    }

    /** One Telegram call. Attachments post as multipart, bodies as JSON —
        the exact form the desktop's net/request.js assembles by hand. */
    private JSONObject tgCall(String url, JSONObject payload,
                              List<File> files, List<String> fieldNames) throws Exception {
        StoredProxy proxy = normalizeProxy(storedProxyJson());
        Request.Builder rb = new Request.Builder().url(url);
        if (payload != null || (files != null && !files.isEmpty())) {
            RequestBody body;
            if (files != null && !files.isEmpty()) {
                MultipartBody.Builder mb = new MultipartBody.Builder().setType(MultipartBody.FORM);
                if (payload != null) {
                    for (Iterator<String> it = payload.keys(); it.hasNext(); ) {
                        String name = it.next();
                        Object value = payload.get(name);
                        // Bot API field rules: strings as-is, everything else
                        // JSON-serialized — the desktop's encodeMultipart.
                        mb.addFormDataPart(name, value instanceof String
                                ? (String) value : String.valueOf(value));
                    }
                }
                for (int i = 0; i < files.size(); i++) {
                    File file = files.get(i);
                    mb.addFormDataPart(fieldNames.get(i), file.getName(),
                            RequestBody.create(file, MediaType.parse("application/octet-stream")));
                }
                body = mb.build();
            } else {
                body = RequestBody.create(payload.toString(),
                        MediaType.parse("application/json; charset=utf-8"));
            }
            rb.post(body);
        } else {
            rb.get();
        }

        try (Response response = client(proxy).newCall(rb.build()).execute()) {
            String bodyText = response.body() != null ? response.body().string() : "";
            try {
                return new JSONObject(bodyText);
            } catch (Exception parse) {
                throw new Exception("Invalid JSON response (HTTP " + response.code() + ")");
            }
        }
    }

    private JSONObject storedProxyJson() {
        try {
            JSONObject proxy = settings().optJSONObject("proxy");
            return proxy != null ? proxy : new JSONObject();
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    /* ═════ plugin methods ═════ */

    @PluginMethod
    public void tgApi(final PluginCall call) {
        final String method = call.getString("method");
        final com.getcapacitor.JSObject rawBody = call.getObject("body");
        String token;
        try {
            token = settings().optString("token", "");
        } catch (Exception e) {
            token = "";
        }
        final String fToken = token;
        if (fToken.isEmpty()) {
            call.resolve(error("Bot token not configured"));
            return;
        }
        if (method == null || !ALLOWED_METHODS.contains(method)) {
            call.resolve(error("Invalid API method"));
            return;
        }
        if (rawBody == null) {
            call.resolve(error("Invalid request body"));
            return;
        }
        jobs.execute(() -> {
            List<File> files = new ArrayList<>();
            List<String> fieldNames = new ArrayList<>();
            JSONObject payload = new JSONObject();
            try {
                // Local media rides as `_files` beside the field it belongs
                // to; entries the desktop would refuse are dropped so a
                // tampered body can never point a read outside the app.
                JSONArray list = rawBody.optJSONArray("_files");
                if (list != null) {
                    for (int i = 0; i < list.length(); i++) {
                        JSONObject entry = list.optJSONObject(i);
                        if (entry == null) continue;
                        String name = entry.optString("name", "");
                        String path = entry.optString("path", "");
                        if (!ATTACHMENT_NAME.matcher(name).matches() || !confinementOk(path)) {
                            continue;
                        }
                        File file = new File(path);
                        if (file.isFile() && file.length() > 0 && file.length() <= MAX_UPLOAD_BYTES) {
                            files.add(file);
                            fieldNames.add(name);
                        }
                    }
                }
                for (Iterator<String> it = rawBody.keys(); it.hasNext(); ) {
                    String name = it.next();
                    if ("_files".equals(name)) continue;
                    payload.put(name, rawBody.get(name));
                }

                String url = "https://api.telegram.org/bot" + fToken + "/" + method;
                call.resolve(toJSObject(tgCall(url, payload, files, fieldNames)));
            } catch (Exception e) {
                call.resolve(error(e.getMessage() != null ? e.getMessage() : "Network error"));
            }
        });
    }

    /** Paths the app's own picker wrote — cacheDir/tfr and filesDir/tfr.
        The interception layer is stricter than the desktop's absolute-path
        rule, because here decoded URLs can also name arbitrary app files. */
    private boolean confinementOk(String path) {
        if (path.isEmpty() || path.length() > 1024
                || !path.startsWith("/") || path.contains("..")) {
            return false;
        }
        try {
            String canonical = new File(path).getCanonicalPath();
            Context ctx = bridge.getContext();
            for (File base : new File[] {
                    new File(ctx.getCacheDir(), "tfr"),
                    new File(ctx.getFilesDir(), "tfr"),
            }) {
                String parent = base.getCanonicalPath() + File.separator;
                if (canonical.startsWith(parent)) return true;
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    private static com.getcapacitor.JSObject error(String description) {
        com.getcapacitor.JSObject out = new com.getcapacitor.JSObject();
        try {
            out.put("ok", false);
            out.put("description", description);
        } catch (Exception ignored) {
            // put on a fresh JSObject with fixed strings cannot fail
        }
        return out;
    }

    /** Bridge a raw org.json tree into the JSObject Capacitor carries — one
        level of copying, nested objects ride as their raw self (JSObject
        extends org.json.JSONObject, so the serializer handles them). */
    private static com.getcapacitor.JSObject toJSObject(JSONObject source) {
        com.getcapacitor.JSObject out = new com.getcapacitor.JSObject();
        try {
            if (source.has("ok") && !source.optBoolean("ok")) {
                out.put("ok", false);
                if (source.has("description")) {
                    out.put("description", source.get("description"));
                }
                return out;
            }
            for (Iterator<String> it = source.keys(); it.hasNext(); ) {
                String key = it.next();
                out.put(key, source.get(key));
            }
        } catch (Exception e) {
            return error("Invalid response build");
        }
        return out;
    }

    @PluginMethod
    public void saveSettings(final PluginCall call) {
        jobs.execute(() -> {
            try {
                JSONObject stored = settings();
                String token = call.getString("token");
                if (token != null) {
                    if (!token.isEmpty() && !TOKEN.matcher(token).matches()) {
                        call.resolve(error("Invalid bot token format"));
                        return;
                    }
                    stored.put("token", token);
                }
                String chatId = call.getString("chatId");
                if (chatId != null) {
                    if (!chatId.isEmpty()
                            && !CHAT_NUM.matcher(chatId).matches()
                            && !CHAT_NAME.matcher(chatId).matches()) {
                        call.resolve(error("Invalid chat ID format"));
                        return;
                    }
                    stored.put("chatId", chatId);
                }
                String lang = call.getString("lang");
                if (lang != null) {
                    if (!("en".equals(lang) || "fa".equals(lang))) {
                        call.resolve(error("Invalid language"));
                        return;
                    }
                    stored.put("lang", lang);
                }
                String bizId = call.getString("businessConnectionId");
                if (bizId != null) {
                    String id = bizId.trim();
                    if (!id.isEmpty() && !BIZ_ID.matcher(id).matches()) {
                        call.resolve(error("Invalid business connection ID"));
                        return;
                    }
                    stored.put("businessConnectionId", id);
                }
                com.getcapacitor.JSObject proxyIn = call.getObject("proxy");
                if (proxyIn != null) {
                    JSONObject raw = new JSONObject(proxyIn.toString());
                    // An omitted password means "keep the stored one".
                    if (!(raw.opt("password") instanceof String)) {
                        raw.put("password", normalizeProxy(storedProxyJson()).password);
                    }
                    StoredProxy candidate = normalizeProxy(raw);
                    if ("manual".equals(candidate.mode) && !candidate.manualValid()) {
                        call.resolve(error("Invalid proxy configuration"));
                        return;
                    }
                    JSONObject proxyOut = new JSONObject();
                    proxyOut.put("mode", candidate.mode);
                    proxyOut.put("scheme", candidate.scheme);
                    proxyOut.put("host", candidate.host);
                    proxyOut.put("port", candidate.port);
                    proxyOut.put("username", candidate.username);
                    proxyOut.put("password", candidate.password);
                    stored.put("proxy", proxyOut);
                }

                if (!writeBlob(stored.toString())) {
                    call.resolve(error("Failed to encrypt/save settings"));
                    return;
                }
                com.getcapacitor.JSObject out = new com.getcapacitor.JSObject();
                out.put("ok", true);
                out.put("proxy", publicProxy(normalizeProxy(storedProxyJson())));
                call.resolve(out);
            } catch (Exception e) {
                call.resolve(error("Failed to save settings"));
            }
        });
    }

    @PluginMethod
    public void loadSettings(final PluginCall call) {
        jobs.execute(() -> {
            com.getcapacitor.JSObject out = new com.getcapacitor.JSObject();
            try {
                JSONObject stored = settings();
                out.put("tokenSet", !stored.optString("token", "").isEmpty());
                out.put("chatId", stored.optString("chatId", ""));
                out.put("lang", stored.optString("lang", "en"));
                out.put("businessConnectionId", stored.optString("businessConnectionId", ""));
                out.put("proxy", publicProxy(normalizeProxy(storedProxyJson())));
            } catch (Exception e) {
                try {
                    out.put("tokenSet", false);
                    out.put("chatId", "");
                    out.put("lang", "en");
                    out.put("businessConnectionId", "");
                    out.put("proxy", publicProxy(normalizeProxy(new JSONObject())));
                } catch (Exception ignored) {
                    // defaults cannot fail to serialize
                }
            }
            call.resolve(out);
        });
    }

    @PluginMethod
    public void testConnection(final PluginCall call) {
        String token;
        try {
            token = settings().optString("token", "");
        } catch (Exception e) {
            token = "";
        }
        final String fToken = token;
        if (fToken.isEmpty()) {
            call.resolve(error("Bot token not configured"));
            return;
        }
        jobs.execute(() -> {
            try {
                call.resolve(toJSObject(
                        tgCall("https://api.telegram.org/bot" + fToken + "/getMe", null, null, null)));
            } catch (Exception e) {
                call.resolve(error(e.getMessage() != null ? e.getMessage() : "Network error"));
            }
        });
    }

    @PluginMethod
    public void testProxy(final PluginCall call) {
        jobs.execute(() -> {
            StoredProxy proxy = normalizeProxy(storedProxyJson());
            try {
                // Even a 401 body means the tunnel works — the desktop's rule.
                tgCall("https://api.telegram.org/bot0:invalid/getMe", null, null, null);
                com.getcapacitor.JSObject out = new com.getcapacitor.JSObject();
                out.put("ok", true);
                out.put("reachable", true);
                out.put("resolved", describeProxy(proxy));
                out.put("mode", proxy.mode);
                call.resolve(out);
            } catch (Exception e) {
                com.getcapacitor.JSObject out = new com.getcapacitor.JSObject();
                try {
                    out.put("ok", false);
                    out.put("reachable", false);
                    out.put("resolved", describeProxy(proxy));
                    out.put("mode", proxy.mode);
                    out.put("description", e.getMessage() != null ? e.getMessage() : "Network error");
                } catch (Exception ignored) {
                    // fixed strings cannot fail
                }
                call.resolve(out);
            }
        });
    }

    /* ═════ drafts — drafts.json in app-private storage ═════ */

    private File draftsFile() {
        return new File(bridge.getContext().getFilesDir(), "drafts.json");
    }

    private JSONArray loadDrafts() {
        try (InputStream in = new FileInputStream(draftsFile())) {
            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = in.read(chunk)) > 0) buffer.write(chunk, 0, read);
            return new JSONArray(new String(buffer.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private boolean writeDrafts(JSONArray list) {
        try (OutputStream out = new FileOutputStream(draftsFile())) {
            out.write(list.toString(2).getBytes(StandardCharsets.UTF_8));
            return true;
        } catch (Exception e) {
            Log.e("TfrBridge", "drafts write failed", e);
            return false;
        }
    }

    /** The list sent back to the renderer — never the body itself, the
        desktop's draftSummary contract. */
    private static com.getcapacitor.JSObject draftsOut(JSONArray drafts) {
        com.getcapacitor.JSObject out = new com.getcapacitor.JSObject();
        try {
            com.getcapacitor.JSArray list = new com.getcapacitor.JSArray();
            for (int i = 0; i < drafts.length(); i++) {
                JSONObject draft = drafts.getJSONObject(i);
                com.getcapacitor.JSObject summary = new com.getcapacitor.JSObject();
                summary.put("id", draft.optString("id"));
                summary.put("name", draft.optString("name"));
                summary.put("savedAt", draft.optLong("savedAt"));
                summary.put("isRtl", draft.optBoolean("isRtl"));
                list.put(summary);
            }
            out.put("ok", true);
            out.put("drafts", list);
        } catch (Exception e) {
            out.put("ok", false);
            try {
                out.put("description", "Draft read failed");
            } catch (Exception ignored) {
                // fixed string
            }
        }
        return out;
    }

    @PluginMethod
    public void draftsList(PluginCall call) {
        call.resolve(draftsOut(loadDrafts()));
    }

    @PluginMethod
    public void draftsSave(final PluginCall call) {
        String name = call.getString("name");
        String html = call.getString("html");
        boolean isRtl = Boolean.TRUE.equals(call.getBoolean("isRtl"));
        if (name == null || name.trim().isEmpty() || name.trim().length() > DRAFT_NAME_CAP) {
            call.resolve(error("Invalid draft name"));
            return;
        }
        if (html == null || html.trim().isEmpty() || html.length() > DRAFT_HTML_CAP) {
            call.resolve(error("Nothing to save in this draft"));
            return;
        }
        jobs.execute(() -> {
            try {
                JSONArray drafts = loadDrafts();
                JSONObject draft = new JSONObject();
                draft.put("id", UUID.randomUUID().toString());
                draft.put("name", name.trim());
                draft.put("html", html);
                draft.put("isRtl", isRtl);
                draft.put("savedAt", System.currentTimeMillis());
                JSONArray all = new JSONArray();
                all.put(draft);
                for (int i = 0; i < drafts.length() && all.length() < DRAFTS_MAX; i++) {
                    all.put(drafts.get(i));
                }
                if (!writeDrafts(all)) {
                    call.resolve(error("Failed to save draft"));
                    return;
                }
                call.resolve(draftsOut(all));
            } catch (Exception e) {
                call.resolve(error("Failed to save draft"));
            }
        });
    }

    @PluginMethod
    public void draftsLoad(final PluginCall call) {
        String id = call.getString("id");
        if (id == null || !DRAFT_ID.matcher(id).matches()) {
            call.resolve(error("Invalid draft ID"));
            return;
        }
        jobs.execute(() -> {
            JSONArray drafts = loadDrafts();
            try {
                for (int i = 0; i < drafts.length(); i++) {
                    JSONObject draft = drafts.getJSONObject(i);
                    if (id.equals(draft.optString("id"))) {
                        com.getcapacitor.JSObject out = new com.getcapacitor.JSObject();
                        out.put("ok", true);
                        out.put("draft", draft);
                        call.resolve(out);
                        return;
                    }
                }
                call.resolve(error("Draft not found"));
            } catch (Exception e) {
                call.resolve(error("Draft read failed"));
            }
        });
    }

    @PluginMethod
    public void draftsDelete(final PluginCall call) {
        String id = call.getString("id");
        if (id == null || !DRAFT_ID.matcher(id).matches()) {
            call.resolve(error("Invalid draft ID"));
            return;
        }
        jobs.execute(() -> {
            JSONArray drafts = loadDrafts();
            JSONArray remaining = new JSONArray();
            try {
                for (int i = 0; i < drafts.length(); i++) {
                    if (!id.equals(drafts.getJSONObject(i).optString("id"))) {
                        remaining.put(drafts.get(i));
                    }
                }
                if (!writeDrafts(remaining)) {
                    call.resolve(error("Failed to save draft file"));
                    return;
                }
                call.resolve(draftsOut(remaining));
            } catch (Exception e) {
                call.resolve(error("Draft read failed"));
            }
        });
    }

    /* ═════ the picker ═════ */

    @PluginMethod
    public void pickMedia(PluginCall call) {
        String kind = call.getString("kind", "media");
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        if ("audio".equals(kind)) {
            intent.setType("audio/*");
        } else if ("media".equals(kind)) {
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
        } else {
            intent.setType("*/*");
        }
        startActivityForResult(call, intent, "onMediaPicked");
    }

    @SuppressLint("Range")
    @ActivityCallback
    private void onMediaPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null) {
            call.resolve(error("Dialog failed"));
            return;
        }
        Intent data = result.getData();
        if (result.getResultCode() != android.app.Activity.RESULT_OK || data == null) {
            com.getcapacitor.JSObject out = new com.getcapacitor.JSObject();
            try {
                out.put("ok", true);
                out.put("files", new com.getcapacitor.JSArray());
            } catch (Exception ignored) {
                // fresh objects, fixed values
            }
            call.resolve(out);
            return;
        }
        jobs.execute(() -> {
            Context ctx = bridge.getContext();
            File dir = new File(ctx.getCacheDir(), "tfr");
            if (!dir.exists()) dir.mkdirs();
            List<String> paths = new ArrayList<>();
            int offered = 0;
            // Multiple picks ride the clip data; a single one sits in getData().
            List<Uri> uris = new ArrayList<>();
            if (data.getData() != null) {
                offered++;
                uris.add(data.getData());
            }
            if (data.getClipData() != null) {
                android.content.ClipData clip = data.getClipData();
                for (int i = 0; i < clip.getItemCount(); i++) {
                    Uri uri = clip.getItemAt(i).getUri();
                    if (uri != null) {
                        offered++;
                        uris.add(uri);
                    }
                }
            }
            for (Uri uri : uris) {
                try {
                    String displayName = "file";
                    try (Cursor cursor = ctx.getContentResolver().query(
                            uri, null, null, null, null)) {
                        if (cursor != null && cursor.moveToFirst()) {
                            int col = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                            if (col >= 0 && cursor.getString(col) != null) {
                                displayName = cursor.getString(col);
                            }
                        }
                    }
                    // Keep the bare name — no separators, no traversal.
                    displayName = displayName.replace('\\', '_').replace('/', '_')
                            .replace("..", "_").trim();
                    if (displayName.isEmpty()) displayName = "file";
                    File target = new File(dir, System.currentTimeMillis() + "-" + displayName);
                    long size = 0;
                    boolean tooLarge = false;
                    try (InputStream in = ctx.getContentResolver().openInputStream(uri);
                         OutputStream out = new FileOutputStream(target)) {
                        byte[] chunk = new byte[65536];
                        int read;
                        while ((read = in.read(chunk)) > 0) {
                            size += read;
                            if (size > MAX_UPLOAD_BYTES) {
                                tooLarge = true;
                                break;
                            }
                            out.write(chunk, 0, read);
                        }
                    }
                    if (tooLarge) {
                        target.delete();
                        continue;
                    }
                    if (size > 0) paths.add(target.getAbsolutePath());
                } catch (Exception e) {
                    // unreadable — dropped, like a dialog cancel
                }
            }
            if (offered > 0 && paths.isEmpty()) {
                call.resolve(error("No file could be added (missing or too large)"));
                return;
            }
            com.getcapacitor.JSObject out = new com.getcapacitor.JSObject();
            try {
                out.put("ok", true);
                com.getcapacitor.JSArray arr = new com.getcapacitor.JSArray();
                for (String path : paths) arr.put(path);
                out.put("files", arr);
            } catch (Exception ignored) {
                // fresh objects, plain strings
            }
            call.resolve(out);
        });
    }

    /* ═════ window controls ═════ */

    @PluginMethod
    public void windowControl(PluginCall call) {
        String action = call.getString("action");
        com.getcapacitor.JSObject out = new com.getcapacitor.JSObject();
        try {
            // Nothing to minimize into — Android has no user-resizable frame;
            // "minimize" returns the task so the app goes to the background.
            if ("minimize".equals(action)) {
                if (bridge.getActivity() != null) bridge.getActivity().moveTaskToBack(true);
                out.put("value", true);
            } else {
                // close / toggle-maximize / is-maximized: the system owns it.
                out.put("value", false);
            }
        } catch (Exception ignored) {
            // fixed strings
        }
        call.resolve(out);
    }

    /* ═════ tfrfile:// — the local media scheme ═════ */

    /** Serve one `tfrfile://media/<encoded abs path>` request. Only files the
        app itself copied into its private media folders ever answer — the
        interception layer is stricter than the desktop's absolute-path rule,
        because the decode step here is what a tampered document would push
        against. Returns null to let the WebView handle everything else. */
    public static WebResourceResponse serveMedia(Context ctx, String url) {
        if (ctx == null || url == null || !url.startsWith("tfrfile://media/")) return null;
        try {
            String path = java.net.URLDecoder.decode(
                    url.substring("tfrfile://media/".length()), "UTF-8");
            int cut = path.indexOf('?');
            if (cut >= 0) path = path.substring(0, cut);
            if (path.length() > 1024 || path.contains("..")) return null;
            File file = new File(path);
            String canonical = file.getCanonicalPath();
            File cache = new File(ctx.getCacheDir(), "tfr").getCanonicalFile();
            File files = new File(ctx.getFilesDir(), "tfr").getCanonicalFile();
            if (!canonical.startsWith(cache.getPath() + File.separator)
                    && !canonical.startsWith(files.getPath() + File.separator)) {
                return null;
            }
            if (!file.isFile()) return null;
            String ext = "";
            int dot = canonical.lastIndexOf('.');
            if (dot >= 0) ext = canonical.substring(dot + 1).toLowerCase(Locale.ROOT);
            String mime = MEDIA_MIME.containsKey(ext)
                    ? MEDIA_MIME.get(ext) : "application/octet-stream";
            return new WebResourceResponse(mime, null, new FileInputStream(file));
        } catch (Exception e) {
            return null;
        }
    }
}
