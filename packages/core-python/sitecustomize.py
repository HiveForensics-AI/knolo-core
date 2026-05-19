from __future__ import annotations

import os
import site
import sys
from pathlib import Path


def _bootstrap_local_user_site() -> None:
    root = Path(__file__).resolve().parent
    user_base = root / ".python-user-base"
    user_site = user_base / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages"
    user_site.mkdir(parents=True, exist_ok=True)

    site.USER_BASE = str(user_base)
    site.USER_SITE = str(user_site)
    os.environ["PYTHONUSERBASE"] = str(user_base)

    if str(user_site) not in sys.path:
        sys.path.append(str(user_site))


_bootstrap_local_user_site()

