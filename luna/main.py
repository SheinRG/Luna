"""Luna entry point.

Boot order:
1. pick a free localhost port,
2. start uvicorn (FastAPI) in a daemon thread,
3. start the reminder scheduler thread (winotify toasts),
4. open the UI — pywebview window, falling back to Edge app-mode, falling
   back to the default browser. ``LUNA_NO_WINDOW=1`` skips the window
   entirely (server only; used for testing and CI).

Run with: ``uv run python -m luna.main``
"""

from __future__ import annotations

import os
import socket
import subprocess
import threading
import time
import webbrowser
from datetime import datetime
from pathlib import Path

import uvicorn

from luna.config import APP_NAME, REMINDER_POLL_SECONDS
from luna.db import get_connection, init_db
from luna.server.app import create_app


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _run_server(server: uvicorn.Server) -> None:
    """Run uvicorn, persisting any startup crash to a log the packaged (no-console)
    build would otherwise swallow."""
    try:
        server.run()
    except Exception:
        import traceback

        try:
            from luna.config import get_data_dir

            (get_data_dir() / "luna_crash.log").write_text(
                traceback.format_exc(), encoding="utf-8"
            )
        except Exception:
            pass


def _wait_for_server(port: int, timeout: float = 15.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.15)
    return False


# --- Reminder scheduler --------------------------------------------------------

def _fire_toast(text: str) -> None:
    try:
        from winotify import Notification

        toast = Notification(
            app_id=APP_NAME,
            title=f"{APP_NAME} reminder",
            msg=text,
        )
        toast.show()
    except Exception:
        pass  # toast failure must never kill the scheduler


def _check_due_reminders() -> None:
    conn = get_connection()
    now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    rows = conn.execute(
        "SELECT id, text FROM reminders WHERE fired=0 AND due_at <= ?", (now,)
    ).fetchall()
    for row in rows:
        _fire_toast(row["text"])
        conn.execute("UPDATE reminders SET fired=1 WHERE id=?", (row["id"],))
    if rows:
        conn.commit()


def _reminder_loop(stop: threading.Event) -> None:
    while not stop.wait(REMINDER_POLL_SECONDS):
        try:
            _check_due_reminders()
        except Exception:
            pass


# --- Window management -----------------------------------------------------------

def _edge_path() -> Path | None:
    for env in ("PROGRAMFILES(X86)", "PROGRAMFILES"):
        base = os.environ.get(env)
        if base:
            candidate = Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe"
            if candidate.is_file():
                return candidate
    return None


def _open_window(url: str, title: str) -> None:
    """pywebview (blocks until closed) → Edge app-mode → default browser."""
    try:
        import webview

        webview.create_window(
            title, url, width=1200, height=800, min_size=(900, 620)
        )
        webview.start()
        return
    except Exception:
        pass

    edge = _edge_path()
    if edge is not None:
        try:
            proc = subprocess.Popen([str(edge), f"--app={url}"])
            proc.wait()
            return
        except OSError:
            pass

    webbrowser.open(url)
    # Nothing to block on with a plain browser tab — keep the server alive.
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


def _ensure_std_streams() -> None:
    """In a --noconsole PyInstaller build sys.stdout/stderr are None, which
    breaks uvicorn's logging config and any print(). Point them at a sink."""
    import sys

    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w")  # noqa: SIM115
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w")  # noqa: SIM115


def main() -> None:
    _ensure_std_streams()
    init_db()
    conn = get_connection()
    row = conn.execute("SELECT value FROM settings WHERE key='assistant_name'").fetchone()
    title = (row["value"] if row else None) or APP_NAME

    port = _find_free_port()
    app = create_app()
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", log_config=None)
    )
    threading.Thread(target=_run_server, args=(server,), daemon=True, name="luna-uvicorn").start()

    stop_reminders = threading.Event()
    threading.Thread(
        target=_reminder_loop, args=(stop_reminders,), daemon=True, name="luna-reminders"
    ).start()

    url = f"http://127.0.0.1:{port}/"
    if not _wait_for_server(port):
        print(f"[luna] server failed to start on {url}")
        return
    print(f"[luna] serving at {url}")

    if os.environ.get("LUNA_NO_WINDOW") == "1":
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
    else:
        _open_window(url, title)

    stop_reminders.set()


if __name__ == "__main__":
    main()
