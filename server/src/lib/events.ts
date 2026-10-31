import { EventEmitter } from 'node:events';

export type LiveEvent =
  | { type: 'job'; jobId: string; status: string }
  | { type: 'position'; driverId: string; truckId: string | null; lat: number; lng: number; ts: string }
  | { type: 'shift'; driverId: string; onDuty: boolean }
  | { type: 'tank'; tankId: string; volume_l: number; ts: string };

/** In-process fan-out to dispatch screens over server-sent events. */
export class LiveBus extends EventEmitter {
  publish(event: LiveEvent): void {
    this.emit('event', event);
  }
}
