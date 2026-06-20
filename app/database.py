from sqlmodel import SQLModel, Session, create_engine

DATABASE_URL = "sqlite:///./ha_agent.db"

engine = create_engine(DATABASE_URL, echo=False)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    # Lightweight migration for existing SQLite DBs created before architectural thickness support.
    with engine.connect() as conn:
        table_exists = conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='architecturalelement'"
        ).first()
        if table_exists:
            columns = conn.exec_driver_sql("PRAGMA table_info('architecturalelement')").fetchall()
            names = {row[1] for row in columns}
            if "thickness_m" not in names:
                conn.exec_driver_sql(
                    "ALTER TABLE architecturalelement ADD COLUMN thickness_m FLOAT DEFAULT 0.3048"
                )
                conn.commit()


def get_session() -> Session:
    return Session(engine)
