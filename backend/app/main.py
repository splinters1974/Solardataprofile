from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import upload, solar

app = FastAPI(title="Solar Data Profile API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router, prefix="/api")
app.include_router(solar.router, prefix="/api")


@app.get("/")
async def root():
    return {
        "service": "Solar Data Profile API",
        "status": "running",
        "docs": "/docs",
        "health": "/healthz",
        "note": "The web app is at https://splinters1974.github.io/Solardataprofile/",
    }


@app.get("/healthz")
async def healthz():
    return {"status": "ok", "version": "0.1.0"}
