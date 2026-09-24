"""Start The Closet.

    python run.py                    # console mode, opens http://127.0.0.1:8765
    pythonw run.py --exit-when-idle  # what the desktop shortcut runs (no console window)

If The Closet is already running, this just opens it in the browser.
"""

import argparse
import json
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
META = Path(os.environ.get("CLOSET_METADATA", ROOT / "metadata"))
PORT_FILE = META / "port.txt"
HEADLESS = sys.stdout is None  # started by pythonw (desktop shortcut): no console to print to


def is_closet(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/version", timeout=1.5) as r:
            return "version" in json.loads(r.read())
    except Exception:
        return False


def port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((host, port)) != 0


def take_lock():
    """Hold an OS lock on metadata/closet.lock for the life of the process (None if taken)."""
    f = open(META / "closet.lock", "a+")
    try:
        if os.name == "nt":
            import msvcrt
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        return None
    return f


def running_port(default: int) -> int | None:
    candidates = [default]
    try:
        candidates.insert(0, int(PORT_FILE.read_text().strip()))
    except (OSError, ValueError):
        pass
    return next((p for p in dict.fromkeys(candidates) if is_closet(p)), None)


def message_box(text: str):
    """Errors must be visible even when started without a console."""
    if HEADLESS and os.name == "nt":
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, "The Closet", 0x10)
    else:
        print(text, file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description="The Closet")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--exit-when-idle", action="store_true",
                    help="shut down after 10 minutes with no browser tab open")
    args = ap.parse_args()

    META.mkdir(parents=True, exist_ok=True)
    if HEADLESS:  # keep a log instead of a console
        log = open(META / "closet.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = log

    # Only one copy runs at a time. A second launch (double-clicked shortcut) waits for the
    # first one to come up and then just opens it in the browser.
    lock = take_lock()
    if lock is None:
        for _ in range(60):
            p = running_port(args.port)
            if p:
                if not args.no_browser:
                    webbrowser.open(f"http://{args.host}:{p}")
                return
            time.sleep(0.5)
        message_box("The Closet is already starting but isn't responding. Try again in a minute.")
        sys.exit(1)

    port = next((p for p in range(args.port, args.port + 20) if port_free(args.host, p)), None)
    if port is None:
        message_box(f"The Closet couldn't find a free port near {args.port}.")
        sys.exit(1)
    PORT_FILE.write_text(str(port))
    if args.exit_when_idle:
        os.environ["CLOSET_IDLE_EXIT"] = "600"

    try:
        import uvicorn
        from closet.server import app
    except Exception as e:  # missing dependency, broken install
        message_box(f"The Closet couldn't start:\n\n{e}\n\nRun the installer again to repair it.")
        sys.exit(1)

    url = f"http://{args.host}:{port}"
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    print(f"The Closet is open at {url}  (Ctrl+C to close)", flush=True)
    uvicorn.run(app, host=args.host, port=port, log_level="warning", log_config=None)


if __name__ == "__main__":
    os.chdir(ROOT)
    sys.path.insert(0, str(ROOT))
    main()
