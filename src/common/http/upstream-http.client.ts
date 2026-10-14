import { Inject, Injectable } from '@nestjs/common';
import { HttpError } from '../errors/http.error.js';
import { FETCH, type FetchFunction } from '../providers/runtime.providers.js';

@Injectable()
export class UpstreamHttpClient {
  public constructor(@Inject(FETCH) private readonly fetch: FetchFunction) {}

  public async requestJson(url: string, options: RequestInit = {}, service = 'Upstream'): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetch(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new HttpError(502, `${service} request failed or timed out. A write may have succeeded; check before retrying.`);
    }

    if (!response.ok) {
      const status = response.status >= 400 && response.status < 600 ? response.status : 502;
      throw new HttpError(status, `${service} returned HTTP ${response.status}.`);
    }
    if (response.status === 204) return null;

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new HttpError(502, `${service} returned an invalid JSON response.`);
    }
  }
}
