import json
import asyncio
from fastapi import WebSocket, WebSocketDisconnect


class WebSocketManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast_json(self, data: dict):
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_json(data)
            except Exception:
                dead_connections.append(connection)
        
        for dead in dead_connections:
            self.disconnect(dead)


ws_manager = WebSocketManager()


async def websocket_monitor_endpoint(websocket: WebSocket, engine):
    await ws_manager.connect(websocket)

    # Bridge engine sync broadcast to async websocket manager
    loop = asyncio.get_event_loop()

    def sync_broadcast_bridge(telemetry_data: dict):
        asyncio.run_coroutine_threadsafe(ws_manager.broadcast_json(telemetry_data), loop)

    engine.subscribe(sync_broadcast_bridge)

    try:
        # Send immediate initial telemetry
        await websocket.send_json(engine.get_telemetry())
        while True:
            # Keep socket open and receive any client-side commands if sent
            data = await websocket.receive_text()
            try:
                cmd = json.loads(data)
                if cmd.get("action") == "start":
                    engine.start()
                elif cmd.get("action") == "stop":
                    engine.stop()
            except Exception:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        engine.unsubscribe(sync_broadcast_bridge)
        ws_manager.disconnect(websocket)
