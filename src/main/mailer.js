// Sends mail through the user's Gmail account, and keeps the credentials where a backup can't leak them.
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
    status() {
      const g = config().gmail;
      if (outbox) return g?.user ? { configured: true, user: g.user, from_name: g.name || "", secure: true, reason: "" } : { configured: false, user: "", from_name: "", secure: true, reason: "No Gmail account is connected yet. Set one up in Settings → Push notifications." };
      const c = creds();
      const secure = (() => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } })();
      if (c) return { configured: true, user: c.user, from_name: c.name, secure, reason: "" };
      if (g?.user) return { configured: false, user: g.user, from_name: g.name || "", secure, reason: "The saved Gmail sign-in can't be read on this computer. Enter the app password again in Settings → Push notifications." };
      return { configured: false, user: "", from_name: "", secure, reason: secure ? "No Gmail account is connected yet. Set one up in Settings → Push notifications." : "This computer can't store a password securely, so Gmail can't be connected here." };
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

    async send({ to, subject, text, html }) {
      const addrs = (Array.isArray(to) ? to : [to]).map(String).filter(isEmail);
      if (!addrs.length) throw new Error("No valid email address to send to");
      if (outbox) {
        if (!config().gmail) throw new Error("No Gmail account is connected. Set one up in Settings → Push notifications.");
        fs.mkdirSync(outbox, { recursive: true });
        fs.writeFileSync(path.join(outbox, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`), JSON.stringify({ to: addrs, subject, text, html }, null, 1));
        return;
      }
      const c = creds();
      if (!c) throw new Error("No Gmail account is connected. Set one up in Settings → Push notifications.");
      try {
        await transport(c).sendMail({ from: c.name ? { name: c.name, address: c.user } : c.user, to: addrs, subject, text, html });
      } catch (e) {
        throw new Error(explain(e));
      }
    },
  };
}
