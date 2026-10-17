/**
 * Telegram request layer.
 *
 * Requests go through Electron's `net` module — Chromium's network stack —
 * rather than Node's `https`. That is the whole reason the app works behind a
 * system proxy: Node ignores the operating system's proxy settings, Chromium
 * follows them (including PAC scripts), which is what a VPN client's
 * "Set system proxy" option configures.
 *
 * The Electron objects are injected so this module can be exercised without
 * booting a window.
 *
 * @module main/net/request
 */

const { describeProxy } = require('./proxy');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');

const HTTP_TIMEOUT_MS = 30000;
const MAX_RESPONSE_BYTES = 1048576;

/**
 * Turn a network failure into a message that points at the proxy when that is
 * the likely cause — the common case where Telegram is blocked.
 * @param {Error} error
 * @param {object} proxyConfig
 * @returns {string}
 */
function proxyHint(error, proxyConfig) {
  const message = (error && error.message) || 'Network error';
  if (/ERR_CERT/i.test(message)) {
    // A proxy that terminates TLS with a certificate the OS does not trust.
    return `${message} — the proxy is intercepting TLS; install its certificate or switch proxy`;
  }
  if (/PROXY|TUNNEL|ERR_SOCKS/i.test(message)) {
    return `${message} — check the proxy (${describeProxy(proxyConfig)})`;
  }
  if (
    proxyConfig.mode !== 'direct' &&
    /ERR_CONNECTION|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_EMPTY/i.test(message)
  ) {
    return `${message} — proxy: ${describeProxy(proxyConfig)}`;
  }
  return message;
}

/**
 * Build the request function.
 *
 * `getSession` is a getter rather than a session, because Electron's
 * `session.defaultSession` throws unless the app is already ready — reading it
 * while the main process is still loading its modules crashes the app before a
 * window exists.
 *
 * When `attachments` is non-empty the payload is sent as multipart/form-data
 * with each file as its own part (this is the only form the Bot API accepts
 * uploads in). The body is assembled by hand over `net.request`, so the whole
 * pipeline keeps Chromium's proxy handling; Node's FormData/fetch would bypass
 * the session and lose it.
 *
 * @param {{
 *   net: object,
 *   getSession: () => object,
 *   getProxy: () => object,
 *   timeoutMs?: number,
 *   maxBytes?: number,
 * }} deps
 * @returns {(url: string, payload?: object|null, attachments?: Array<{name: string, path: string}>) => Promise<object>}
 */
function createRequester({
  net,
  getSession,
  getProxy,
  timeoutMs = HTTP_TIMEOUT_MS,
  maxBytes = MAX_RESPONSE_BYTES,
}) {
  /**
   * Encode the multipart payload. Field values follow the Bot API rules:
   * strings as-is, objects JSON-serialized; files read once into a Buffer.
   * @param {object} payload
   * @param {Array<{name: string, path: string}>} attachments
   * @returns {{ body: Buffer, contentType: string }}
   */
  function encodeMultipart(payload, attachments) {
    const boundary = `----tfr${randomUUID()}`;
    const chunks = [];
    const field = (name, value) => {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
            `${value}\r\n`,
          'utf8',
        ),
      );
    };

    for (const [name, value] of Object.entries(payload || {})) {
      field(name, typeof value === 'string' ? value : JSON.stringify(value));
    }
    for (const attachment of attachments) {
      const filename = path.basename(attachment.path) || 'file';
      chunks.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${attachment.name}"; filename="${encodeURIComponent(
              filename,
            ).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}"\r\n\r\n`,
          'utf8',
        ),
      );
      chunks.push(fs.readFileSync(attachment.path));
      chunks.push(Buffer.from('\r\n', 'utf8'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
  }

  function tgRequest(url, payload = null, attachments = null) {
    // Attachments always travel as multipart, even alongside an empty payload.
    const isPost = payload !== null || (attachments && attachments.length > 0);
    let data = null;
    let contentType = 'application/json';

    if (isPost) {
      if (attachments && attachments.length) {
        const encoded = encodeMultipart(payload || {}, attachments);
        ({ body: data, contentType } = encoded);
      } else {
        data = JSON.stringify(payload);
      }
    }

    return new Promise((resolve, reject) => {
      const request = net.request({
        method: isPost ? 'POST' : 'GET',
        url,
        session: getSession(),
        useSessionCookies: false,
      });

      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          request.abort();
        } catch {
          /* already gone */
        }
        reject(new Error(proxyHint(error, getProxy())));
      };
      const succeed = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };

      const timer = setTimeout(() => fail(new Error('Request timeout')), timeoutMs);

      if (isPost) {
        // Content-Type only. Chromium computes Content-Length from the body it
        // is given and rejects a manually supplied one, so setting it here
        // failed every POST — every send — with `net::ERR_INVALID_ARGUMENT`,
        // while GET requests (the connection test) went through untouched.
        request.setHeader('Content-Type', contentType);
      }

      request.on('response', (response) => {
        /** @type {Buffer[]} */
        const chunks = [];
        let size = 0;

        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            fail(new Error('Response too large'));
            return;
          }
          // Kept as buffers and decoded once at the end. Appending each chunk
          // to a string decodes it on its own, and a UTF-8 character split
          // across two chunks becomes two replacement characters — which
          // mangles any non-ASCII text Telegram sends back, and breaks the
          // JSON parse outright when the split lands inside a string.
          chunks.push(Buffer.from(chunk));
        });

        response.on('end', () => {
          if (settled) return;
          const body = Buffer.concat(chunks).toString('utf8');
          try {
            succeed(JSON.parse(body));
          } catch {
            // The status matters here: a blocked network answers with a portal
            // page rather than JSON, and "Invalid JSON response" alone gives
            // the user nothing to go on.
            const status = response.statusCode ? ` (HTTP ${response.statusCode})` : '';
            fail(new Error(`Invalid JSON response${status}`));
          }
        });

        response.on('error', fail);
      });

      request.on('error', fail);

      if (data) request.write(data);
      request.end();
    });
  }

  return tgRequest;
}

module.exports = { createRequester, proxyHint, HTTP_TIMEOUT_MS, MAX_RESPONSE_BYTES };
