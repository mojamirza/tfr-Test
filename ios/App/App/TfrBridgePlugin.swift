//
//  TfrBridgePlugin.swift
//  App
//
//  TfrBridge — the Electron main process, redone natively for iOS/iPadOS.
//
//  The thirteen IPC channels the renderer knows become eleven plugin methods
//  (the four draft channels plus tgApi/settings/probes/picker/windowControl):
//
//    tgApi          the Telegram HTTP client — the token is attached HERE,
//                   never in the web layer; JSON for plain bodies, hand-built
//                   multipart for `_files` attachments; system / manual /
//                   direct proxy modes via the URLSession proxy dictionary
//    saveSettings / loadSettings — AES-256-GCM encrypted settings (CryptoKit),
//                   the key lives in the Keychain and never lands in a file
//    testConnection / testProxy — the two Settings-panel probes
//    draftsList / Save / Load / Delete — drafts.json in app-private storage
//    pickMedia      the system document picker; picked files are copied into
//                   the app's Documents/tfr folder and returned as absolute
//                   paths
//    windowControl  no-ops — iOS owns the window life cycle
//
//  The method allowlist, the field regexes and the size caps mirror
//  src/main/security/validation.js and net/proxy.js exactly — a request the
//  desktop app refuses is refused here too, and the multipart/error-hint
//  contracts follow src/main/net/request.js.
//
//  The `tfrfile://` media scheme is served by TfrMediaSchemeHandler
//  (bottom of this file), registered on the web view configuration in
//  MainViewController.swift.
//

import Capacitor
import CryptoKit
import Foundation
import UniformTypeIdentifiers
import WebKit

@objc(TfrBridgePlugin)
public class TfrBridgePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {

    // MARK: - CAPBridgedPlugin registration

    public let identifier = "TfrBridgePlugin"
    public let jsName = "TfrBridge"

    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "tgApi", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "testConnection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "testProxy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "draftsList", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "draftsSave", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "draftsLoad", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "draftsDelete", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickMedia", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "windowControl", returnType: CAPPluginReturnPromise),
    ]

    // MARK: - Validation — mirrors security/validation.js

    private static let tokenPattern = "^[0-9]+:[A-Za-z0-9_-]{35,}$"
    private static let chatNumPattern = "^-?[0-9]+$"
    private static let chatNamePattern = "^@\\w{5,}$"
    private static let bizIdPattern = "^[A-Za-z0-9_-]{4,128}$"
    private static let draftIdPattern =
        "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    private static let attachmentNamePattern = "^[A-Za-z0-9_-]{1,64}$"
    private static let hostIPv4Pattern = "^([0-9]{1,3})(\\.[0-9]{1,3}){3}$"
    private static let hostIPv6Pattern = "^\\[[0-9a-fA-F:]+\\]$"
    private static let hostNamePattern =
        "^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)(\\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$"
    private static let forbiddenHostChars = CharacterSet(
        charactersIn: " /\\@?#")

    private static let allowedMethods: Set<String> = [
        "sendRichMessage", "sendRichMessageDraft", "editMessageText", "sendChecklist", "getMe",
    ]
    private static let proxyModes: Set<String> = ["system", "manual", "direct"]
    private static let proxySchemes: Set<String> = ["http", "https", "socks4", "socks5"]

    /// Rich messages cap a document at 50 MB — be no more permissive.
    private static let maxUploadBytes: Int64 = 50 * 1024 * 1024
    /// The desktop's response cap (net/request.js).
    private static let maxResponseBytes = 1_048_576
    /// Draft caps, exactly the desktop's.
    private static let draftNameCap = 80
    private static let draftHtmlCap = 4 * 32768 + 8192
    /// One drafts file holds at most 100 entries.
    private static let draftsMax = 100

    /// MIME map shared with TfrMediaSchemeHandler (both read it through this
    /// static constant).
    static let mediaMime: [String: String] = [
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "webp": "image/webp", "gif": "image/gif", "bmp": "image/bmp",
        "avif": "image/avif", "mp4": "video/mp4", "webm": "video/webm",
        "mov": "video/quicktime", "mkv": "video/x-matroska", "m4v": "video/x-m4v",
        "avi": "video/x-msvideo", "mp3": "audio/mpeg", "ogg": "audio/ogg",
        "oga": "audio/ogg", "opus": "audio/opus", "wav": "audio/wav",
        "m4a": "audio/mp4", "flac": "audio/flac", "aac": "audio/aac",
        "pdf": "application/pdf", "zip": "application/zip",
    ]

    /// Serialized heavy jobs — one send at a time, settings writes included.
    private let jobs = DispatchQueue(label: "com.aporis.telegramfreerich.tfrbridge")

    // MARK: - Full-match regex helper (the Java side used Pattern.matches)

    private func fullMatch(_ value: String?, _ pattern: String) -> Bool {
        guard let value = value, !value.isEmpty else { return false }
        guard let range = value.range(of: pattern, options: .regularExpression) else {
            return false
        }
        return range.lowerBound == value.startIndex && range.upperBound == value.endIndex
    }

    // MARK: - Secure settings — Keychain key + AES-256-GCM blob

    private static let defaultsSuite = "tfr_secure"
    private static let defaultsBlobKey = "settings-blob"
    private static let keychainService = "com.aporis.telegramfreerich.tfrbridge"
    private static let keychainAccount = "tfr-settings-key"

    /// The encryption key. AES-256 key generated on first use, stored in the
    /// Keychain (class generic password) — the settings file itself is a
    /// base64(iv+body) blob in the app's private defaults, mirroring the
    /// Android Keystore design.
    private func loadKey() -> SymmetricKey? {
        let search: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
            kSecReturnData as String: true,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(search as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data {
            return SymmetricKey(data: data)
        }
        if status == errSecItemNotFound {
            let key = SymmetricKey(size: .bits256)
            let keyData = key.withUnsafeBytes { Data($0) }
            let add: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: Self.keychainService,
                kSecAttrAccount as String: Self.keychainAccount,
                kSecValueData as String: keyData,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            ]
            let addStatus = SecItemAdd(add as CFDictionary, nil)
            if addStatus == errSecSuccess {
                return key
            }
        }
        return nil
    }

    private func readBlob() -> String? {
        guard let raw = UserDefaults.standard
            .string(forKey: Self.defaultsBlobKey) else { return nil }
        guard let key = loadKey(), let combined = Data(base64Encoded: raw) else { return nil }
        do {
            let sealed = try AES.GCM.SealedBox(combined: combined)
            let plain = try AES.GCM.open(sealed, using: key)
            return String(data: plain, encoding: .utf8)
        } catch {
            NSLog("[TfrBridge] settings read failed: \(error)")
            return nil
        }
    }

    private func writeBlob(_ json: String) -> Bool {
        guard let key = loadKey(), let plain = json.data(using: .utf8) else { return false }
        do {
            let sealed = try AES.GCM.seal(plain, using: key)
            guard let combined = sealed.combined else { return false }
            UserDefaults.standard.set(combined.base64EncodedString(),
                                      forKey: Self.defaultsBlobKey)
            return true
        } catch {
            NSLog("[TfrBridge] settings write failed: \(error)")
            return false
        }
    }

    private func settings() throws -> [String: Any] {
        guard let blob = readBlob(), let data = blob.data(using: .utf8),
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return json
    }

    private func writeSettings(_ json: [String: Any]) -> Bool {
        guard JSONSerialization.isValidJSONObject(json),
              let data = try? JSONSerialization.data(withJSONObject: json),
              let text = String(data: data, encoding: .utf8)
        else { return false }
        return writeBlob(text)
    }

    // MARK: - Proxy — mirrors net/proxy.js

    private struct StoredProxy {
        var mode: String
        var scheme: String
        var host: String
        var port: Int
        var username: String
        var password: String
    }

    private static let defaultProxy = StoredProxy(
        mode: "system", scheme: "socks5", host: "127.0.0.1", port: 10808,
        username: "", password: "")

    private func validProxyHost(_ host: String?) -> Bool {
        guard let host = host else { return false }
        let v = host.trimmingCharacters(in: .whitespaces)
        if v.isEmpty || v.count > 255 { return false }
        guard v.rangeOfCharacter(from: Self.forbiddenHostChars) == nil else { return false }
        if fullMatch(v, Self.hostIPv4Pattern) {
            let parts = v.split(separator: ".")
            return parts.count == 4 && parts.allSatisfy { (Int($0) ?? 256) <= 255 }
        }
        return fullMatch(v, Self.hostIPv6Pattern) || fullMatch(v, Self.hostNamePattern)
    }

    private static func validProxyPort(_ port: Int) -> Bool {
        return port >= 1 && port <= 65535
    }

    /// Bad values fall back to the v2rayN defaults instead of throwing — a
    /// corrupted store can never stop the app from starting.
    private func normalizeProxy(_ raw: [String: Any]) -> StoredProxy {
        var mode = raw["mode"] as? String ?? "system"
        if !Self.proxyModes.contains(mode) { mode = "system" }
        var scheme = raw["scheme"] as? String ?? "socks5"
        if !Self.proxySchemes.contains(scheme) { scheme = "socks5" }
        var host = raw["host"] as? String ?? "127.0.0.1"
        if !validProxyHost(host) { host = "127.0.0.1" }
        var port = raw["port"] as? Int ?? 10808
        if !Self.validProxyPort(port) { port = 10808 }
        let username = raw["username"] as? String ?? ""
        let password = raw["password"] as? String ?? ""
        return StoredProxy(mode: mode, scheme: scheme, host: host, port: port,
                           username: username, password: password)
    }

    private func storedProxy() -> StoredProxy {
        let proxy = try? settings()["proxy"] as? [String: Any]
        return normalizeProxy(proxy ?? [:])
    }

    /// The view the renderer gets — `hasPassword`, never the secret.
    private static func publicProxy(_ p: StoredProxy) -> [String: Any] {
        return [
            "mode": p.mode,
            "scheme": p.scheme,
            "host": p.host,
            "port": p.port,
            "username": p.username,
            "hasPassword": !p.password.isEmpty,
        ]
    }

    private static func describeProxy(_ p: StoredProxy) -> String {
        if p.mode == "direct" { return "direct" }
        if p.mode == "manual" { return "MANUAL \(p.scheme)://\(p.host):\(p.port)" }
        return "SYSTEM (the OS proxy decides)"
    }

    // MARK: - HTTP — the Telegram client

    /// The URLSession proxy dictionary. Key names here are the literal string
    /// values CFNetwork uses (kCFNetworkProxies* / kCFProxy* constants).
    private func applyProxy(_ p: StoredProxy, to config: URLSessionConfiguration) {
        switch p.mode {
        case "direct":
            // An empty dictionary makes URLSession ignore the system/VPN proxy.
            config.connectionProxyDictionary = [:]
        case "manual":
            var dict: [String: Any] = [:]
            if p.scheme.hasPrefix("socks") {
                // URLSession's SOCKS support is SOCKS5-shaped; socks4 settings
                // ride the same entries (common local tunnels accept both).
                dict["kCFNetworkProxiesSOCKSEnable"] = NSNumber(value: true)
                dict["kCFNetworkProxiesSOCKSProxy"] = p.host
                dict["kCFNetworkProxiesSOCKSProxyPort"] = NSNumber(value: p.port)
            } else {
                dict["kCFNetworkProxiesHTTPEnable"] = NSNumber(value: true)
                dict["kCFNetworkProxiesHTTPProxy"] = p.host
                dict["kCFNetworkProxiesHTTPPort"] = NSNumber(value: p.port)
                dict["kCFNetworkProxiesHTTPSEnable"] = NSNumber(value: true)
                dict["kCFNetworkProxiesHTTPSProxy"] = p.host
                dict["kCFNetworkProxiesHTTPSPort"] = NSNumber(value: p.port)
                if !p.username.isEmpty {
                    dict["kCFProxyUsernameKey"] = p.username
                    dict["kCFProxyPasswordKey"] = p.password
                }
            }
            config.connectionProxyDictionary = dict
        default:
            // "system" sets nothing — URLSession then follows whatever the OS
            // or a VPN's TUN resolves, which is what system mode means here.
            break
        }
    }

    /// The desktop's evidence-based hint about tunnel trouble (net/request.js
    /// proxyHint), adapted to URLSession's error codes.
    private func proxyHint(_ error: Error, _ proxy: StoredProxy) -> String {
        let message: String
        if let urlError = error as? URLError {
            message = "Network \(urlError.errorCode): \(urlError.localizedDescription)"
        } else {
            message = error.localizedDescription
        }
        let certLike = ["certificate", "SSL", "TLS"]
        if certLike.contains(where: { message.contains($0) }) {
            return "\(message) — the proxy is intercepting TLS; install its certificate or switch proxy"
        }
        let proxyLike = ["proxy", "tunnel", "SOCKS"]
        if proxyLike.contains(where: { message.lowercased().contains($0.lowercased()) }) {
            return "\(message) — check the proxy (\(Self.describeProxy(proxy)))"
        }
        if let urlError = error as? URLError, proxy.mode != "direct" {
            let connectionLike: [URLError.Code] = [
                .cannotConnectToHost, .timedOut, .cannotFindHost,
                .notConnectedToInternet, .networkConnectionLost, .dnsLookupFailed,
            ]
            if connectionLike.contains(urlError.code) {
                return "\(message) — proxy: \(Self.describeProxy(proxy))"
            }
        }
        return message
    }

    private func readToken() -> String {
        let raw: [String: Any] = (try? self.settings()) ?? [:]
        return raw["token"] as? String ?? ""
    }

    private enum TfrError: Error {
        case message(String)
    }

    /// Unwrap the thrown TfrError's payload (enum associated values need
    /// pattern matching — no auto `.message` property).
    private static func describeError(_ error: Error) -> String {
        if let tfr = error as? TfrError, case .message(let m) = tfr {
            return m
        }
        return "Network error"
    }

    /// One Telegram call — multipart for attachments, JSON otherwise, exactly
    /// the form net/request.js assembles by hand. Runs synchronously; all
    /// callers ride the `jobs` queue.
    private func tgCall(url: URL, payload: [String: Any]?,
                        files: [(field: String, url: URL)]) throws -> [String: Any] {
        let proxy = storedProxy()
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 300
        applyProxy(proxy, to: config)
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }

        var request = URLRequest(url: url, timeoutInterval: 30)

        if !files.isEmpty || payload != nil {
            request.httpMethod = "POST"
            if !files.isEmpty {
                let boundary = "----tfr\(UUID().uuidString)"
                var body = Data()
                func field(_ name: String, _ value: String) {
                    let text = "--\(boundary)\r\n"
                        + "Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n"
                        + value + "\r\n"
                    body.append(Data(text.utf8))
                }
                if let payload = payload {
                    for (key, value) in payload {
                        // Bot API rules, same as the desktop: strings as-is,
                        // everything else JSON-serialized.
                        let text: String
                        if let string = value as? String {
                            text = string
                        } else if JSONSerialization.isValidJSONObject([value]),
                                  let encoded = try? JSONSerialization.data(withJSONObject: [value]),
                                  let json = String(data: encoded, encoding: .utf8) {
                            // The value wrapped in an array so the braces survive.
                            text = String(json.dropFirst().dropLast())
                        } else {
                            text = "\(value)"
                        }
                        field(key, text)
                    }
                }
                for (name, fileURL) in files {
                    let filename = fileURL.lastPathComponent.isEmpty
                        ? "file" : fileURL.lastPathComponent
                    let safe = filename.addingPercentEncoding(
                        withAllowedCharacters: .alphanumerics) ?? "file"
                    let header = "--\(boundary)\r\n"
                        + "Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(safe)\"\r\n\r\n"
                    body.append(Data(header.utf8))
                    guard let fileData = try? Data(contentsOf: fileURL, options: .mappedIfSafe) else {
                        throw TfrError.message("Could not read attachment \(filename)")
                    }
                    body.append(fileData)
                    body.append(Data("\r\n".utf8))
                }
                body.append(Data("--\(boundary)--\r\n".utf8))
                request.setValue("multipart/form-data; boundary=\(boundary)",
                                 forHTTPHeaderField: "Content-Type")
                request.httpBody = body
            } else if let payload = payload {
                request.setValue("application/json; charset=utf-8",
                                 forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            }
        }

        let semaphore = DispatchSemaphore(value: 0)
        var result: [String: Any] = [:]
        var failure: Error? = nil
        session.dataTask(with: request) { data, response, error in
            defer { semaphore.signal() }
            if let error = error {
                failure = error
                return
            }
            guard let http = response as? HTTPURLResponse, let data = data else {
                failure = TfrError.message("Invalid JSON response")
                return
            }
            if data.count > Self.maxResponseBytes {
                failure = TfrError.message("Response too large")
                return
            }
            guard let json = try? JSONSerialization.jsonObject(with: data),
                  let object = json as? [String: Any] else {
                failure = TfrError.message(
                    "Invalid JSON response (HTTP \(http.statusCode))")
                return
            }
            result = object
        }.resume()
        if semaphore.wait(timeout: .now() + 300) == .timedOut {
            throw TfrError.message("Request timeout")
        }
        if let failure = failure {
            throw TfrError.message(proxyHint(failure, proxy))
        }
        return result
    }

    // MARK: - App-private media/draft locations

    /// The folder the picker copies into (and the scheme handler serves from).
    private func mediaDirectory() -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("tfr", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    private var draftsURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("drafts.json")
    }

    /// Paths the app's own picker wrote — Documents/tfr and tmp/tfr.
    /// The upload layer is stricter than the desktop's absolute-path rule,
    /// because a tampered body must never point a read outside the app.
    private func documentsCanon() -> String {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("tfr", isDirectory: true)
            .resolvingSymlinksInPath().path
    }

    private func confinementOk(_ path: String) -> Bool {
        if path.isEmpty || path.count > 1024 || path.contains("..") { return false }
        let fileURL = URL(fileURLWithPath: path)
        let canonical = fileURL.resolvingSymlinksInPath().path
        var roots = [documentsCanon()]
        roots.append(
            URL(fileURLWithPath: NSTemporaryDirectory())
                .appendingPathComponent("tfr")
                .resolvingSymlinksInPath().path)
        for root in roots {
            if canonical.hasPrefix(root + "/") { return true }
        }
        return false
    }

    // MARK: - tgApi

    @objc public func tgApi(_ call: CAPPluginCall) {
        let method = call.getString("method") ?? ""
        guard let body = call.getObject("body") else {
            call.resolve(["ok": false, "description": "Invalid request body"])
            return
        }
        let token = readToken()
        guard !token.isEmpty else {
            call.resolve(["ok": false, "description": "Bot token not configured"])
            return
        }
        guard Self.allowedMethods.contains(method) else {
            call.resolve(["ok": false, "description": "Invalid API method"])
            return
        }
        jobs.async { [weak self] in
            guard let self = self else { return }
            do {
                var files: [(field: String, url: URL)] = []
                var payload: [String: Any] = [:]
                // Local media rides as `_files` beside the field it belongs
                // to; entries the desktop would refuse are dropped.
                if let list = body["_files"] as? [[String: Any]] {
                    for entry in list {
                        guard let name = entry["name"] as? String,
                              self.fullMatch(name, Self.attachmentNamePattern),
                              let path = entry["path"] as? String,
                              self.confinementOk(path)
                        else { continue }
                        let url = URL(fileURLWithPath: path)
                        guard let attrs = try? FileManager.default
                            .attributesOfItem(atPath: path),
                              let size = attrs[FileAttributeKey.size] as? Int64,
                              size > 0 && size <= Self.maxUploadBytes
                        else { continue }
                        files.append((field: name, url: url))
                    }
                }
                for (key, value) in body {
                    if key == "_files" { continue }
                    payload[key] = value
                }
                let url = URL(string: "https://api.telegram.org/bot\(token)/\(method)")!
                var out = try self.tgCall(url: url, payload: payload, files: files)
                if out["ok"] == nil {
                    out["ok"] = false
                }
                call.resolve(out)
            } catch {
                call.resolve(["ok": false, "description": Self.describeError(error)])
            }
        }
    }

    // MARK: - saveSettings / loadSettings

    @objc public func saveSettings(_ call: CAPPluginCall) {
        jobs.async { [weak self] in
            guard let self = self else { return }
            var stored: [String: Any]
            do {
                stored = try self.settings()
            } catch {
                call.resolve(["ok": false, "description": "Failed to save settings"])
                return
            }
            if let token = call.getString("token") {
                if !token.isEmpty && !self.fullMatch(token, Self.tokenPattern) {
                    call.resolve(["ok": false, "description": "Invalid bot token format"])
                    return
                }
                stored["token"] = token
            }
            if let chatId = call.getString("chatId") {
                if !chatId.isEmpty
                    && !self.fullMatch(chatId, Self.chatNumPattern)
                    && !self.fullMatch(chatId, Self.chatNamePattern) {
                    call.resolve(["ok": false, "description": "Invalid chat ID format"])
                    return
                }
                stored["chatId"] = chatId
            }
            if let lang = call.getString("lang") {
                if !(lang == "en" || lang == "fa") {
                    call.resolve(["ok": false, "description": "Invalid language"])
                    return
                }
                stored["lang"] = lang
            }
            if let bizId = call.getString("businessConnectionId") {
                let id = bizId.trimmingCharacters(in: .whitespaces)
                if !id.isEmpty && !self.fullMatch(id, Self.bizIdPattern) {
                    call.resolve(["ok": false, "description": "Invalid business connection ID"])
                    return
                }
                stored["businessConnectionId"] = id
            }
            if let proxyIn = call.getObject("proxy") {
                var raw = proxyIn
                // An omitted password means "keep the stored one".
                if raw["password"] == nil {
                    raw["password"] = self.storedProxy().password
                }
                let candidate = self.normalizeProxy(raw)
                if candidate.mode == "manual"
                    && (!Self.proxySchemes.contains(candidate.scheme)
                        || !self.validProxyHost(candidate.host)
                        || !Self.validProxyPort(candidate.port)) {
                    call.resolve(["ok": false, "description": "Invalid proxy configuration"])
                    return
                }
                stored["proxy"] = [
                    "mode": candidate.mode,
                    "scheme": candidate.scheme,
                    "host": candidate.host,
                    "port": candidate.port,
                    "username": candidate.username,
                    "password": candidate.password,
                ]
            }
            if !self.writeSettings(stored) {
                call.resolve(["ok": false, "description": "Failed to encrypt/save settings"])
                return
            }
            call.resolve([
                "ok": true,
                "proxy": Self.publicProxy(self.storedProxy()),
            ])
        }
    }

    @objc public func loadSettings(_ call: CAPPluginCall) {
        jobs.async { [weak self] in
            guard let self = self else { return }
            var stored: [String: Any] = [:]
            do { stored = try self.settings() } catch { stored = [:] }
            let token = stored["token"] as? String ?? ""
            call.resolve([
                "tokenSet": token.isEmpty ? false : true,
                "chatId": stored["chatId"] as? String ?? "",
                "lang": stored["lang"] as? String ?? "en",
                "businessConnectionId": stored["businessConnectionId"] as? String ?? "",
                "proxy": Self.publicProxy(self.storedProxy()),
            ])
        }
    }

    // MARK: - testConnection / testProxy

    @objc public func testConnection(_ call: CAPPluginCall) {
        let token = readToken()
        if token.isEmpty {
            call.resolve(["ok": false, "description": "Bot token not configured"])
            return
        }
        jobs.async { [weak self] in
            guard let self = self else { return }
            do {
                let url = URL(string: "https://api.telegram.org/bot\(token)/getMe")!
                call.resolve(try self.tgCall(url: url, payload: nil, files: []))
            } catch {
                call.resolve(["ok": false, "description": Self.describeError(error)])
            }
        }
    }

    @objc public func testProxy(_ call: CAPPluginCall) {
        jobs.async { [weak self] in
            guard let self = self else { return }
            let proxy = self.storedProxy()
            do {
                // Even a 401 body means the tunnel works — the desktop's rule.
                let url = URL(string: "https://api.telegram.org/bot0:invalid/getMe")!
                _ = try self.tgCall(url: url, payload: nil, files: [])
                call.resolve([
                    "ok": true,
                    "reachable": true,
                    "resolved": Self.describeProxy(proxy),
                    "mode": proxy.mode,
                ])
            } catch {
                let message = Self.describeError(error)
                call.resolve([
                    "ok": false,
                    "reachable": false,
                    "resolved": Self.describeProxy(proxy),
                    "mode": proxy.mode,
                    "description": message,
                ])
            }
        }
    }

    // MARK: - Drafts — drafts.json in app-private storage

    private func loadDrafts() -> [[String: Any]] {
        guard let data = try? Data(contentsOf: draftsURL),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return [] }
        return list
    }

    private func writeDrafts(_ list: [[String: Any]]) -> Bool {
        guard JSONSerialization.isValidJSONObject(list),
              let data = try? JSONSerialization.data(withJSONObject: list,
                                                     options: [.prettyPrinted]),
              (try? data.write(to: draftsURL)) != nil
        else { return false }
        return true
    }

    /// The list sent back to the renderer — never the body itself.
    private static func draftsOut(_ drafts: [[String: Any]]) -> [String: Any] {
        var list: [[String: Any]] = []
        for draft in drafts {
            list.append([
                "id": draft["id"] as? String ?? "",
                "name": draft["name"] as? String ?? "",
                "savedAt": draft["savedAt"] as? Double ?? 0,
                "isRtl": draft["isRtl"] as? Bool ?? false,
            ])
        }
        return ["ok": true, "drafts": list]
    }

    @objc public func draftsList(_ call: CAPPluginCall) {
        call.resolve(Self.draftsOut(loadDrafts()))
    }

    @objc public func draftsSave(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? ""
        let html = call.getString("html") ?? ""
        let isRtl = call.getBool("isRtl") ?? false
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty || trimmed.count > Self.draftNameCap {
            call.resolve(["ok": false, "description": "Invalid draft name"])
            return
        }
        if html.trimmingCharacters(in: .whitespaces).isEmpty
            || html.count > Self.draftHtmlCap {
            call.resolve(["ok": false, "description": "Nothing to save in this draft"])
            return
        }
        jobs.async { [weak self] in
            guard let self = self else { return }
            let draft: [String: Any] = [
                "id": UUID().uuidString.lowercased(),
                "name": trimmed,
                "html": html,
                "isRtl": isRtl,
                "savedAt": Date().timeIntervalSince1970 * 1000.0,
            ]
            var all = [draft]
            for existing in self.loadDrafts() where all.count < Self.draftsMax {
                all.append(existing)
            }
            if !self.writeDrafts(all) {
                call.resolve(["ok": false, "description": "Failed to save draft"])
                return
            }
            call.resolve(Self.draftsOut(all))
        }
    }

    @objc public func draftsLoad(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        if !fullMatch(id, Self.draftIdPattern) {
            call.resolve(["ok": false, "description": "Invalid draft ID"])
            return
        }
        jobs.async { [weak self] in
            guard let self = self else { return }
            for draft in self.loadDrafts() {
                if draft["id"] as? String == id {
                    call.resolve(["ok": true, "draft": draft])
                    return
                }
            }
            call.resolve(["ok": false, "description": "Draft not found"])
        }
    }

    @objc public func draftsDelete(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        if !fullMatch(id, Self.draftIdPattern) {
            call.resolve(["ok": false, "description": "Invalid draft ID"])
            return
        }
        jobs.async { [weak self] in
            guard let self = self else { return }
            var remaining: [[String: Any]] = []
            for draft in self.loadDrafts() {
                if draft["id"] as? String != id {
                    remaining.append(draft)
                }
            }
            if !self.writeDrafts(remaining) {
                call.resolve(["ok": false, "description": "Failed to save draft file"])
                return
            }
            call.resolve(Self.draftsOut(remaining))
        }
    }

    // MARK: - The picker

    private var pendingPick: CAPPluginCall?

    @objc public func pickMedia(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "media"
        var types: [UTType]
        if kind == "audio" {
            types = [.audio]
        } else if kind == "media" {
            types = [.image, .movie]
        } else {
            types = [.item]
        }
        // asCopy: true — the URLs arrive as temporary copies the app can read
        // outright; the plugin moves them into Documents/tfr, so the original
        // files' security scope never has to be renewed.
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
        picker.allowsMultipleSelection = true
        picker.delegate = self
        pendingPick = call
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if let viewController = self.bridge?.viewController {
                viewController.present(picker, animated: true)
            } else {
                self.pendingPick = nil
                call.resolve(["ok": false, "description": "Dialog failed"])
            }
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController,
                               didPickDocumentsAt urls: [URL]) {
        guard let call = pendingPick else { return }
        pendingPick = nil
        jobs.async { [weak self] in
            guard let self = self else { return }
            let dir = self.mediaDirectory()
            var paths: [String] = []
            for source in urls {
                // Keep the bare name — no separators, no traversal.
                var displayName = source.lastPathComponent
                    .replacingOccurrences(of: "\\", with: "_")
                    .replacingOccurrences(of: "/", with: "_")
                    .replacingOccurrences(of: "..", with: "_")
                    .trimmingCharacters(in: .whitespaces)
                if displayName.isEmpty { displayName = "file" }
                let stamp = Int(Date().timeIntervalSince1970 * 1000)
                let target = dir.appendingPathComponent("\(stamp)-\(displayName)")
                do {
                    let data = try Data(contentsOf: source, options: .mappedIfSafe)
                    if Int64(data.count) > Self.maxUploadBytes {
                        continue
                    }
                    try data.write(to: target, options: .atomic)
                    paths.append(target.path)
                } catch {
                    // unreadable — dropped, like a dialog cancel
                }
            }
            if paths.isEmpty {
                call.resolve([
                    "ok": false,
                    "description": "No file could be added (missing or too large)",
                ])
                return
            }
            call.resolve(["ok": true, "files": paths])
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let call = pendingPick else { return }
        pendingPick = nil
        // A cancel, like the desktop.
        call.resolve(["ok": true, "files": []])
    }

    // MARK: - Window controls

    @objc public func windowControl(_ call: CAPPluginCall) {
        let action = call.getString("action") ?? ""
        // iOS owns the window life cycle; "minimize" has no equal here either —
        // the values match the desktop's shape so the renderer stays uniform.
        call.resolve(["value": action == "minimize"])
    }
}

// MARK: - tfrfile:// — the local media scheme

/// Serves one `tfrfile://media/<encoded absolute path>` request to the web
/// view. Only files the app itself copied into its private media folder ever
/// answer — the interception layer is stricter than the desktop's
/// absolute-path rule, because the decode step is what a tampered document
/// would push against.
class TfrMediaSchemeHandler: NSObject, WKURLSchemeHandler {

    /// True once the task was stopped — no callback may arrive after stop.
    private final class TaskBox {
        let lock = NSLock()
        var cancelled = false
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let raw = urlSchemeTask.request.url?.absoluteString ?? ""
        let prefix = "tfrfile://media/"
        let box = TaskBox()
        objc_setAssociatedObject(urlSchemeTask, "tfrbox", box, .OBJC_ASSOCIATION_RETAIN)

        guard raw.hasPrefix(prefix) else {
            fail(box, urlSchemeTask, "Not a tfrfile media URL")
            return
        }
        var encoded = String(raw.dropFirst(prefix.count))
        if let queryStart = encoded.firstIndex(of: "?") {
            encoded = String(encoded[..<queryStart])
        }
        guard let path = encoded.removingPercentEncoding,
              !path.isEmpty, path.count <= 1024, !path.contains("..")
        else {
            fail(box, urlSchemeTask, "Bad media path")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            let fileURL = URL(fileURLWithPath: path)
            let canonical = fileURL.resolvingSymlinksInPath().path
            let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let roots = [
                docs.appendingPathComponent("tfr").resolvingSymlinksInPath().path,
                URL(fileURLWithPath: NSTemporaryDirectory())
                    .appendingPathComponent("tfr").resolvingSymlinksInPath().path,
            ]
            guard roots.contains(where: { canonical.hasPrefix($0 + "/") }) else {
                self.fail(box, urlSchemeTask, "Path outside the app's media folder")
                return
            }
            guard FileManager.default.fileExists(atPath: canonical) else {
                self.fail(box, urlSchemeTask, "Media not found")
                return
            }
            let ext = (canonical as NSString).pathExtension.lowercased()
            let mime = TfrBridgePlugin.mediaMime[ext] ?? "application/octet-stream"
            guard let data = try? Data(contentsOf: fileURL, options: .mappedIfSafe) else {
                self.fail(box, urlSchemeTask, "Media unreadable")
                return
            }
            guard !self.cancelled(box) else { return }
            let response = URLResponse(
                url: fileURL, mimeType: mime, expectedContentLength: data.count,
                textEncodingName: nil)
            urlSchemeTask.didReceive(response)
            guard !self.cancelled(box) else { return }
            // Memory-mapped data hands the web view the file pages directly.
            urlSchemeTask.didReceive(data)
            guard !self.cancelled(box) else { return }
            urlSchemeTask.didFinish()
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        if let box = objc_getAssociatedObject(urlSchemeTask, "tfrbox") as? TaskBox {
            box.lock.lock()
            box.cancelled = true
            box.lock.unlock()
        }
    }

    private func cancelled(_ box: TaskBox) -> Bool {
        box.lock.lock()
        defer { box.lock.unlock() }
        return box.cancelled
    }

    private func fail(_ box: TaskBox, _ task: WKURLSchemeTask, _ message: String) {
        guard !cancelled(box) else { return }
        task.didFailWithError(NSError(
            domain: "com.aporis.telegramfreerich.tfrbridge",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]))
    }
}
