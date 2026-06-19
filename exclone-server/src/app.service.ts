import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Whiteboard server is running. Connect via Socket.IO on this same port.';
  }
}
