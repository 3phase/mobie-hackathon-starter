import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import { UpstreamHttpClient } from '../common/http/upstream-http.client.js';
import { APP_CONFIG } from '../config/configuration.js';
import type { AppConfig } from '../config/config.types.js';
import type { RidePayload } from './mobie.types.js';
import { ridePath } from './ride-payload.js';

@Injectable()
export class MobieClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(UpstreamHttpClient) private readonly http: UpstreamHttpClient,
  ) {}

  public me(): Promise<unknown> {
    return this.request('/me');
  }

  public searchRides(payload: RidePayload): Promise<unknown> {
    return this.request('/rides/search', 'POST', payload);
  }

  public driverRideDetails(id: string): Promise<unknown> {
    return this.request(ridePath(id));
  }

  public riderRideDetails(id: string): Promise<unknown> {
    return this.request(`${ridePath(id)}/rider-detail`);
  }

  public joinRide(id: string, payload: RidePayload): Promise<unknown> {
    return this.request(`${ridePath(id)}/join-detailed`, 'POST', payload);
  }

  private async request(path: string, method = 'GET', body?: RidePayload): Promise<unknown> {
    return this.http.requestJson(
      `${this.config.baseUrl.replace(/\/$/, '')}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${await this.auth.getAccessToken()}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      'mobie API',
    );
  }
}
