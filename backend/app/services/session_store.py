"""
Session storage that outlives a process restart.

Uploads used to live in a bare dict, so any restart lost them and the user
got "session not found" with no way back except re-uploading by hand. This
writes each session to disk instead, with a small in-memory cache in front.

A caveat worth knowing: on Render's free tier the filesystem is ephemeral,
so this survives a worker restart but not necessarily a full spin-down. The
frontend therefore also keeps the uploaded file and silently re-uploads when
a session has genuinely gone. Point SESSION_STORE_DIR at a mounted disk (or
swap the backend for Redis) and the server side becomes durable too.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

STORE_DIR = Path(
    os.environ.get("SESSION_STORE_DIR", Path(tempfile.gettempdir()) / "sdp-sessions")
)
TTL_SECONDS = int(os.environ.get("SESSION_TTL_SECONDS", 24 * 60 * 60))
MEMORY_CACHE_SIZE = int(os.environ.get("SESSION_CACHE_SIZE", 16))


@dataclass
class Session:
    consumption: pd.DataFrame
    filename: str = ""
    site_name: str = ""
    warnings: list[str] = field(default_factory=list)
    detected_format: str = ""
    # The last sizing request, as a plain dict so it survives a round trip to
    # disk without dragging pydantic or dataclass types through JSON.
    last_request: Optional[dict[str, Any]] = None
    # Cached in memory only; recomputed from consumption + last_request when a
    # restart has dropped it.
    last_result: Optional[dict[str, Any]] = None


class SessionStore:
    def __init__(self, root: Path = STORE_DIR, ttl: int = TTL_SECONDS):
        self.root = root
        self.ttl = ttl
        self._cache: OrderedDict[str, Session] = OrderedDict()
        try:
            self.root.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            log.warning("Session dir %s unavailable (%s); memory only.", self.root, e)

    # --- disk layout ------------------------------------------------------
    def _dir(self, session_id: str) -> Path:
        # Session ids are server-generated UUIDs, but never build a path from
        # caller input without checking it cannot escape the store.
        safe = "".join(c for c in session_id if c.isalnum() or c in "-_")
        if not safe or safe != session_id:
            raise KeyError(session_id)
        return self.root / safe

    def _remember(self, session_id: str, session: Session) -> None:
        self._cache[session_id] = session
        self._cache.move_to_end(session_id)
        while len(self._cache) > MEMORY_CACHE_SIZE:
            self._cache.popitem(last=False)

    # --- writing ----------------------------------------------------------
    def save(self, session_id: str, session: Session) -> None:
        self._remember(session_id, session)
        try:
            path = self._dir(session_id)
            path.mkdir(parents=True, exist_ok=True)
            np.savez_compressed(
                path / "consumption.npz",
                values=session.consumption.to_numpy(dtype=float),
                index=session.consumption.index.to_numpy().astype("datetime64[ns]"),
            )
            (path / "meta.json").write_text(json.dumps({
                "filename": session.filename,
                "site_name": session.site_name,
                "warnings": session.warnings,
                "detected_format": session.detected_format,
                "last_request": session.last_request,
                "saved_at": time.time(),
            }))
        except (OSError, ValueError) as e:
            # Losing the disk copy degrades durability; it must not fail the
            # request the user is waiting on.
            log.warning("Could not persist session %s: %s", session_id, e)

    def touch(self, session_id: str, session: Session) -> None:
        """Re-save after mutating site name, last request or last result."""
        self.save(session_id, session)

    # --- reading ----------------------------------------------------------
    def get(self, session_id: str) -> Optional[Session]:
        cached = self._cache.get(session_id)
        if cached is not None:
            self._cache.move_to_end(session_id)
            return cached

        try:
            path = self._dir(session_id)
        except KeyError:
            return None
        if not (path / "meta.json").exists():
            return None

        try:
            meta = json.loads((path / "meta.json").read_text())
            if time.time() - meta.get("saved_at", 0) > self.ttl:
                self.delete(session_id)
                return None

            with np.load(path / "consumption.npz", allow_pickle=False) as data:
                frame = pd.DataFrame(
                    data["values"],
                    index=pd.DatetimeIndex(data["index"]),
                    columns=list(range(data["values"].shape[1])),
                )
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as e:
            log.warning("Could not read session %s: %s", session_id, e)
            return None

        session = Session(
            consumption=frame,
            filename=meta.get("filename", ""),
            site_name=meta.get("site_name", ""),
            warnings=meta.get("warnings", []),
            detected_format=meta.get("detected_format", ""),
            last_request=meta.get("last_request"),
        )
        self._remember(session_id, session)
        return session

    # --- housekeeping -----------------------------------------------------
    def delete(self, session_id: str) -> None:
        self._cache.pop(session_id, None)
        try:
            shutil.rmtree(self._dir(session_id), ignore_errors=True)
        except KeyError:
            pass

    def purge_expired(self) -> int:
        """Drop sessions past their TTL. Cheap, so it runs on each upload."""
        removed = 0
        if not self.root.exists():
            return 0
        cutoff = time.time() - self.ttl
        try:
            entries = list(self.root.iterdir())
        except OSError:
            return 0
        for entry in entries:
            meta = entry / "meta.json"
            try:
                if not meta.exists() or meta.stat().st_mtime < cutoff:
                    shutil.rmtree(entry, ignore_errors=True)
                    self._cache.pop(entry.name, None)
                    removed += 1
            except OSError:
                continue
        return removed


SESSION_STORE = SessionStore()
