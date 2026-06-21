from sqlmodel import SQLModel, Session, create_engine

DATABASE_URL = "sqlite:///./ha_agent.db"

engine = create_engine(DATABASE_URL, echo=False)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    # Lightweight migration for existing SQLite DBs.
    with engine.connect() as conn:
        # Ensure floor table exists
        floor_exists = conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='floor'"
        ).first()
        if not floor_exists:
            conn.exec_driver_sql(
                "CREATE TABLE IF NOT EXISTS floor (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR UNIQUE NOT NULL, level INTEGER NOT NULL DEFAULT 1)"
            )
            conn.commit()

        # Ensure room has floor_id column
        room_cols = conn.exec_driver_sql("PRAGMA table_info('room')").fetchall()
        room_col_names = {row[1] for row in room_cols}
        if "floor_id" not in room_col_names:
            conn.exec_driver_sql(
                "ALTER TABLE room ADD COLUMN floor_id INTEGER REFERENCES floor(id)"
            )
            conn.commit()

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
            # Migrate orientation column to rotation_degrees
            if "orientation" in names and "rotation_degrees" not in names:
                conn.exec_driver_sql(
                    "ALTER TABLE architecturalelement ADD COLUMN rotation_degrees FLOAT DEFAULT 0.0"
                )
                conn.commit()
                # Convert orientation values to rotation_degrees
                conn.exec_driver_sql(
                    "UPDATE architecturalelement SET rotation_degrees = CASE WHEN orientation = 'horizontal' THEN 90.0 ELSE 0.0 END"
                )
                conn.commit()
                # Note: SQLite doesn't support DROP COLUMN before 3.35.0, so we leave the old column
            elif "orientation" not in names and "rotation_degrees" not in names:
                conn.exec_driver_sql(
                    "ALTER TABLE architecturalelement ADD COLUMN rotation_degrees FLOAT DEFAULT 0.0"
                )
                conn.commit()


def get_session() -> Session:
    return Session(engine)
