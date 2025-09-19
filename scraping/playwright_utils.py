from __future__ import annotations

import os
from typing import Dict, Any

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def playwright_context_kwargs() -> Dict[str, Any]:
    """Default context kwargs for Playwright browser contexts."""
    return {
        "user_agent": UA,
        "locale": "en-US",
        "extra_http_headers": {
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
        },
        "bypass_csp": True,
    }


def ensure_pw_cache() -> None:
    """Ensure Playwright downloads re-use a shared cache on CI runners."""
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/playwright-browsers")
