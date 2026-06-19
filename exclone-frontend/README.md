# exclone-frontend

Collaborative whiteboard **frontend** — Next.js + Fabric.js — for the
[`exclone-server`](../exclone-server) backend.

Draw rectangles, circles, text, and freehand strokes on a shared canvas. Every
change is sent over Socket.IO to the backend and broadcast to all other
connected clients, so multiple browser tabs (or people) draw together live.

## Prerequisites

The backend must be running first:

```bash
cd ../exclone-server
npm run start:dev        # http://localhost:3000
```

## Run the frontend

```bash
npm install
npm run dev              # http://localhost:3001
```

Next picks a free port automatically; if 3000 is taken by the backend it will
offer 3001 — accept it. Then **open the URL in two browser tabs** and draw in
one: the shapes appear in the other instantly.

By default it connects to `http://localhost:3000`. To point elsewhere, copy
`.env.local.example` to `.env.local` and set `NEXT_PUBLIC_SERVER_URL`.

## How sync works

The frontend speaks the backend's exact event contract, where every message is
`{ id, props }` (`props` is a Fabric object serialization):

| User action | Emits to server | Other tabs receive |
|-------------|-----------------|--------------------|
| Add shape / text | `object:added` | `object:added` |
| Draw a freehand stroke | `object:added` | `object:added` |
| Move / scale / rotate | `object:modified` | `object:modified` |
| Edit text | `object:modified` | `object:modified` |
| Delete selected | `object:removed` | `object:removed` |
| Clear canvas | `canvas:clear` | `canvas:clear` |
| **Open a new tab** | — | `object:sync` (full current canvas) |

### The echo-loop guard

When a change arrives *from* the server and we apply it to our canvas, Fabric
would normally fire its own local events — which would send the change right
back out, looping forever. An `applyingRemote` ref flag wraps every
server-driven update so those local events are ignored while remote changes are
being applied. Local user actions emit explicitly (not via generic canvas
listeners), which keeps the two directions cleanly separated.

## Controls

- **Select / move** — pick, drag, scale, rotate objects. `Delete`/`Backspace` removes the selection.
- **Free draw** — pencil strokes in the current color.
- **Rectangle / Circle / Text** — drop a shape in the center (text is double-click to edit).
- **Color** — sets the fill/stroke for new shapes and the pen.
- **Delete / Clear** — remove the selection, or wipe the whole board for everyone.

The "Live / Offline" dot in the top bar reflects the Socket.IO connection.

## Project structure

```
app/
├── layout.tsx          # root layout + metadata
├── page.tsx            # loads Whiteboard client-only (ssr: false)
└── globals.css         # drafting-table theme
components/
└── Whiteboard.tsx      # ← Fabric canvas + Socket.IO sync (the whole app)
```

Fabric is loaded with `dynamic(..., { ssr: false })` and imported inside an
effect because it needs `window`/`document`, which don't exist during
server rendering.

## Stack

- Next.js 14 (App Router)
- Fabric.js 6
- socket.io-client 4
