import { Controller, Get, Delete } from '@nestjs/common';
import { EventLogService } from './event-log.service';

@Controller('event-log')
export class EventLogController {
  constructor(private readonly eventLogService: EventLogService) {}

  // GET /event-log -> returns the last 100 logged events
  @Get()
  getLogs() {
    return this.eventLogService.getLogs();
  }

  // DELETE /event-log -> clears the in-memory log buffer
  @Delete()
  clearLogs() {
    this.eventLogService.clearLogs();
    return { cleared: true };
  }
}
