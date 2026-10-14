import { Inject, Injectable } from '@nestjs/common';
import { HttpError } from '../common/errors/http.error.js';
import { MobieClient } from './mobie.client.js';
import { ridePayload } from './ride-payload.js';

@Injectable()
export class MobieService {
  public constructor(@Inject(MobieClient) private readonly client: MobieClient) {}

  public me(): Promise<unknown> {
    return this.client.me();
  }

  public searchRides(payload: unknown): Promise<unknown> {
    return this.client.searchRides(ridePayload(payload));
  }

  public driverRideDetails(id: string): Promise<unknown> {
    return this.client.driverRideDetails(id);
  }

  public riderRideDetails(id: string): Promise<unknown> {
    return this.client.riderRideDetails(id);
  }

  public joinRide(id: string, payload: unknown, confirmed: unknown): Promise<unknown> {
    if (confirmed !== true) {
      throw new HttpError(400, 'Explicit caller confirmation is required (confirmed: true).');
    }
    return this.client.joinRide(id, ridePayload(payload));
  }
}
