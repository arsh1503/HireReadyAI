from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
import sys
import os

# Ensure the backend directory is in Python's path (fixes Windows import issues)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from routers import interview, analyze, resume

app = FastAPI(
    title="HireReady AI Backend",
    description="AI-powered interview simulation backend",
    version="1.0.0"
)

# Allow React frontend to talk to backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(interview.router, prefix="/interview", tags=["Interview"])
app.include_router(analyze.router, prefix="/analyze", tags=["Analysis"])
app.include_router(resume.router, prefix="/resume", tags=["Resume"])


@app.get("/")
def root():
    return {"status": "HireReady AI backend is running 🚀"}


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
