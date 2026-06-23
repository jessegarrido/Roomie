import logging
import os


def configure_logging() -> None:
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    fmt = os.getenv(
        "LOG_FORMAT",
        "%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )

    logging.basicConfig(level=level, format=fmt, force=True)
