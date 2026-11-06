// Sends mail through the user's Gmail account or their Outlook desktop app, and keeps the Gmail
// credentials where a backup can't leak them. Outlook (outlook.js) needs no credentials at all, and
// can either send or only save drafts. Which one is used is `config.mail`, per computer.
//
// The app password is encrypted with the operating system's keychain (Electron safeStorage) and kept
// in the per-computer config.json, never in the metadata folder (which backups and sync copies carry).
// If the system can't encrypt, nothing is stored and the user is told why: there is no plain-text
// fallback. Gmail needs 2-Step Verification and an app password (myaccount.google.com/apppasswords);
// a normal account password is refused by Google for programs like this.

import fs from "node:fs";
import path from "node:path";

import nodemailer from "nodemailer";

import { isEmail } from "../core/contacts.js";
import * as outlook from "./outlook.js";

const TIMEOUTS = { connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 };

/** What went wrong, in words someone can act on. */
export function explain(e) {
  const code = e?.code || "";
  const msg = String(e?.response || e?.message || e);
  if (code === "EAUTH" || /535|Username and Password not accepted|BadCredentials/i.test(msg)) {
    return "Gmail rejected the sign-in. Use a 16-character app password (Google Account → Security → 2-Step Verification → App passwords), not your normal password.";
  }
  if (["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ESOCKET", "ECONNECTION", "EDNS"].includes(code)) {
    return "Couldn't reach Gmail. Check the internet connection and try again.";
  }
  if (/quota|limit exceeded|too many|550-5\.4\.5/i.test(msg)) return "Gmail's daily sending limit was reached. Try again tomorrow.";
  if (/invalid recipient|no such user|550/i.test(msg)) return `Gmail refused an address: ${msg.slice(0, 160)}`;
  return `Couldn't send: ${msg.slice(0, 200)}`;
}

/**
 * @param {{ config: () => object, save: () => void, safeStorage: object }} o
 *   `config()` returns the live config object (so it follows reloads); `save()` writes it.
 */
export function createMailer({ config, save, safeStorage }) {
  const outbox = process.env.CLOSET_MAIL_OUTBOX; // tests: write messages to a folder instead of Gmail
  const creds = () => {
    const g = config().gmail;
    if (!g?.user || !g.pw) return null;
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return { user: g.user, name: g.name || "", pass: safeStorage.decryptString(Buffer.from(g.pw, "base64")) };
    } catch {
      return null; // unreadable (different OS account, restored profile): treated as not connected
    }
  };
  const transport = (c) => nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: c.user, pass: c.pass }, ...TIMEOUTS });

  return {
    /** Which program sends, and (for Outlook) whether it sends or only saves drafts. */
    settings() {
      const m = config().mail || {};
      return { provider: m.provider === "outlook" ? "outlook" : "gmail", outlook_mode: m.outlookMode === "send" ? "send" : "drafts" };
    },

    setSettings({ provider, outlook_mode }) {
      const cur = this.settings();
      const next = { provider: provider ?? cur.provider, outlook_mode: outlook_mode ?? cur.outlook_mode };
      if (!["gmail", "outlook"].includes(next.provider)) throw new Error("Choose Gmail or Outlook");
      if (!["drafts", "send"].includes(next.outlook_mode)) throw new Error("Choose drafts or send");
      config().mail = { ...(config().mail || {}), provider: next.provider, outlookMode: next.outlook_mode };
      save();
    },

    /** Attach to Outlook, learn which address it sends from, and remember it. */
    async checkOutlook() {
      if (!outbox && !outlook.installed()) throw new Error(this.status({ provider: "outlook" }).reason);
      const user = outbox ? "tester@example.test" : String(await outlook.probe()).trim().toLowerCase();
      if (!isEmail(user)) throw new Error("Outlook is running but didn't say which account it sends from. Open Outlook, make sure an account is signed in, and try again.");
      config().mail = { ...(config().mail || {}), outlookUser: user };
      save();
      return user;
    },

    status(over = {}) {
      const { provider, outlook_mode } = { ...this.settings(), ...over };
      const base = { provider, outlook_mode, drafts: false, pace: 350 };
      if (provider === "outlook") {
        const o = { ...base, from_name: "", secure: true, drafts: outlook_mode === "drafts", pace: outlook_mode === "send" ? 1500 : 100 };
        const user = config().mail?.outlookUser || "";
        if (!outbox && process.platform !== "win32") return { ...o, configured: false, user: "", reason: "Sending through Outlook only works on Windows." };
        if (!outbox && !outlook.installed()) return { ...o, configured: false, user: "", reason: "Classic Outlook isn't installed on this computer. The new Outlook app can't be controlled by closet." };
        if (!user) return { ...o, configured: false, user: "", reason: "Outlook hasn't been checked yet. Choose Check Outlook in Settings → Push notifications." };
        return { ...o, configured: true, user, reason: "" };
      }
      const g = config().gmail;
      if (outbox) return g?.user ? { ...base, configured: true, user: g.user, from_name: g.name || "", secure: true, reason: "" } : { ...base, configured: false, user: "", from_name: "", secure: true, reason: "No Gmail account is connected yet. Set one up in Settings → Push notifications." };
      const c = creds();
      const secure = (() => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } })();
      if (c) return { ...base, configured: true, user: c.user, from_name: c.name, secure, reason: "" };
      if (g?.user) return { ...base, configured: false, user: g.user, from_name: g.name || "", secure, reason: "The saved Gmail sign-in can't be read on this computer. Enter the app password again in Settings → Push notifications." };
      return { ...base, configured: false, user: "", from_name: "", secure, reason: secure ? "No Gmail account is connected yet. Set one up in Settings → Push notifications." : "This computer can't store a password securely, so Gmail can't be connected here." };
    },

    /** Check the sign-in with Google first; only a working one is stored. */
    async connect({ user, password, from_name }) {
      user = String(user || "").trim().toLowerCase();
      const pass = String(password || "").replace(/\s+/g, "");
      if (!isEmail(user)) throw new Error("Enter the full Gmail address, like name@gmail.com");
      if (pass.length < 8) throw new Error("Enter the app password Google gave you (16 letters)");
      if (!outbox && !safeStorage.isEncryptionAvailable()) throw new Error("This computer can't store a password securely, so closet won't keep one. Nothing was saved.");
      if (!outbox) {
        try {
          await transport({ user, pass }).verify();
        } catch (e) {
          throw new Error(explain(e));
        }
      }
      const name = String(from_name || "").replace(/[\r\n"<>]/g, " ").trim().slice(0, 80);
      config().gmail = { user, name, pw: outbox ? "x" : safeStorage.encryptString(pass).toString("base64") };
      save();
    },

    disconnect() {
      delete config().gmail;
      save();
    },

    async send({ to, subject, text, html, attachments = [] }) {
      const addrs = (Array.isArray(to) ? to : [to]).map(String).filter(isEmail);
      if (!addrs.length) throw new Error("No valid email address to send to");
      const st = this.status();
      if (!st.configured) throw new Error(st.reason);
      if (outbox) {
        fs.mkdirSync(outbox, { recursive: true });
        const via = st.provider === "outlook" ? { via: "outlook", mode: st.drafts ? "drafts" : "send" } : {};
        fs.writeFileSync(path.join(outbox, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`), JSON.stringify({ to: addrs, subject, text, html, attachments: attachments.map((a) => a.filename), ...via }, null, 1));
        return;
      }
      if (st.provider === "outlook") return outlook.deliver({ to: addrs, subject, text, html, attachments, mode: st.drafts ? "drafts" : "send" });
      const c = creds();
      try {
        await transport(c).sendMail({ from: c.name ? { name: c.name, address: c.user } : c.user, to: addrs, subject, text, html, attachments: attachments.map((a) => ({ filename: a.filename, path: a.path })) });
      } catch (e) {
        throw new Error(explain(e));
      }
    },
  };
}
