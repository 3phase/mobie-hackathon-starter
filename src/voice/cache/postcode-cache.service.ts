import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/providers/runtime.providers.js';
import { APP_CONFIG } from '../../config/configuration.js';
import type { AppConfig } from '../../config/config.types.js';
import { OpenPlzService } from '../providers/openplz.service.js';
import type { PostcodeData } from '../providers/openplz.types.js';

@Injectable()
export class PostcodeCacheService {
  private readonly entries = new Map<string, PostcodeData>();
  private readonly inFlight = new Map<string, Promise<PostcodeData>>();
  private readonly logger = new Logger(PostcodeCacheService.name);

  public constructor(
    @Inject(OpenPlzService) private readonly openPlz: OpenPlzService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  public get(postcode: string): Promise<PostcodeData> {
    const normalized = postcode.trim();
    const cached = this.entries.get(normalized);
    if (cached && this.now() - cached.fetchedAt < this.config.openPlzCacheTtlMs) {
      this.entries.delete(normalized);
      this.entries.set(normalized, cached);
      return Promise.resolve(cached);
    }
    if (cached) this.entries.delete(normalized);
    const pending = this.inFlight.get(normalized);
    if (pending) return pending;

    const startedAt = this.now();
    const load = Promise.all([
      this.openPlz.fetchLocalities(normalized),
      this.openPlz.fetchStreets(normalized),
    ]).then(([localities, streets]) => {
      const data: PostcodeData = { postcode: normalized, localities, streets, fetchedAt: this.now() };
      this.evictIfNeeded();
      this.entries.set(normalized, data);
      this.logger.log(`Loaded complete OpenPLZ postcode dataset in ${this.now() - startedAt}ms.`);
      return data;
    }).finally(() => this.inFlight.delete(normalized));
    this.inFlight.set(normalized, load);
    return load;
  }

  private evictIfNeeded(): void {
    while (this.entries.size >= this.config.openPlzCacheMaxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }
}
