'use client';

import { useEffect, useRef, useState } from 'react';

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';

// Backend contract: every message is { id, props } where props is a Fabric
// object serialization and id is kept at the top level.
type Msg = { id: string; props: Record<string, unknown> };

type Tool = 'select' | 'pen' | 'highlighter' | 'eraser';

// An undoable operation. We invert these locally and rebroadcast so other
// clients stay in sync, but only ever for *our own* actions.
type Op =
  | { type: 'add'; id: string; after: Record<string, unknown> }
  | { type: 'remove'; id: string; before: Record<string, unknown> }
  | {
      type: 'modify';
      id: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };

const PENS = ['#1f2937', '#ef4444', '#2f6bff', '#22a06b', '#f59e0b', '#8b5cf6'];
const HIGHLIGHT = 'rgba(253, 224, 71, 0.45)';

const genId = () =>
  `obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export default function Whiteboard() {
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const fabricRef = useRef<any>(null);
  const canvasRef = useRef<any>(null);
  const socketRef = useRef<any>(null);

  const applyingRemote = useRef(false);
  const erasing = useRef(false);
  // last-known serialization per object id, used to compute "before" on modify
  const lastProps = useRef<Record<string, Record<string, unknown>>>({});
  const undoStack = useRef<Op[]>([]);
  const redoStack = useRef<Op[]>([]);
  const actions = useRef<any>({});

  const [connected, setConnected] = useState(false);
  const [tool, setTool] = useState<Tool>('pen');
  const [penColor, setPenColor] = useState(PENS[0]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const toolRef = useRef(tool);
  const colorRef = useRef(penColor);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    colorRef.current = penColor;
  }, [penColor]);

  // a stable, lightweight identity for the presence chip ("you")
  const [me] = useState(() => {
    const names = ['Otter', 'Comet', 'Maple', 'Pixel', 'Cobalt', 'Wren', 'Juno'];
    const colors = ['#2f6bff', '#22a06b', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899'];
    const name = names[Math.floor(Math.random() * names.length)];
    const color = colors[Math.floor(Math.random() * colors.length)];
    return { name: `${name} ${Math.floor(1000 + Math.random() * 9000)}`, color };
  });

  const emit = (event: string, payload?: unknown) =>
    socketRef.current?.emit(event, payload);

  const refreshHistory = () => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  };
  const pushUndo = (op: Op) => {
    undoStack.current.push(op);
    redoStack.current = [];
    refreshHistory();
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

      const resize = () => {
        canvas.setDimensions({
          width: surface.clientWidth,
          height: surface.clientHeight,
        });
        canvas.requestRenderAll();
      };
      window.addEventListener('resize', resize);

      // ---------- LOCAL → SERVER ----------
      canvas.on('path:created', (e: any) => {
        if (applyingRemote.current) return;
        const path = e.path;
        path.id = genId();
        const props = path.toObject();
        emit('object:added', { id: path.id, props });
        lastProps.current[path.id] = props;
        pushUndo({ type: 'add', id: path.id, after: props });
      });

      canvas.on('object:modified', (e: any) => {
        if (applyingRemote.current) return;
        const obj = e.target;
        if (!obj?.id) return;
        const before = lastProps.current[obj.id];
        const after = obj.toObject();
        emit('object:modified', { id: obj.id, props: after });
        lastProps.current[obj.id] = after;
        if (before) pushUndo({ type: 'modify', id: obj.id, before, after });
      });

      canvas.on('text:editing:exited', (e: any) => {
        const obj = e.target;
        if (!obj?.id) return;
        const before = lastProps.current[obj.id];
        const after = obj.toObject();
        emit('object:modified', { id: obj.id, props: after });
        lastProps.current[obj.id] = after;
        if (before) pushUndo({ type: 'modify', id: obj.id, before, after });
      });

      // drag-to-erase whole objects (syncs as object:removed)
      const eraseUnder = (target: any) => {
        if (!target?.id) return;
        const before = target.toObject();
        canvas.remove(target);
        emit('object:removed', { id: target.id });
        delete lastProps.current[target.id];
        pushUndo({ type: 'remove', id: target.id, before });
        canvas.requestRenderAll();
      };
      canvas.on('mouse:down', (opt: any) => {
        if (toolRef.current !== 'eraser') return;
        erasing.current = true;
        if (opt.target) eraseUnder(opt.target);
      });
      canvas.on('mouse:move', (opt: any) => {
        if (toolRef.current !== 'eraser' || !erasing.current) return;
        if (opt.target) eraseUnder(opt.target);
      });
      canvas.on('mouse:up', () => {
        erasing.current = false;
      });

      // ---------- SERVER → LOCAL ----------
      const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
      socketRef.current = socket;
      socket.on('connect', () => setConnected(true));
      socket.on('disconnect', () => setConnected(false));

      socket.on('object:sync', async ({ objects }: { objects: Msg[] }) => {
        applyingRemote.current = true;
        canvas.clear();
        lastProps.current = {};
        for (const { id, props } of objects) {
          const [obj] = await fabric.util.enlivenObjects([props as any]);
          (obj as any).id = id;
          canvas.add(obj as any);
          lastProps.current[id] = props;
        }
        canvas.requestRenderAll();
        applyingRemote.current = false;
      });

      socket.on('object:added', async ({ id, props }: Msg) => {
        applyingRemote.current = true;
        const [obj] = await fabric.util.enlivenObjects([props as any]);
        (obj as any).id = id;
        canvas.add(obj as any);
        lastProps.current[id] = props;
        canvas.requestRenderAll();
        applyingRemote.current = false;
      });

      socket.on('object:modified', ({ id, props }: Msg) => {
        const target = canvas.getObjects().find((o: any) => o.id === id);
        if (!target) return;
        applyingRemote.current = true;
        target.set(props as any);
        target.setCoords();
        lastProps.current[id] = props;
        canvas.requestRenderAll();
        applyingRemote.current = false;
      });

      socket.on('object:removed', ({ id }: Msg) => {
        const target = canvas.getObjects().find((o: any) => o.id === id);
        if (!target) return;
        applyingRemote.current = true;
        canvas.remove(target);
        delete lastProps.current[id];
        canvas.requestRenderAll();
        applyingRemote.current = false;
      });

      socket.on('canvas:clear', () => {
        applyingRemote.current = true;
        canvas.clear();
        lastProps.current = {};
        canvas.requestRenderAll();
        applyingRemote.current = false;
      });

      return () => window.removeEventListener('resize', resize);
    })();

    return () => {
      disposed = true;
      socketRef.current?.disconnect();
      canvasRef.current?.dispose();
      socketRef.current = null;
      canvasRef.current = null;
    };
  }, []);

  // ---- apply the active tool to the canvas ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    if (!canvas || !fabric) return;

    canvas.isDrawingMode = false;
    canvas.selection = tool === 'select';
    if (tool !== 'select') canvas.discardActiveObject();
    canvas.defaultCursor = tool === 'eraser' ? 'cell' : 'default';

    if (tool === 'pen') {
      canvas.isDrawingMode = true;
      const brush = new fabric.PencilBrush(canvas);
      brush.color = penColor;
      brush.width = 3;
      canvas.freeDrawingBrush = brush;
    } else if (tool === 'highlighter') {
      canvas.isDrawingMode = true;
      const brush = new fabric.PencilBrush(canvas);
      brush.color = HIGHLIGHT;
      brush.width = 22;
      brush.strokeLineCap = 'round';
      canvas.freeDrawingBrush = brush;
    }
    canvas.requestRenderAll();
  }, [tool, penColor]);

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
        fill: 'transparent',
        stroke: colorRef.current,
        strokeWidth: 2.5,
        rx: 6,
        ry: 6,
      });
    } else if (kind === 'circle') {
      obj = new fabric.Circle({
        left: cx - 45,
        top: cy - 45,
        radius: 45,
        fill: 'transparent',
        stroke: colorRef.current,
        strokeWidth: 2.5,
      });
    } else {
      obj = new fabric.IText('Text', {
        left: cx - 20,
        top: cy - 14,
        fontSize: 24,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fill: colorRef.current,
      });
    }
    obj.id = genId();
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
    const props = obj.toObject();
    emit('object:added', { id: obj.id, props });
    lastProps.current[obj.id] = props;
    pushUndo({ type: 'add', id: obj.id, after: props });
    setTool('select');
  };

  const deleteSelected = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    active.forEach((obj: any) => {
      const before = obj.toObject();
      canvas.remove(obj);
      emit('object:removed', { id: obj.id });
      delete lastProps.current[obj.id];
      pushUndo({ type: 'remove', id: obj.id, before });
    });
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.clear();
    lastProps.current = {};
    undoStack.current = [];
    redoStack.current = [];
    refreshHistory();
    canvas.requestRenderAll();
    emit('canvas:clear');
    setSettingsOpen(false);
  };

  const undo = async () => {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    const op = undoStack.current.pop();
    if (!op || !canvas) {
      refreshHistory();
      return;
    }
    if (op.type === 'add') {
      const obj = canvas.getObjects().find((o: any) => o.id === op.id);
      if (obj) canvas.remove(obj);
      emit('object:removed', { id: op.id });
      delete lastProps.current[op.id];
    } else if (op.type === 'remove') {
      const [obj] = await fabric.util.enlivenObjects([op.before]);
      (obj as any).id = op.id;
      canvas.add(obj);
      emit('object:added', { id: op.id, props: op.before });
      lastProps.current[op.id] = op.before;
    } else {
      const obj = canvas.getObjects().find((o: any) => o.id === op.id);
      if (obj) {
        obj.set(op.before);
        obj.setCoords();
      }
      emit('object:modified', { id: op.id, props: op.before });
      lastProps.current[op.id] = op.before;
    }
    redoStack.current.push(op);
    canvas.requestRenderAll();
    refreshHistory();
  };

  const redo = async () => {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    const op = redoStack.current.pop();
    if (!op || !canvas) {
      refreshHistory();
      return;
    }
    if (op.type === 'add') {
      const [obj] = await fabric.util.enlivenObjects([op.after]);
      (obj as any).id = op.id;
      canvas.add(obj);
      emit('object:added', { id: op.id, props: op.after });
      lastProps.current[op.id] = op.after;
    } else if (op.type === 'remove') {
      const obj = canvas.getObjects().find((o: any) => o.id === op.id);
      if (obj) canvas.remove(obj);
      emit('object:removed', { id: op.id });
      delete lastProps.current[op.id];
    } else {
      const obj = canvas.getObjects().find((o: any) => o.id === op.id);
      if (obj) {
        obj.set(op.after);
        obj.setCoords();
      }
      emit('object:modified', { id: op.id, props: op.after });
      lastProps.current[op.id] = op.after;
    }
    undoStack.current.push(op);
    canvas.requestRenderAll();
    refreshHistory();
  };

  // keep latest action closures reachable from the keydown listener
  useEffect(() => {
    actions.current = { undo, redo, deleteSelected };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el?.isContentEditable) return; // don't hijack while editing text
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) actions.current.redo();
        else actions.current.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        actions.current.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (canvasRef.current?.getActiveObjects()?.length) {
          e.preventDefault();
          actions.current.deleteSelected();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          ex<b>clone</b>
          <span className="brand-sub">shared board</span>
        </div>

        <div className="spacer" />

        <div className="presence" title="That's you">
          <span className="avatar" style={{ background: me.color }}>
            {me.name[0]}
          </span>
          <span className="who">{me.name}</span>
          <span className={`live-dot${connected ? ' on' : ''}`} title={connected ? 'Connected' : 'Offline'} />
        </div>

        <div className="settings-wrap">
          <button
            className="icon-btn"
            title="Settings"
            aria-label="Settings"
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <GearIcon />
          </button>
          {settingsOpen && (
            <>
              <div className="backdrop" onClick={() => setSettingsOpen(false)} />
              <div className="menu" role="menu">
                <button
                  className="menu-item"
                  onClick={() => {
                    setShowGrid((v) => !v);
                    setSettingsOpen(false);
                  }}
                >
                  {showGrid ? 'Hide grid' : 'Show grid'}
                </button>
                <button className="menu-item danger" onClick={clearCanvas}>
                  Clear board for everyone
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="stage">
        <div className={`surface${showGrid ? ' grid' : ''}`} ref={surfaceRef}>
          <canvas ref={canvasElRef} />
        </div>

        <div className="toolbar">
          <button
            className={`tool${tool === 'select' ? ' active' : ''}`}
            title="Select / move"
            aria-label="Select"
            onClick={() => setTool('select')}
          >
            <CursorIcon />
          </button>

          <span className="divider" />

          {PENS.map((c) => {
            const active = tool === 'pen' && penColor === c;
            return (
              <button
                key={c}
                className={`pen${active ? ' active' : ''}`}
                title="Pen"
                aria-label={`Pen ${c}`}
                onClick={() => {
                  setPenColor(c);
                  setTool('pen');
                }}
              >
                <Pencil color={c} />
              </button>
            );
          })}

          <button
            className={`tool${tool === 'highlighter' ? ' active' : ''}`}
            title="Highlighter"
            aria-label="Highlighter"
            onClick={() => setTool('highlighter')}
          >
            <MarkerIcon />
          </button>

          <button
            className={`tool${tool === 'eraser' ? ' active' : ''}`}
            title="Eraser (drag over a shape)"
            aria-label="Eraser"
            onClick={() => setTool('eraser')}
          >
            <EraserIcon />
          </button>

          <span className="divider" />

          <button className="tool" title="Rectangle" aria-label="Rectangle" onClick={() => addShape('rect')}>
            <RectIcon />
          </button>
          <button className="tool" title="Circle" aria-label="Circle" onClick={() => addShape('circle')}>
            <CircleIcon />
          </button>
          <button className="tool" title="Text" aria-label="Text" onClick={() => addShape('text')}>
            <TextIcon />
          </button>

          <span className="divider" />

          <button
            className="tool"
            title="Undo (Ctrl/Cmd+Z)"
            aria-label="Undo"
            onClick={undo}
            disabled={!canUndo}
          >
            <UndoIcon />
          </button>
          <button
            className="tool"
            title="Redo (Ctrl/Cmd+Shift+Z)"
            aria-label="Redo"
            onClick={redo}
            disabled={!canRedo}
          >
            <RedoIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- icons ---------- */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Pencil({ color }: { color: string }) {
  // a little colored pencil — body tinted to the pen color
  return (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <path d="M5 19l2-5 9-9 3 3-9 9z" fill={color} />
      <path d="M14 5l3 3" stroke="#fff" strokeWidth="1.2" />
      <path d="M5 19l2-5 9-9 3 3-9 9z" fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="0.8" />
      <path d="M5 19l2-5 1.5 1.5L9 18z" fill="#3b2f2a" />
    </svg>
  );
}
const CursorIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}><path d="M5 3l6 16 2-7 7-2z" /></svg>
);
const MarkerIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <path d="M8 16l-2 4h5l-1-3z" fill="#eab308" />
    <rect x="9" y="3" width="6" height="11" rx="1.5" transform="rotate(40 12 8)" fill="#fde047" stroke="#eab308" strokeWidth="0.8" />
  </svg>
);
const EraserIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect x="4" y="11" width="14" height="7" rx="2" transform="rotate(-35 11 14)" fill="#f9a8d4" stroke="#db2777" strokeWidth="0.9" />
  </svg>
);
const RectIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}><rect x="4" y="6" width="16" height="12" rx="2" /></svg>
);
const CircleIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="7.5" /></svg>
);
const TextIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}><path d="M6 6h12M12 6v12" /></svg>
);
const UndoIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}><path d="M9 7L4 12l5 5M4 12h11a4 4 0 0 1 0 8h-1" /></svg>
);
const RedoIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}><path d="M15 7l5 5-5 5M20 12H9a4 4 0 0 0 0 8h1" /></svg>
);
const GearIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
  </svg>
);