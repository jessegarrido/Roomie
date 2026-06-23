from pathlib import Path

import pytest
from sqlmodel import SQLModel, create_engine

from app import database


@pytest.fixture(autouse=True)
def isolate_test_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_path = tmp_path / "test.db"
    test_engine = create_engine(
        f"sqlite:///{db_path}",
        echo=False,
        connect_args={"check_same_thread": False},
    )

    monkeypatch.setattr(database, "engine", test_engine)
    SQLModel.metadata.create_all(test_engine)
