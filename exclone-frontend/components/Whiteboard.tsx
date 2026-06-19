'use client';

import { useEffect, useRef, useState } from 'react';

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';

// Each whiteboard message matches the backend contract: { id, props }.
// `props` is a Fabric object serialization; `id` is kept at the top level.
type Msg = { id: string; props: Record<string, unknown> };

type Tool = 'select' | 'rect' | 'circle' | 'text' | 'draw';

const genId = () =>
  `obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export default function Whiteboard() {
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<any>(null); // the fabric module
  const canvasRef = useRef<any>(null); // the fabric.Canvas instance
  const socketRef = useRef<any>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // When we're applying a change that came FROM the server, this guard stops
  // us from echoing it straight back out and causing an infinite loop.
  const applyingRemote = useRef(false);

  const [connected, setConnected] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState('#2f6bff');

  // keep latest color/tool readable inside long-lived event handlers
  const colorRef = useRef(color);
  const toolRef = useRef(tool);
  useEffect(() => {
    colorRef.current = color;
  }, [color]);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  // ---- helpers that talk to the server ----
  const serialize = (obj: any): Msg => ({
    id: obj.id,
    props: obj.toObject(),
  });

  const emit = (event: string, payload?: unknown) => {
    socketRef.current?.emit(event, payload);
  };

  // ---- one-time setup: canvas + socket ----
  useEffect(() => {
    let disposed = false;

    (async () => {
      const fabric = await import('fabric');
      const { io } = await import('socket.io-client');
      if (disposed) return;

      fabricRef.current = fabric;

      const surface = surfaceRef.current!;
      const canvas = new fabric.Canvas(canvasElRef.current!, {
        width: surface.clientWidth,
        height: surface.clientHeight,
        backgroundColor: 'transparent',
        preserveObjectStacking: true,
      });
      canvasRef.current = canvas;

      // keep the fabric canvas the same size as its container
      const resize = () => {
        canvas.setDimensions({
          width: surface.clientWidth,
          height: surface.clientHeight,
        });
        canvas.requestRenderAll();
      };
      window.addEventListener('resize', resize);

      // ---------- LOCAL → SERVER ----------

      // Freehand strokes arrive as a finished path. Tag + broadcast it.
      canvas.on('path:created', (e: any) => {
        const path = e.path;
        path.id = genId();
        emit('object:added', serialize(path));
      });

      // Fires after a user finishes moving / scaling / rotating an object.
      canvas.on('object:modified', (e: any) => {
        if (applyingRemote.current) return;
        const obj = e.target;
        if (!obj?.id) return;
        emit('object:modified', serialize(obj));
      });

      // Text edits: broadcast the new content when editing ends.
      canvas.on('text:editing:exited', (e: any) => {
        const obj = e.target;
        if (!obj?.id) return;
        emit('object:modified', serialize(obj));
      });

      // ---------- SERVER → LOCAL ----------
      const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
      socketRef.current = socket;

      socket.on('connect', () => setConnected(true));
      socket.on('disconnect', () => setConnected(false));

      // Full state for a freshly connected client.
      socket.on('object:sync', async ({ objects }: { objects: Msg[] }) => {
        applyingRemote.current = true;
        canvas.clear();
        for (const { id, props } of objects) {
          const [obj] = await fabric.util.enlivenObjects([props as any]);
          (obj as any).id = id;
          canvas.add(obj as any);
        }
        canvas.requestRenderAll();
        applyingRemote.current = false;
      });

      socket.on('object:added', async ({ id, props }: Msg) => {
        applyingRemote.current = true;
        const [obj] = await fabric.util.enlivenObjects([props as any]);
        (obj as any).id = id;
        canvas.add(obj as any);
        canvas.requestRenderAll();
        applyingRemote.current = false;
      });

      socket.on('object:modified', ({ id, props }: Msg) => {
        const target = canvas
          .getObjects()
          .find((o: any) => o.id === id);
        if (!target) return;
        applyingRemote.current = true;
        target.set(props as any);
        target.setCoords();
        canvas.requestRenderAll();
        applyingRemote.current = false;
      });

      socket.on('object:removed', ({ id }: Msg) => {
        const target = canvas
          .getObjects()
          .find((o: any) => o.id === id);
        if (!target) return;
        applyingRemote.current = true;
        canvas.remove(target);
        canvas.requestRenderAll();
        applyingRemote.current = false;
      });

      socket.on('canvas:clear', () => {
        applyingRemote.current = true;
        canvas.clear();
        canvas.requestRenderAll();
        applyingRemote.current = false;
      });

      // cleanup
      return () => {
        window.removeEventListener('resize', resize);
      };
    })();

    return () => {
      disposed = true;
      socketRef.current?.disconnect();
      canvasRef.current?.dispose();
      socketRef.current = null;
      canvasRef.current = null;
    };
  }, []);

  // ---- toggle free-draw mode when the tool changes ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    if (!canvas || !fabric) return;

    if (tool === 'draw') {
      canvas.isDrawingMode = true;
      const brush = new fabric.PencilBrush(canvas);
      brush.color = color;
      brush.width = 3;
      canvas.freeDrawingBrush = brush;
    } else {
      canvas.isDrawingMode = false;
    }
    canvas.selection = tool === 'select';
  }, [tool, color]);

  // ---- toolbar actions ----
  const addShape = (kind: 'rect' | 'circle' | 'text') => {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    if (!canvas || !fabric) return;

    const cx = canvas.getWidth() / 2;
    const cy = canvas.getHeight() / 2;
    let obj: any;

    if (kind === 'rect') {
      obj = new fabric.Rect({
        left: cx - 60,
        top: cy - 40,
        width: 120,
        height: 80,
        fill: colorRef.current,
        rx: 6,
        ry: 6,
      });
    } else if (kind === 'circle') {
      obj = new fabric.Circle({
        left: cx - 45,
        top: cy - 45,
        radius: 45,
        fill: colorRef.current,
      });
    } else {
      obj = new fabric.IText('Double-click to edit', {
        left: cx - 90,
        top: cy - 14,
        fontSize: 22,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fill: colorRef.current,
      });
    }

    obj.id = genId();
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
    emit('object:added', serialize(obj));
    setTool('select');
  };

  const deleteSelected = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    active.forEach((obj: any) => {
      canvas.remove(obj);
      emit('object:removed', { id: obj.id });
    });
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.clear();
    canvas.requestRenderAll();
    emit('canvas:clear');
  };

  // delete key support
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && tool === 'select') {
        const el = document.activeElement;
        // don't hijack delete while editing text
        if (el && (el as HTMLElement).isContentEditable) return;
        const canvas = canvasRef.current;
        if (canvas?.getActiveObjects()?.length) {
          e.preventDefault();
          deleteSelected();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool]);

  const Btn = ({
    id,
    label,
    onClick,
    children,
    danger,
  }: {
    id?: Tool;
    label: string;
    onClick: () => void;
    children: React.ReactNode;
    danger?: boolean;
  }) => (
    <button
      className={`tool${id && tool === id ? ' active' : ''}${
        danger ? ' danger' : ''
      }`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark">
          ex<span>clone</span>
        </div>
        <div className="tagline">shared canvas · draw together</div>
        <div className="status">
          <span className={`dot${connected ? ' live' : ''}`} />
          {connected ? 'Live' : 'Offline'}
        </div>
      </header>

      <div className="workspace">
        <nav className="rail">
          <Btn id="select" label="Select / move" onClick={() => setTool('select')}>
            <CursorIcon />
          </Btn>
          <Btn id="draw" label="Free draw" onClick={() => setTool('draw')}>
            <PenIcon />
          </Btn>
          <div className="rail-sep" />
          <Btn label="Add rectangle" onClick={() => addShape('rect')}>
            <RectIcon />
          </Btn>
          <Btn label="Add circle" onClick={() => addShape('circle')}>
            <CircleIcon />
          </Btn>
          <Btn label="Add text" onClick={() => addShape('text')}>
            <TextIcon />
          </Btn>
          <div className="rail-sep" />
          <input
            className="swatch"
            type="color"
            value={color}
            title="Color"
            aria-label="Color"
            onChange={(e) => setColor(e.target.value)}
          />
          <div className="rail-sep" />
          <Btn label="Delete selected" onClick={deleteSelected} danger>
            <TrashIcon />
          </Btn>
          <Btn label="Clear canvas" onClick={clearCanvas} danger>
            <ClearIcon />
          </Btn>
        </nav>

        <div className="surface" ref={surfaceRef}>
          <canvas ref={canvasElRef} />
          <div className="hint">
            Open this page in a second tab to see changes sync in real time
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- minimal inline icons (no icon dependency) ---- */
const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 };
const CursorIcon = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <path d="M5 3l6 16 2-7 7-2z" strokeLinejoin="round" />
  </svg>
);
const PenIcon = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <path d="M4 20l4-1 11-11-3-3L5 16z" strokeLinejoin="round" />
  </svg>
);
const RectIcon = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <rect x="4" y="6" width="16" height="12" rx="2" />
  </svg>
);
const CircleIcon = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <circle cx="12" cy="12" r="7" />
  </svg>
);
const TextIcon = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <path d="M6 6h12M12 6v12" strokeLinecap="round" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12" strokeLinejoin="round" />
  </svg>
);
const ClearIcon = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <path d="M5 5l14 14M19 5L5 19" strokeLinecap="round" />
  </svg>
);
