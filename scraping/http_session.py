from __future__ import annotations

import random
import time
from typing import Callable

import requests

from .playwright_utils import UA

RETRYABLE = {403, 429, 500, 502, 503, 504}


def make_session(timeout: int = 30) -> requests.Session:
    """Return a session with consistent headers and resilient retries."""
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": UA,
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        }
    )
    session.request = _wrap_request(session.request, timeout)  # type: ignore[assignment]
    return session


def _wrap_request(orig_request: Callable[..., requests.Response], timeout: int) -> Callable[..., requests.Response]:
    def wrapped(method: str, url: str, **kwargs) -> requests.Response:
        kwargs.setdefault("timeout", timeout)
        tries = kwargs.pop("tries", 4)
        for attempt in range(tries):
            response = orig_request(method, url, **kwargs)
            if response.status_code not in RETRYABLE:
                response.raise_for_status()
                return response
            delay = min(60, 2 ** attempt) + random.random()
            time.sleep(delay)
        response.raise_for_status()
        return response

    return wrapped
