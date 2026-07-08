"""Basic Windows system controls behind the permission-card flow.

Every command is an entry in a fixed whitelist — the router/LLM can only ever
*select* one, never compose a shell string, so "full PC control" stays inside
the same propose → confirm → execute contract as every other action.

Two intents split by risk (see registry.py):
- ``system_control``: lock, screenshot, volume, brightness — annoying at worst.
- ``system_power``: shutdown, restart, empty the Recycle Bin — destructive,
  so the registry forces a confirmation card every single time.
"""

from __future__ import annotations

import ctypes
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

# Virtual-key codes (keybd_event) — the stock way to nudge volume without deps.
_VK_VOLUME_MUTE = 0xAD
_VK_VOLUME_DOWN = 0xAE
_VK_VOLUME_UP = 0xAF
_KEYEVENTF_KEYUP = 0x0002
_VOLUME_TAPS = 5  # each tap = 2 volume units → ±10%


def _tap_key(vk: int, times: int = 1) -> None:
    for _ in range(times):
        ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
        ctypes.windll.user32.keybd_event(vk, 0, _KEYEVENTF_KEYUP, 0)
        time.sleep(0.02)


def _lock() -> dict[str, Any]:
    if not ctypes.windll.user32.LockWorkStation():
        return {"status": "error", "detail": "Windows refused to lock the workstation."}
    return {"status": "ok", "detail": "PC locked."}


def _screenshot() -> dict[str, Any]:
    try:
        from PIL import ImageGrab

        target_dir = Path.home() / "Pictures" / "Luna Screenshots"
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"screenshot_{time.strftime('%Y%m%d_%H%M%S')}.png"
        ImageGrab.grab().save(target)
        return {
            "status": "ok",
            "detail": f"Screenshot saved to {target}",
            "data": {"path": str(target)},
        }
    except Exception as exc:  # Pillow raises a zoo across capture backends
        return {"status": "error", "detail": f"Couldn't take a screenshot: {exc}"}


def _volume(vk: int, taps: int, verb: str) -> dict[str, Any]:
    try:
        _tap_key(vk, taps)
        return {"status": "ok", "detail": verb}
    except OSError as exc:
        return {"status": "error", "detail": f"Couldn't change the volume: {exc}"}


def _brightness(delta: int) -> dict[str, Any]:
    # WMI brightness works on laptop panels; external monitors won't have it.
    script = (
        "$b=(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness;"
        f"$n=[Math]::Max(0,[Math]::Min(100,$b+({delta})));"
        "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods)"
        ".WmiSetBrightness(1,$n);Write-Output $n"
    )
    try:
        completed = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            capture_output=True,
            timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if completed.returncode == 0:
            level = completed.stdout.decode(errors="replace").strip().splitlines()[-1:]
            suffix = f" (now {level[0]}%)" if level and level[0].isdigit() else ""
            return {"status": "ok", "detail": f"Brightness adjusted{suffix}."}
        return {
            "status": "error",
            "detail": "Couldn't adjust brightness — this usually only works on laptop screens.",
        }
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"status": "error", "detail": f"Couldn't adjust brightness: {exc}"}


def _empty_recycle_bin() -> dict[str, Any]:
    # SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND — Luna's own
    # confirmation card already asked; don't double-prompt with the shell dialog.
    flags = 0x1 | 0x2 | 0x4
    result = ctypes.windll.shell32.SHEmptyRecycleBinW(None, None, flags)
    if result == 0:
        return {"status": "ok", "detail": "Recycle Bin emptied."}
    if result in (-2147418113, 0x8000FFFF):  # E_UNEXPECTED → bin already empty
        return {"status": "ok", "detail": "Recycle Bin was already empty."}
    return {"status": "error", "detail": f"Couldn't empty the Recycle Bin (code {result})."}


def _power(flag: str, verb: str) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            ["shutdown", flag, "/t", "15"],
            capture_output=True,
            timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if completed.returncode == 0:
            return {
                "status": "ok",
                "detail": f"{verb} in 15 seconds. Run \"shutdown /a\" to cancel.",
            }
        stderr = completed.stderr.decode(errors="replace").strip()
        return {"status": "error", "detail": f"Windows refused: {stderr or 'unknown error'}"}
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"status": "error", "detail": f"Couldn't run that: {exc}"}


# --- Whitelist: command -> (card preview, executor) --------------------------------

_SAFE_COMMANDS: dict[str, tuple[str, Callable[[], dict[str, Any]]]] = {
    "lock": ("Lock this PC (you'll need your password to get back in)", _lock),
    "screenshot": ("Take a screenshot of the full screen and save it to Pictures\\Luna Screenshots", _screenshot),
    "mute": ("Toggle the system volume mute", lambda: _volume(_VK_VOLUME_MUTE, 1, "Toggled mute.")),
    "volume_up": ("Turn the system volume up ~10%", lambda: _volume(_VK_VOLUME_UP, _VOLUME_TAPS, "Volume up.")),
    "volume_down": ("Turn the system volume down ~10%", lambda: _volume(_VK_VOLUME_DOWN, _VOLUME_TAPS, "Volume down.")),
    "brightness_up": ("Increase screen brightness by 20%", lambda: _brightness(20)),
    "brightness_down": ("Decrease screen brightness by 20%", lambda: _brightness(-20)),
}

_POWER_COMMANDS: dict[str, tuple[str, Callable[[], dict[str, Any]]]] = {
    "shutdown": ("Shut down this PC (15-second delay, cancellable)", lambda: _power("/s", "Shutting down")),
    "restart": ("Restart this PC (15-second delay, cancellable)", lambda: _power("/r", "Restarting")),
    "empty_recycle_bin": ("Permanently delete everything in the Recycle Bin", _empty_recycle_bin),
}

_ALL_COMMANDS = {**_SAFE_COMMANDS, **_POWER_COMMANDS}

SAFE_COMMAND_NAMES = sorted(_SAFE_COMMANDS)
POWER_COMMAND_NAMES = sorted(_POWER_COMMANDS)


def preview(command: str) -> str:
    entry = _ALL_COMMANDS.get(command.strip().lower())
    if entry is None:
        return f"Unknown system command \"{command}\""
    return entry[0]


def run(command: str) -> dict[str, Any]:
    """Execute a whitelisted system command. Anything else is rejected."""
    entry = _ALL_COMMANDS.get(command.strip().lower())
    if entry is None:
        known = ", ".join(sorted(_ALL_COMMANDS))
        return {"status": "error", "detail": f"Unknown system command \"{command}\". I know: {known}."}
    return entry[1]()
