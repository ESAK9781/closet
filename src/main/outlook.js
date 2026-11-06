// Sends (or saves as drafts) mail through the classic Outlook desktop app already signed in on this
// computer, by driving it over COM from a hidden PowerShell. No password is involved: Outlook uses
// the user's own session, which is the point on a locked-down work account.
//
// Only outgoing items are created here. Nothing in this file opens a mail folder or reads a message.
// The new "Outlook for Windows" app has no COM interface, so only classic Outlook works.
// The message travels to PowerShell as base64 on stdin, never on the command line, so it can't be
// mangled by quoting or shown in a process list.

import { spawn, spawnSync } from "node:child_process";

const WIN = process.platform === "win32";
let available = { at: 0, ok: false };

/** Is classic Outlook registered for automation? Cheap, never starts Outlook; cached briefly. */
export function installed() {
  if (!WIN) return false;
  if (Date.now() - available.at < 30000) return available.ok;
  // synchronous on purpose: status() is called on every refresh
  const r = spawnSync("reg.exe", ["query", "HKCR\\Outlook.Application\\CLSID"], { windowsHide: true, timeout: 5000 });
  available = { at: Date.now(), ok: r.status === 0 };
  return available.ok;
}

const WRAP = (body) => `
$ErrorActionPreference = 'Stop'
try {
${body}
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}`;

const PROBE = WRAP(`
$ol = New-Object -ComObject Outlook.Application
$addr = ''
try { $addr = $ol.Session.CurrentUser.AddressEntry.GetExchangeUser().PrimarySmtpAddress } catch {}
if (-not $addr) { try { $addr = $ol.Session.Accounts.Item(1).SmtpAddress } catch {} }
[Console]::Out.WriteLine($addr)`);

const SEND = WRAP(`
$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(([Console]::In.ReadToEnd()).Trim())) | ConvertFrom-Json
$ol = New-Object -ComObject Outlook.Application
$m = $ol.CreateItem(0)
$m.To = (@($p.to) -join ';')
$m.Subject = [string]$p.subject
if ($p.html) { $m.HTMLBody = [string]$p.html } else { $m.Body = [string]$p.text }
foreach ($a in @($p.attachments)) { if ($a) { [void]$m.Attachments.Add([string]$a.path, 1, 0, [string]$a.filename) } }
if ($p.mode -eq 'send') { $m.Send() } else { $m.Save() }`);

/** What went wrong, in words someone can act on. */
export function explain(msg) {
  msg = String(msg || "").trim();
  if (/Only core types are supported|language mode/i.test(msg)) return "This computer's security settings stop programs from controlling Outlook (PowerShell is locked down). Use drafts through another route or ask your IT office to allow it.";
  if (/Class not registered|Invalid class string|80040154|Cannot create|ActiveX/i.test(msg)) return "Classic Outlook isn't installed or can't be controlled. The new Outlook app doesn't support this; switch back to classic Outlook.";
  if (/operation aborted|blocked|security|80004004/i.test(msg)) return "Outlook (or a security policy) refused the request. If a prompt appeared in Outlook, allow it and try again.";
  if (/resolve|recipient/i.test(msg)) return `Outlook couldn't resolve an address: ${msg.slice(0, 160)}`;
  if (/timed out/i.test(msg)) return "Outlook didn't respond in time. Make sure it's open and not waiting on a dialog box, then try again.";
  return `Outlook error: ${msg.slice(0, 200) || "unknown"}`;
}

function run(script, input, timeout = 90000) {
  return new Promise((resolve, reject) => {
    const enc = Buffer.from(script, "utf16le").toString("base64");
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc], { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("timed out")); }, timeout);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.replace(/#< CLIXML[\s\S]*$/, "").trim() || `PowerShell exited with ${code}`));
    });
    p.stdin.on("error", () => {}); // it may exit before reading
    p.stdin.end(input || "");
  });
}

/** Attach to Outlook (starting it if needed) and return the signed-in address. */
export async function probe() {
  try {
    return await run(PROBE, "", 60000);
  } catch (e) {
    throw new Error(explain(e.message));
  }
}

/** mode: "send" sends now; anything else saves a draft in Outlook's Drafts folder. */
export async function deliver({ to, subject, text, html, attachments = [], mode }) {
  const payload = Buffer.from(JSON.stringify({ to, subject, text, html, attachments, mode }), "utf8").toString("base64");
  try {
    await run(SEND, payload);
  } catch (e) {
    throw new Error(explain(e.message));
  }
}
