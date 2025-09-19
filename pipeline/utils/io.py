from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=False)
        handle.write("\n")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def snapshot_history(latest_path: Path, history_dir: Path, as_of: datetime) -> Path:
    ensure_dir(history_dir)
    history_name = f"{as_of.strftime('%Y%m%dT%H%M%SZ')}.json"
    history_path = history_dir / history_name
    history_path.write_text(latest_path.read_text(encoding="utf-8"), encoding="utf-8")
    return history_path


def git_diff_paths(paths: Iterable[Path]) -> bool:
    expanded = [str(path) for path in paths]
    result = subprocess.run(
        ["git", "status", "--porcelain", "--"] + expanded,
        capture_output=True,
        text=True,
        check=False,
    )
    return bool(result.stdout.strip())


def git_commit(paths: Iterable[Path], message: str) -> bool:
    expanded = [str(path) for path in paths]
    subprocess.run(["git", "add", "--"] + expanded, check=False)
    status = subprocess.run(
        ["git", "status", "--porcelain", "--"] + expanded,
        capture_output=True,
        text=True,
        check=False,
    )
    if not status.stdout.strip():
        return False
    subprocess.run(["git", "commit", "-m", message], check=False)
    subprocess.run(["git", "push"], check=False)
    return True
