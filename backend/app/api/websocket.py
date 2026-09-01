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

    # A dedicated bounded asyncio queue avoids touching WebSocket/asyncio from
    # PortAudio's processing thread and avoids N-clients producing N broadcasts.
    loop = asyncio.get_running_loop()
    updates: asyncio.Queue[dict] = asyncio.Queue(maxsize=2)

    def sync_broadcast_bridge(telemetry_data: dict):
        def enqueue():
            if updates.full():
                try:
                    updates.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            updates.put_nowait(telemetry_data)
        loop.call_soon_threadsafe(enqueue)

    engine.subscribe(sync_broadcast_bridge)

    try:
        # Send immediate initial telemetry
        await websocket.send_json(engine.get_telemetry())
        while True:
            try:
                update = await asyncio.wait_for(updates.get(), timeout=1.0)
            except asyncio.TimeoutError:
                update = engine.get_telemetry()
            await websocket.send_json(update)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        engine.unsubscribe(sync_broadcast_bridge)
        ws_manager.disconnect(websocket)
