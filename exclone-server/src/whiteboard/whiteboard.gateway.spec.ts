import { Test, TestingModule } from '@nestjs/testing';
import { WhiteboardGateway, WhiteboardObject } from './whiteboard.gateway';
import { EventLogService } from '../event-log/event-log.service';

// Minimal fake Socket that records what was emitted/broadcast.
function makeFakeClient(id = 'client-1') {
  const emitted: Array<{ event: string; payload?: unknown }> = [];
  const broadcasted: Array<{ event: string; payload?: unknown }> = [];
  return {
    id,
    emitted,
    broadcasted,
    emit: (event: string, payload?: unknown) =>
      emitted.push({ event, payload }),
    broadcast: {
      emit: (event: string, payload?: unknown) =>
        broadcasted.push({ event, payload }),
    },
  };
}

describe('WhiteboardGateway', () => {
  let gateway: WhiteboardGateway;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [WhiteboardGateway, EventLogService],
    }).compile();

    gateway = moduleRef.get<WhiteboardGateway>(WhiteboardGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('syncs current objects to a newly connected client', () => {
    const adder = makeFakeClient('adder');
    const obj: WhiteboardObject = { id: 'a1', props: { x: 1 } };
    gateway.handleObjectAdded(obj, adder as any);

    const fresh = makeFakeClient('fresh');
    gateway.handleConnection(fresh as any);

    const sync = fresh.emitted.find((e) => e.event === 'object:sync');
    expect(sync).toBeDefined();
    expect((sync!.payload as any).objects).toEqual([obj]);
  });

  it('stores an added object and broadcasts it to others', () => {
    const client = makeFakeClient();
    const obj: WhiteboardObject = { id: 'r1', props: { color: 'red' } };

    gateway.handleObjectAdded(obj, client as any);

    expect(client.broadcasted).toContainEqual({
      event: 'object:added',
      payload: obj,
    });
  });

  it('merges props on modify and broadcasts the change', () => {
    const client = makeFakeClient();
    gateway.handleObjectAdded(
      { id: 'r1', props: { color: 'red', x: 0 } },
      client as any,
    );

    gateway.handleObjectModified({ id: 'r1', props: { x: 50 } }, client as any);

    const fresh = makeFakeClient('fresh');
    gateway.handleConnection(fresh as any);
    const synced = (
      fresh.emitted.find((e) => e.event === 'object:sync')!.payload as any
    ).objects[0];

    // x updated, color preserved (deep prop merge)
    expect(synced.props).toEqual({ color: 'red', x: 50 });
  });

  it('does not broadcast modify for an unknown object', () => {
    const client = makeFakeClient();
    gateway.handleObjectModified(
      { id: 'ghost', props: { x: 1 } },
      client as any,
    );
    expect(client.broadcasted).toHaveLength(0);
  });

  it('removes an object and broadcasts the removal', () => {
    const client = makeFakeClient();
    gateway.handleObjectAdded({ id: 'r1', props: {} }, client as any);
    gateway.handleObjectRemoved({ id: 'r1', props: {} }, client as any);

    const fresh = makeFakeClient('fresh');
    gateway.handleConnection(fresh as any);
    const synced = (
      fresh.emitted.find((e) => e.event === 'object:sync')!.payload as any
    ).objects;
    expect(synced).toHaveLength(0);
  });

  it('clears the whole canvas', () => {
    const client = makeFakeClient();
    gateway.handleObjectAdded({ id: 'r1', props: {} }, client as any);
    gateway.handleObjectAdded({ id: 'r2', props: {} }, client as any);

    gateway.handleCanvasClear(client as any);

    expect(client.broadcasted).toContainEqual({ event: 'canvas:clear' });

    const fresh = makeFakeClient('fresh');
    gateway.handleConnection(fresh as any);
    const synced = (
      fresh.emitted.find((e) => e.event === 'object:sync')!.payload as any
    ).objects;
    expect(synced).toHaveLength(0);
  });
});
