# Docker

Build from the repository root so the image can include both `api/` and `csv/`:

```sh
docker build -f docker/Dockerfile -t yt-tech-shorts-api .
```

Create the data volume:

```sh
docker volume create yt-tech-shorts-api-data
```

Run ingestion first. This creates `/app/data/app.db` inside the named volume:

```sh
docker run --rm --env-file api/.env -v yt-tech-shorts-api-data:/app/data yt-tech-shorts-api python api/ingest_youtube_shorts.py
```

Run the API with the same volume so FastAPI can serve the ingested data:

```sh
docker run --rm -p 8000:8000 -v yt-tech-shorts-api-data:/app/data yt-tech-shorts-api
```
