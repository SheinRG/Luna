"""App launching: curated system targets first, then Start Menu .lnk scan (SPEC §8).

Resolution order:
1. Windows Settings pages via ``ms-settings:`` URIs — Settings is a UWP app
   with NO .lnk in the Start Menu folders, so without this tier "settings"
   fuzzy-matched whatever shortcut happened to contain the word (e.g. "WSL
   Settings"). URIs are exact and instant.
2. Well-known system tools by canonical command (taskmgr, control, ...).
3. Start Menu .lnk scan: exact stem, then substring, then difflib fuzzy with
   a high cutoff (0.86) so "wifi settings" can never leap to "wsl settings".
4. ``start`` shell fallback for anything else.
"""

from __future__ import annotations

import difflib
import os
import subprocess
import time
from pathlib import Path
from typing import Any

_SCAN_CACHE: tuple[float, list[tuple[str, Path]]] | None = None
_SCAN_TTL_SECONDS = 300.0

_IGNORED_WORDS = {"uninstall", "readme", "help", "website", "documentation"}

_FUZZY_CUTOFF = 0.86  # 0.75 let "wifi settings" match "wsl settings" (ratio 0.8)

# --- Tier 1: Windows Settings pages (ms-settings: deep links) -----------------
# Keys are normalized user phrasings; values are official ms-settings URIs.
_SETTINGS_URIS: dict[str, tuple[str, str]] = {  # phrase -> (uri, friendly label)
    "settings": ("ms-settings:", "Windows Settings"),
    "windows settings": ("ms-settings:", "Windows Settings"),
    "system settings": ("ms-settings:", "Windows Settings"),
    "pc settings": ("ms-settings:", "Windows Settings"),
    "wifi": ("ms-settings:network-wifi", "Wi-Fi settings"),
    "wi-fi": ("ms-settings:network-wifi", "Wi-Fi settings"),
    "wifi settings": ("ms-settings:network-wifi", "Wi-Fi settings"),
    "wi-fi settings": ("ms-settings:network-wifi", "Wi-Fi settings"),
    "wireless settings": ("ms-settings:network-wifi", "Wi-Fi settings"),
    "network settings": ("ms-settings:network", "Network settings"),
    "internet settings": ("ms-settings:network", "Network settings"),
    "airplane mode": ("ms-settings:network-airplanemode", "Airplane mode"),
    "vpn settings": ("ms-settings:network-vpn", "VPN settings"),
    "vpn": ("ms-settings:network-vpn", "VPN settings"),
    "bluetooth": ("ms-settings:bluetooth", "Bluetooth settings"),
    "bluetooth settings": ("ms-settings:bluetooth", "Bluetooth settings"),
    "display settings": ("ms-settings:display", "Display settings"),
    "screen settings": ("ms-settings:display", "Display settings"),
    "brightness settings": ("ms-settings:display", "Display settings"),
    "night light": ("ms-settings:nightlight", "Night light settings"),
    "sound settings": ("ms-settings:sound", "Sound settings"),
    "audio settings": ("ms-settings:sound", "Sound settings"),
    "volume settings": ("ms-settings:sound", "Sound settings"),
    "battery settings": ("ms-settings:batterysaver", "Battery settings"),
    "battery saver": ("ms-settings:batterysaver", "Battery saver"),
    "power settings": ("ms-settings:powersleep", "Power & sleep settings"),
    "storage settings": ("ms-settings:storagesense", "Storage settings"),
    "apps settings": ("ms-settings:appsfeatures", "Installed apps"),
    "installed apps": ("ms-settings:appsfeatures", "Installed apps"),
    "default apps": ("ms-settings:defaultapps", "Default apps"),
    "windows update": ("ms-settings:windowsupdate", "Windows Update"),
    "update settings": ("ms-settings:windowsupdate", "Windows Update"),
    "privacy settings": ("ms-settings:privacy", "Privacy settings"),
    "notification settings": ("ms-settings:notifications", "Notification settings"),
    "notifications settings": ("ms-settings:notifications", "Notification settings"),
    "focus assist": ("ms-settings:quiethours", "Focus assist"),
    "personalization": ("ms-settings:personalization", "Personalization"),
    "wallpaper settings": ("ms-settings:personalization-background", "Background settings"),
    "background settings": ("ms-settings:personalization-background", "Background settings"),
    "lock screen settings": ("ms-settings:lockscreen", "Lock screen settings"),
    "taskbar settings": ("ms-settings:taskbar", "Taskbar settings"),
    "language settings": ("ms-settings:regionlanguage", "Language settings"),
    "keyboard settings": ("ms-settings:typing", "Typing settings"),
    "mouse settings": ("ms-settings:mousetouchpad", "Mouse settings"),
    "touchpad settings": ("ms-settings:devices-touchpad", "Touchpad settings"),
    "printer settings": ("ms-settings:printers", "Printers & scanners"),
    "printers": ("ms-settings:printers", "Printers & scanners"),
    "camera settings": ("ms-settings:privacy-webcam", "Camera settings"),
    "microphone settings": ("ms-settings:privacy-microphone", "Microphone settings"),
    "date and time": ("ms-settings:dateandtime", "Date & time settings"),
    "time settings": ("ms-settings:dateandtime", "Date & time settings"),
    "about this pc": ("ms-settings:about", "About this PC"),
}

# --- Tier 2: well-known system tools by canonical command ----------------------
_SYSTEM_APPS: dict[str, tuple[str, str]] = {  # phrase -> (command, friendly label)
    "task manager": ("taskmgr", "Task Manager"),
    "control panel": ("control", "Control Panel"),
    "file explorer": ("explorer", "File Explorer"),
    "explorer": ("explorer", "File Explorer"),
    "notepad": ("notepad", "Notepad"),
    "calculator": ("calc", "Calculator"),
    "calc": ("calc", "Calculator"),
    "command prompt": ("cmd", "Command Prompt"),
    "cmd": ("cmd", "Command Prompt"),
    "terminal": ("wt", "Windows Terminal"),
    "powershell": ("powershell", "PowerShell"),
    "paint": ("mspaint", "Paint"),
    "snipping tool": ("snippingtool", "Snipping Tool"),
    "recycle bin": ("shell:RecycleBinFolder", "Recycle Bin"),
    "downloads folder": ("shell:Downloads", "Downloads folder"),
    "device manager": ("devmgmt.msc", "Device Manager"),
    "disk cleanup": ("cleanmgr", "Disk Cleanup"),
}


def _normalize(name: str) -> str:
    q = " ".join(name.strip().lower().rstrip(".!?").split())
    for prefix in ("the ", "my "):
        if q.startswith(prefix):
            q = q[len(prefix):]
    return q


def _start_menu_dirs() -> list[Path]:
    dirs: list[Path] = []
    program_data = os.environ.get("PROGRAMDATA")
    app_data = os.environ.get("APPDATA")
    if program_data:
        dirs.append(Path(program_data) / "Microsoft" / "Windows" / "Start Menu" / "Programs")
    if app_data:
        dirs.append(Path(app_data) / "Microsoft" / "Windows" / "Start Menu" / "Programs")
    return [d for d in dirs if d.is_dir()]


def scan_shortcuts() -> list[tuple[str, Path]]:
    """Return (lowercase stem, path) for every Start Menu .lnk, cached 5 min."""
    global _SCAN_CACHE
    now = time.monotonic()
    if _SCAN_CACHE is not None and now - _SCAN_CACHE[0] < _SCAN_TTL_SECONDS:
        return _SCAN_CACHE[1]
    shortcuts: list[tuple[str, Path]] = []
    for root in _start_menu_dirs():
        for path in root.rglob("*.lnk"):
            stem = path.stem.lower()
            if any(word in stem for word in _IGNORED_WORDS):
                continue
            shortcuts.append((stem, path))
    _SCAN_CACHE = (now, shortcuts)
    return shortcuts


def find_app(name: str) -> Path | None:
    """Fuzzy-match an app name against Start Menu shortcut stems."""
    query = _normalize(name)
    if not query:
        return None
    shortcuts = scan_shortcuts()
    if not shortcuts:
        return None

    # 1. Exact stem match, 2. substring match (shortest stem wins — most specific),
    # 3. difflib closest match above a strict cutoff (see _FUZZY_CUTOFF note).
    for stem, path in shortcuts:
        if stem == query:
            return path
    substring_hits = [(stem, path) for stem, path in shortcuts if query in stem]
    if substring_hits:
        substring_hits.sort(key=lambda t: len(t[0]))
        return substring_hits[0][1]
    stems = [stem for stem, _ in shortcuts]
    close = difflib.get_close_matches(query, stems, n=1, cutoff=_FUZZY_CUTOFF)
    if close:
        for stem, path in shortcuts:
            if stem == close[0]:
                return path
    return None


def resolve_app(name: str) -> tuple[str, str, str] | None:
    """Resolve a spoken app name to (kind, target, label).

    kind: "uri" (ms-settings/shell deep link), "command" (canonical exe),
    or "shortcut" (Start Menu .lnk path). None → caller falls back to the
    ``start`` shell.
    """
    query = _normalize(name)
    if not query:
        return None
    hit = _SETTINGS_URIS.get(query)
    if hit is None and not query.endswith("settings"):
        # "open wifi" == "open wifi settings"; don't do this for e.g. "apps".
        hit = _SETTINGS_URIS.get(f"{query} settings")
    if hit is not None:
        return ("uri", hit[0], hit[1])
    sys_hit = _SYSTEM_APPS.get(query)
    if sys_hit is not None:
        kind = "uri" if sys_hit[0].startswith("shell:") else "command"
        return (kind, sys_hit[0], sys_hit[1])
    shortcut = find_app(query)
    if shortcut is not None:
        return ("shortcut", str(shortcut), shortcut.stem)
    return None


def launch_app(name: str) -> dict[str, Any]:
    """Launch an app by name. Returns {status, detail, data?}."""
    name = name.strip().rstrip(".!?")
    if not name:
        return {"status": "error", "detail": "No app name given."}
    resolved = resolve_app(name)
    if resolved is not None:
        kind, target, label = resolved
        try:
            if kind in ("uri", "shortcut"):
                os.startfile(target)  # noqa: S606 - deliberate shell open
            else:  # canonical command — let the shell resolve it off PATH
                subprocess.run(
                    ["cmd", "/c", "start", "", target],
                    capture_output=True,
                    timeout=10,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                    check=True,
                )
            return {
                "status": "ok",
                "detail": f"Opened {label}.",
                "data": {"matched": label, "target": target},
            }
        except (OSError, subprocess.SubprocessError) as exc:
            return {"status": "error", "detail": f"Found {label} but couldn't open it: {exc}"}
    # Fallback: let the shell resolve it (arbitrary exes, URLs...).
    try:
        completed = subprocess.run(
            ["cmd", "/c", "start", "", name],
            capture_output=True,
            timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if completed.returncode == 0:
            return {"status": "ok", "detail": f"Started {name}.", "data": {"matched": name}}
        stderr = completed.stderr.decode(errors="replace").strip()
        return {
            "status": "error",
            "detail": f"Couldn't find an app called \"{name}\"." + (f" ({stderr})" if stderr else ""),
        }
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"status": "error", "detail": f"Failed to start {name}: {exc}"}


def preview_launch(name: str) -> str:
    """Human-readable preview for the action proposal card — must show what
    actually resolved so the user never approves a mystery launch."""
    resolved = resolve_app(name)
    if resolved is None:
        return f"Try to start \"{name}\" via the Windows shell"
    kind, _target, label = resolved
    if kind == "uri":
        return f"Open {label}"
    if kind == "command":
        return f"Open {label}"
    return f"Open \"{label}\" (Start Menu shortcut)"
