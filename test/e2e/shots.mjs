import { launch, settled } from "./launch.mjs";
const [dump, userData, out] = process.argv.slice(2);
const { app, page, errors } = await launch(dump, userData);
await page.setViewportSize?.({ width: 1440, height: 900 });
const t0 = Date.now();
await settled(page);
console.log("all forms read in", Date.now() - t0, "ms");
await page.waitForTimeout(800);
for (const v of ["overview", "paperwork", "review", "cadets", "export", "archive", "settings"]) {
  await page.evaluate((v) => (location.hash = "#/" + v), v);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${v}.png` });
}
await page.evaluate(() => (location.hash = "#/paperwork"));
await page.waitForTimeout(500);
await page.click("tr[data-open] >> text=John A Doe");
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/drawer.png` });
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await app.close();
