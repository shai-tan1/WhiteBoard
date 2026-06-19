import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WhiteboardGateway } from './whiteboard/whiteboard.gateway';
import { EventLogService } from './event-log/event-log.service';
import { EventLogController } from './event-log/event-log.controller';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AppController, EventLogController],
  providers: [AppService, WhiteboardGateway, EventLogService],
})
export class AppModule {}
