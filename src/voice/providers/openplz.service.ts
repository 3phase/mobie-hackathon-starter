import { Inject, Injectable } from '@nestjs/common';
import { HttpError } from '../../common/errors/http.error.js';
import { FETCH, type FetchFunction } from '../../common/providers/runtime.providers.js';
import { APP_CONFIG } from '../../config/configuration.js';
import type { AppConfig } from '../../config/config.types.js';
import type {
  DistrictSummary,
  FederalProvinceSummary,
  LocalityEntry,
  MunicipalitySummary,
  StreetEntry,
} from './openplz.types.js';

interface Page<T> {
  readonly items: T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
  readonly totalPages: number;
}

type UnknownRecord = Record<string, unknown>;

function object(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(502, `OpenPLZ returned a malformed ${label}.`);
  }
  return value as UnknownRecord;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(502, `OpenPLZ returned a malformed ${label}.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, label);
}

function federalProvince(value: unknown): FederalProvinceSummary {
  const item = object(value, 'federal province');
  return { key: requiredString(item.key, 'federal province key'), name: requiredString(item.name, 'federal province name') };
}

function district(value: unknown): DistrictSummary {
  const item = object(value, 'district');
  return {
    key: requiredString(item.key, 'district key'),
    code: requiredString(item.code, 'district code'),
    name: requiredString(item.name, 'district name'),
  };
}

function municipality(value: unknown): MunicipalitySummary {
  const item = object(value, 'municipality');
  const status = optionalString(item.status, 'municipality status');
  return {
    key: requiredString(item.key, 'municipality key'),
    code: requiredString(item.code, 'municipality code'),
    name: requiredString(item.name, 'municipality name'),
    ...(status ? { status } : {}),
  };
}

function locality(value: unknown): LocalityEntry {
  const item = object(value, 'city');
  return {
    key: requiredString(item.key, 'locality key'),
    name: requiredString(item.name, 'locality name'),
    postalCode: requiredString(item.postalCode, 'locality postal code'),
    municipality: municipality(item.municipality),
    district: district(item.district),
    federalProvince: federalProvince(item.federalProvince),
  };
}

function street(value: unknown): StreetEntry {
  const item = object(value, 'street');
  return {
    key: requiredString(item.key, 'street key'),
    name: requiredString(item.name, 'street name'),
    postalCode: requiredString(item.postalCode, 'street postal code'),
    locality: requiredString(item.locality, 'street locality'),
    municipality: municipality(item.municipality),
    district: district(item.district),
    federalProvince: federalProvince(item.federalProvince),
  };
}

function headerInteger(headers: Headers, name: string, minimum: number): number {
  const raw = headers.get(name);
  if (raw === null || !/^\d+$/.test(raw)) throw new HttpError(502, `OpenPLZ omitted or malformed ${name}.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) throw new HttpError(502, `OpenPLZ returned invalid ${name}.`);
  return value;
}

function retryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

@Injectable()
export class OpenPlzService {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FETCH) private readonly fetch: FetchFunction,
  ) {}

  public async fetchLocalities(postalCode: string): Promise<LocalityEntry[]> {
    const values = await this.fetchAllPages<unknown>('/at/Localities', { postalCode });
    return values.map(locality);
  }

  public async fetchStreets(postalCode: string): Promise<StreetEntry[]> {
    const values = await this.fetchAllPages<unknown>('/at/Streets', { postalCode });
    return values.map(street);
  }

  public async searchLocalities(name: string): Promise<LocalityEntry[]> {
    const values = await this.fetchAllPages<unknown>('/at/Localities', { name }, 250);
    return values.map(locality);
  }

  public async searchStreets(name: string, localityName?: string): Promise<StreetEntry[]> {
    const values = await this.fetchAllPages<unknown>('/at/Streets', {
      name,
      ...(localityName ? { locality: localityName } : {}),
    }, 250);
    return values.map(street);
  }

  public async fetchAllPages<T>(
    endpoint: string,
    params: Record<string, string>,
    maximumRecords = Number.MAX_SAFE_INTEGER,
  ): Promise<T[]> {
    if (!/^\/at\/[A-Za-z]+$/.test(endpoint)) throw new HttpError(500, 'Invalid OpenPLZ endpoint configuration.');
    const first = await this.fetchPage<T>(endpoint, params, 1);
    if (first.totalCount > maximumRecords) {
      throw new HttpError(422, 'The OpenPLZ lookup is too broad. Supply an Austrian postcode.');
    }
    if (first.totalCount === 0) return [];

    const pages: T[][] = Array.from({ length: first.totalPages });
    pages[0] = first.items;
    let nextPage = 2;
    const worker = async (): Promise<void> => {
      while (nextPage <= first.totalPages) {
        const pageNumber = nextPage++;
        const page = await this.fetchPage<T>(endpoint, params, pageNumber);
        this.assertConsistent(first, page);
        pages[pageNumber - 1] = page.items;
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, first.totalPages - 1) }, worker));
    if (pages.some((page) => !page)) throw new HttpError(502, 'OpenPLZ pagination was incomplete.');
    const combined = pages.flat();
    if (combined.length !== first.totalCount) throw new HttpError(502, 'OpenPLZ pagination count was inconsistent.');
    return combined;
  }

  private async fetchPage<T>(endpoint: string, params: Record<string, string>, page: number): Promise<Page<T>> {
    const url = new URL(`${this.config.openPlzBaseUrl}${endpoint}`);
    url.search = new URLSearchParams({ ...params, page: String(page), pageSize: '50' }).toString();
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.openPlzRetries; attempt += 1) {
      try {
        const response = await this.fetch(url, {
          headers: { accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(this.config.openPlzTimeoutMs),
        });
        if (!response.ok) {
          if (retryable(response.status) && attempt < this.config.openPlzRetries) continue;
          throw new HttpError(502, `OpenPLZ returned HTTP ${response.status}.`);
        }
        const body = await response.json() as unknown;
        if (!Array.isArray(body)) throw new HttpError(502, 'OpenPLZ returned a non-array page.');
        const result: Page<T> = {
          items: body as T[],
          page: headerInteger(response.headers, 'x-page', 1),
          pageSize: headerInteger(response.headers, 'x-page-size', 1),
          totalCount: headerInteger(response.headers, 'x-total-count', 0),
          totalPages: headerInteger(response.headers, 'x-total-pages', 0),
        };
        this.assertPage(result, page);
        return result;
      } catch (error) {
        lastError = error;
        if (error instanceof HttpError || attempt >= this.config.openPlzRetries) break;
      }
    }
    if (lastError instanceof HttpError) throw lastError;
    throw new HttpError(502, 'OpenPLZ request failed or timed out.');
  }

  private assertPage<T>(result: Page<T>, requestedPage: number): void {
    if (result.page !== requestedPage || result.pageSize !== 50) {
      throw new HttpError(502, 'OpenPLZ returned inconsistent page metadata.');
    }
    const expectedPages = result.totalCount === 0 ? 0 : Math.ceil(result.totalCount / result.pageSize);
    if (result.totalPages !== expectedPages || result.totalPages > 10_000) {
      throw new HttpError(502, 'OpenPLZ returned inconsistent total-page metadata.');
    }
    const expectedItems = result.totalCount === 0
      ? 0
      : Math.min(result.pageSize, result.totalCount - (requestedPage - 1) * result.pageSize);
    if (expectedItems < 0 || result.items.length !== expectedItems) {
      throw new HttpError(502, 'OpenPLZ returned an incomplete page.');
    }
  }

  private assertConsistent<T>(first: Page<T>, page: Page<T>): void {
    if (page.totalCount !== first.totalCount || page.totalPages !== first.totalPages || page.pageSize !== first.pageSize) {
      throw new HttpError(502, 'OpenPLZ pagination metadata changed between pages.');
    }
  }
}
