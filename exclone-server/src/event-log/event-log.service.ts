import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

const dateToUser = (date: string) => {
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss');
};

export interface EventLog {
  event: string;
  timestamp: string;
  payload: unknown;
}

@Injectable()
export class EventLogService {
  private readonly eventLogs: EventLog[] = [];

  log(eventName: string, payload: unknown) {
    const newLog: EventLog = {
      event: eventName,
      timestamp: dateToUser(new Date().toISOString()),
      payload,
    };
    this.eventLogs.push(newLog);
    // Keep only the 100 most recent events (circular buffer).
    if (this.eventLogs.length > 100) {
      this.eventLogs.shift();
    }
  }

  getLogs(): EventLog[] {
    return this.eventLogs;
  }

  clearLogs() {
    this.eventLogs.length = 0;
  }
}
