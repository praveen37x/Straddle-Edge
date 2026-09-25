"""
StraddleEDGE High-Performance Live Server
Replicated and Made by Praveen Tripathi
"""
import os
import sys
import time
import logging
import asyncio
from typing import Optional
from fastapi import FastAPI, Request, Response, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("StraddleEDGE")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
INDEX_PATH = os.path.join(STATIC_DIR, "index.html")

REMOTE_BASE = "https://mcwm-straddle.co.in"

# In-memory cache: url -> (timestamp, status_code, content, content_type)
_CACHE = {}
CACHE_TTL = 3.0  # 3 seconds cache for live quotes

app = FastAPI(title="StraddleEDGE — Made by Praveen Tripathi")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount /app and /pwa
app.mount("/app", StaticFiles(directory=os.path.join(STATIC_DIR, "app")), name="app")
app.mount("/pwa", StaticFiles(directory=os.path.join(STATIC_DIR, "pwa")), name="pwa")


@app.get("/manifest.json")
async def manifest():
    return FileResponse(os.path.join(STATIC_DIR, "manifest.json"), media_type="application/manifest+json")


@app.get("/sw.js")
async def service_worker():
    return FileResponse(os.path.join(STATIC_DIR, "sw.js"), media_type="application/javascript")


@app.get("/gesture-engine.js")
async def gesture_engine():
    return FileResponse(os.path.join(STATIC_DIR, "gesture-engine.js"), media_type="application/javascript")


@app.get("/")
@app.get("/edge")
async def serve_index():
    return FileResponse(INDEX_PATH, media_type="text/html")


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
async def proxy_api(path: str, request: Request):
    """
    Transparent low-latency proxy to upstream data source with intelligent caching.
    """
    if request.method == "OPTIONS":
        return Response(status_code=200)

    url = f"{REMOTE_BASE}/api/{path}"
    query_str = str(request.url.query)
    cache_key = f"{request.method}:{path}:{query_str}"
    now = time.time()

    # Check cache for GET requests
    if request.method == "GET" and cache_key in _CACHE:
        cached_time, status, data, ctype = _CACHE[cache_key]
        if now - cached_time < CACHE_TTL:
            return Response(content=data, status_code=status, media_type=ctype)

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
    }

    try:
        req_body = await request.body()
        loop = asyncio.get_event_loop()

        def do_request():
            return requests.request(
                method=request.method,
                url=url,
                params=request.query_params,
                data=req_body if req_body else None,
                headers=headers,
                timeout=6.0
            )

        resp = await loop.run_in_executor(None, do_request)
        content_type = resp.headers.get("content-type", "application/json")
        
        # Save to cache if successful GET
        if request.method == "GET" and resp.status_code == 200:
            _CACHE[cache_key] = (now, resp.status_code, resp.content, content_type)

        return Response(content=resp.content, status_code=resp.status_code, media_type=content_type)

    except Exception as e:
        logger.warning(f"Remote fetch failed for {path}: {e}")
        # If cached copy exists even if expired, return it
        if cache_key in _CACHE:
            _, status, data, ctype = _CACHE[cache_key]
            return Response(content=data, status_code=status, media_type=ctype)

        # Fallback empty or diagnostic JSON
        return JSONResponse({
            "status": "active",
            "message": "StraddleEDGE live backend - Made by Praveen Tripathi",
            "endpoint": path,
            "data": []
        }, status_code=200)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print(f"\n=======================================================")
    print(f"  STRADDLE EDGE - REPLICATED & MADE BY PRAVEEN TRIPATHI")
    print(f"  Live Server: http://localhost:{port}/edge")
    print(f"  Main URL:    http://localhost:{port}/")
    print(f"=======================================================\n")
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False, access_log=False)
