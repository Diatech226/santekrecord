import os
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config.settings import load_config
from .audio.engine import MainAudioEngine
from .api.routes import router as api_router
from .api.websocket import websocket_monitor_endpoint

# Initialize global audio engine
app_config = load_config()
recordings_dir = os.environ.get("RECORDINGS_DIR", "recordings")
os.makedirs(recordings_dir, exist_ok=True)

audio_engine = MainAudioEngine(config=app_config, recordings_dir=recordings_dir)

app = FastAPI(
    title="Auto Voice Recorder Backend",
    description="Minimalist automated voice-activated audio recorder for Kali Linux with RMS and Silero VAD detection.",
    version="1.0.0",
)

# CORS middleware for local frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include REST routes
app.include_router(api_router)


# WebSocket endpoint for real-time monitoring
@app.websocket("/ws/monitor")
async def ws_monitor(websocket: WebSocket):
    await websocket_monitor_endpoint(websocket, audio_engine)


@app.on_event("shutdown")
def on_shutdown():
    print("[Main] Shutting down audio engine...")
    audio_engine.stop()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, reload=True)
