// Launch the real app against a folder of sample forms (never the real dump).
import { _electron as electron } from "playwright-core";
import electronPath from "electron";
import path from "node:path";

export async function launch(dumpDir, userData) {
  const app = await electron.launch({
    executablePath: electronPath,
    args: ["."],
    cwd: path.resolve(import.meta.dirname, "../.."),
    env: { ...process.env, CLOSET_DUMP: dumpDir, CLOSET_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.waitForLoadState("domcontentloaded");
  return { app, page, errors };
}

/** Poll the app's state until `cond(state)` holds (waitForFunction can't await the IPC call). */
export async function until(page, cond, timeout = 90000) {
  const t0 = Date.now();
  for (;;) {
    const s = await page.evaluate(() => window.closet.api("GET", "/api/state"));
    if (cond(s)) return s;
    if (Date.now() - t0 > timeout) throw new Error("timed out waiting for the app");
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Wait until every form in the dump folder has been read. */
export function settled(page, timeout) {
  return until(page, (s) => s.status.state === "idle" && !s.status.queued && s.forms.length > 0 && s.forms.every((f) => f.parsed || f.missing), timeout);
}
