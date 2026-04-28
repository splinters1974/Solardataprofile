from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import upload, solar

app = FastAPI(title="Solar Data Profile API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:4173",
        "https://*.netlify.app",
        "https://*.vercel.app",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router, prefix="/api")
app.include_router(solar.router, prefix="/api")


@app.get("/healthz")
async def healthz():
    return {"status": "ok", "version": "0.1.0"}
