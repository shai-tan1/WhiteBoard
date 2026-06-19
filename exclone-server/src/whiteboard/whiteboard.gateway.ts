import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { EventLogService } from '../event-log/event-log.service';

export type WhiteboardObject = {
  id: string;
  props: Record<string, unknown>;
  [key: string]: unknown;
};

@WebSocketGateway({ cors: true })
export class WhiteboardGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(private readonly eventLogService: EventLogService) {}

  // In-memory source of truth for all whiteboard objects.
  // Keyed by object id for O(1) lookups on modify/remove.
  private objects: Record<string, WhiteboardObject> = {};

  handleConnection(client: Socket) {
    this.eventLogService.log('client:connected', { clientId: client.id });
    this.eventLogService.log('client:syncing', {
      objects: Object.values(this.objects),
    });
    console.log('client:connected and syncing', { clientId: client.id });

    // Send the full current canvas state to the freshly connected client only.
    client.emit('object:sync', { objects: Object.values(this.objects) });
  }

  handleDisconnect(client: Socket) {
    this.eventLogService.log('client:disconnected', { clientId: client.id });
    console.log('client:disconnected', { clientId: client.id });
  }

  @SubscribeMessage('object:added')
  handleObjectAdded(
    @MessageBody() data: WhiteboardObject,
    @ConnectedSocket() client: Socket,
  ) {
    this.eventLogService.log('object:added', data);
    this.objects[data.id] = data;
    // Broadcast to everyone EXCEPT the sender (sender already drew it locally).
    client.broadcast.emit('object:added', data);
  }

  @SubscribeMessage('object:modified')
  handleObjectModified(
    @MessageBody() data: WhiteboardObject,
    @ConnectedSocket() client: Socket,
  ) {
    this.eventLogService.log('object:modified', data);
    if (this.objects[data.id]) {
      this.objects[data.id] = {
        ...this.objects[data.id],
        props: {
          ...this.objects[data.id].props,
          ...data.props,
        },
      };
      client.broadcast.emit('object:modified', data);
    }
  }

  @SubscribeMessage('object:removed')
  handleObjectRemoved(
    @MessageBody() data: WhiteboardObject,
    @ConnectedSocket() client: Socket,
  ) {
    this.eventLogService.log('object:removed', data);
    delete this.objects[data.id];
    client.broadcast.emit('object:removed', data);
  }

  @SubscribeMessage('canvas:clear')
  handleCanvasClear(@ConnectedSocket() client: Socket) {
    this.eventLogService.log('canvas:clear', {});
    this.objects = {};
    client.broadcast.emit('canvas:clear');
  }
}
