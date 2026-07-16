import sqlite3
from pathlib import Path
from typing_extensions import Annotated

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware


DB_PATH = Path(__file__).resolve().parent / "app.db"

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/api/v1/videos")
@app.get("/get-videos")
def get_videos(
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    after: Annotated[int, Query(ge=0)] = 0,
):
    if not DB_PATH.exists():
        return {"data": [], "nextCursor": None, "hasMore": False}

    with sqlite3.connect(DB_PATH) as db:
        rows = db.execute("""
            SELECT video_id
            FROM videos
            ORDER BY published_at DESC
            LIMIT ? OFFSET ?
        """, (limit + 1, after)).fetchall()

    ids = [row[0] for row in rows[:limit]]
    has_more = len(rows) > limit
    return {
        "data": ids,
        "nextCursor": after + limit if has_more else None,
        "hasMore": has_more,
    }
