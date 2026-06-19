# exclone-server

Real-time collaborative whiteboard **backend**, built with **NestJS** + **Socket.IO**.

Multiple clients connect over WebSockets, draw objects on a shared canvas, and
see each other's changes instantly. The server holds the canvas state in memory
as the single source of truth and broadcasts every change to all other clients.

Based on [this article](https://medium.com/@adredars/building-a-real-time-collaborative-whiteboard-backend-with-nestjs-and-socket-io-2229f7bf73bd),
with the REST log controller, bootstrap, tests, and a live test client filled in.

## Quick start

```bash
npm install
npm run start:dev      # watch mode, restarts on changes
```

Server runs on `http://localhost:3000` (REST + Socket.IO share the port).

Verify it's up:

```bash
curl http://localhost:3000/health      # {"status":"ok","uptime":...}
```

### Try the live two-client demo

With the server running, in a second terminal:

```bash
node scripts/test-client.js
```

It connects two clients, has client A add/move/remove an object and clear the
canvas, and prints what client B receives — proving the broadcast + sync flow.

## How it works

```
Client A ──emit('object:added')──▶  Server  ──broadcast──▶  Client B, C, ...
                                       │
                                  stores in
                                  in-memory map
                                       │
New client connects ◀──emit('object:sync', all objects)──┘
```

1. Server keeps every whiteboard object in an in-memory map (`objects`), keyed by id.
2. A client emits a change; the server updates its state and re-broadcasts to
   *everyone except the sender* (`client.broadcast.emit`).
3. When a new client connects, the server immediately sends the full current
   state via `object:sync` so it starts in sync.

## WebSocket events

### Client → Server
| Event | Payload | Meaning |
|-------|---------|---------|
| `object:added`    | `{ id, props, ... }` | A new object was drawn |
| `object:modified` | `{ id, props }`      | An object changed (props are merged) |
| `object:removed`  | `{ id }`             | An object was deleted |
| `canvas:clear`    | *(none)*             | The whole canvas was cleared |

### Server → Client
| Event | Payload | Meaning |
|-------|---------|---------|
| `object:sync`     | `{ objects: [...] }` | Full state, sent to a newly connected client |
| `object:added`    | `{ id, props, ... }` | Another client added an object |
| `object:modified` | `{ id, props }`      | Another client modified an object |
| `object:removed`  | `{ id }`             | Another client removed an object |
| `canvas:clear`    | *(none)*             | Another client cleared the canvas |

The `WhiteboardObject` shape is intentionally flexible:

```ts
type WhiteboardObject = {
  id: string;
  props: Record<string, unknown>;   // position, size, color, rotation, text, ...
  [key: string]: unknown;
};
```

## REST endpoints (event log)

| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/`           | Liveness string |
| `GET`    | `/health`     | `{ status, uptime }` |
| `GET`    | `/event-log`  | Last 100 logged events |
| `DELETE` | `/event-log`  | Clear the log buffer |

```bash
curl http://localhost:3000/event-log
```

## Project structure

```
src/
├── app.module.ts                  # wires gateway, services, controllers
├── app.controller.ts              # / and /health
├── app.service.ts
├── main.ts                        # bootstrap (REST CORS enabled)
├── whiteboard/
│   ├── whiteboard.gateway.ts      # ← the heart: Socket.IO event handlers
│   └── whiteboard.gateway.spec.ts # unit tests for add/modify/remove/clear/sync
└── event-log/
    ├── event-log.service.ts       # circular buffer of the last 100 events
    └── event-log.controller.ts    # REST access to logs
scripts/
└── test-client.js                 # live two-client integration demo
```

## Scripts

```bash
npm run start:dev      # dev with watch
npm run build          # compile to dist/
npm run start:prod     # run compiled build
npm test               # unit tests (Jest)
```

## Connecting a frontend

Use the Socket.IO **client** library:

```ts
import { io } from 'socket.io-client';
const socket = io('http://localhost:3000');

socket.on('object:sync', ({ objects }) => loadCanvas(objects));
socket.on('object:added', (obj) => addToCanvas(obj));
socket.on('object:modified', (obj) => updateOnCanvas(obj));
socket.on('object:removed', ({ id }) => removeFromCanvas(id));
socket.on('canvas:clear', () => clearCanvas());

// when the local user draws something:
socket.emit('object:added', { id, props: { /* ... */ } });
```

## Going to production — what's missing on purpose

This is a learning scaffold. Before real use, consider:

- **Persistence**: objects live in memory and vanish on restart. Add a DB (Postgres/Mongo) or Redis.
- **Rooms**: today everyone shares one canvas. Use Socket.IO rooms (`client.join(roomId)`) so multiple boards can coexist, and key `objects` by room.
- **Auth**: CORS is wide open and there's no authentication. Add a WS auth guard / JWT.
- **Scaling**: in-memory state doesn't span instances. Use the Socket.IO Redis adapter + shared store and sticky sessions.
- **Throughput**: batch/throttle rapid draw updates and send deltas instead of full objects.

## License

MIT
