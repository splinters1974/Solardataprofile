from dataclasses import dataclass, field
from typing import Any, Optional

import pandas as pd


@dataclass
class Session:
    """
    Everything one upload knows about itself.

    In-memory only, so it does not survive a restart. On Render's free tier
    the instance sleeps after ~15 minutes idle and takes every session with
    it, which is why users see "session not found" after a break. Swap this
    for Redis or a temp-file store before putting it in front of clients.
    """

    consumption: pd.DataFrame
    filename: str = ""
    site_name: str = ""
    warnings: list[str] = field(default_factory=list)
    last_result: Optional[dict[str, Any]] = None
    last_request: Optional[Any] = None


SESSION_STORE: dict[str, Session] = {}
