"""HTTP API + static frontend for The Closet."""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from .store import Store

ROOT = Path(__file__).resolve().parents[1]
DUMP = Path(os.environ.get("CLOSET_DUMP", ROOT / "dump"))
META = Path(os.environ.get("CLOSET_METADATA", ROOT / "metadata"))
WEB = ROOT / "web"

store = Store(DUMP, META)
app = FastAPI(title="The Closet")

# Launched from the desktop shortcut there is no console to close, so the server shuts itself
# down once no browser tab has checked in for a while (open tabs poll every few seconds).
_last_seen = time.monotonic()


@app.middleware("http")
async def _touch(request, call_next):
    global _last_seen
    _last_seen = time.monotonic()
    return await call_next(request)


def _idle_watch(limit: float):
    while True:
        time.sleep(20)
        busy = store.queue or store.status.get("state") == "parsing"
        if not busy and time.monotonic() - _last_seen > limit:
            os._exit(0)  # every edit is already on disk (atomic writes)


if os.environ.get("CLOSET_IDLE_EXIT"):
    threading.Thread(target=_idle_watch, args=(float(os.environ["CLOSET_IDLE_EXIT"]),), daemon=True).start()


def _nocache(resp):
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/api/state")
def state():
    return _nocache(JSONResponse(store.snapshot()))


@app.get("/api/version")
def version():
    s = store.status
    return {"version": store.version, "status": dict(s, queued=len(store.queue))}


@app.post("/api/scan")
def scan():
    r = store.scan()
    return {**r, "version": store.version}


@app.post("/api/reset")
def reset(body: dict = Body(...)):
    if body.get("confirm") != "clear":
        raise HTTPException(400, "Missing confirmation")
    return {**store.reset(), "version": store.version}


@app.post("/api/names/resolve")
def resolve_names(body: dict = Body(...)):
    """Two similar spellings: the same person (with the correct spelling) or two people."""
    if not body.get("a") or not body.get("b"):
        raise HTTPException(400, "Need both names")
    store.resolve_names(body["a"], body["b"], bool(body.get("same")), body.get("correct", ""))
    return {"version": store.version}


@app.get("/api/forms/{fid}")
def form(fid: str):
    d = store.detail(fid)
    if not d:
        raise HTTPException(404, "No such form")
    return _nocache(JSONResponse(d))


@app.patch("/api/forms/{fid}")
def patch_form(fid: str, patch: dict = Body(...)):
    if not store.update_form(fid, patch):
        raise HTTPException(404, "No such form")
    return store.detail(fid)


@app.post("/api/forms/bulk")
def bulk(body: dict = Body(...)):
    ids = body.get("ids") or []
    patch = body.get("patch") or {}
    for fid in ids:
        store.update_form(fid, patch)
    return {"updated": len(ids), "version": store.version}


@app.post("/api/forms/{fid}/reparse")
def reparse(fid: str):
    store.reparse(fid)
    return {"ok": True}


@app.get("/api/forms/{fid}/page/{n}.png")
def page_png(fid: str, n: int):
    p = store.renders_dir / fid / f"p{n}.png"
    if not p.exists():
        raise HTTPException(404, "Page not rendered")
    return FileResponse(p, media_type="image/png", headers={"Cache-Control": "no-cache"})


@app.get("/api/forms/{fid}/pdf")
def pdf(fid: str):
    m = store.metas.get(fid)
    if not m:
        raise HTTPException(404, "No such form")
    p = store.dump / m["filename"]
    if not p.exists():
        raise HTTPException(404, "PDF is no longer in the dump folder")
    return FileResponse(p, media_type="application/pdf",
                        headers={"Content-Disposition": f'inline; filename="{m["filename"]}"'})


@app.get("/api/settings")
def get_settings():
    return store.settings


@app.put("/api/settings")
def put_settings(patch: dict = Body(...)):
    reparse = "position_tolerance_pt" in patch and patch["position_tolerance_pt"] != store.settings.get("position_tolerance_pt")
    s = store.update_settings(patch)
    if reparse:
        for fid in list(store.metas):
            store.reparse(fid)
    return s


@app.get("/api/export.tsv")
def export_tsv(ids: str = "", header: int = 0):
    snap = store.snapshot()
    want = set(ids.split(",")) if ids else None
    lines = []
    if header:
        lines.append("\t".join(snap["columns"]))
    for f in reversed(snap["forms"]):
        if f["missing"] or f["archived"] or (want is not None and f["id"] not in want):
            continue
        lines.extend("\t".join(r) for r in f["rows"])
    return PlainTextResponse("\n".join(lines))


app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
