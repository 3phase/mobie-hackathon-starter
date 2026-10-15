export interface FederalProvinceSummary {
  readonly key: string;
  readonly name: string;
}

export interface DistrictSummary {
  readonly key: string;
  readonly code: string;
  readonly name: string;
}

export interface MunicipalitySummary {
  readonly key: string;
  readonly code: string;
  readonly name: string;
  readonly status?: string;
}

export interface LocalityEntry {
  readonly key: string;
  readonly name: string;
  readonly postalCode: string;
  readonly municipality: MunicipalitySummary;
  readonly district: DistrictSummary;
  readonly federalProvince: FederalProvinceSummary;
}

export interface StreetEntry {
  readonly key: string;
  readonly name: string;
  readonly postalCode: string;
  readonly locality: string;
  readonly municipality: MunicipalitySummary;
  readonly district: DistrictSummary;
  readonly federalProvince: FederalProvinceSummary;
}

export interface PostcodeData {
  readonly postcode: string;
  readonly localities: LocalityEntry[];
  readonly streets: StreetEntry[];
  readonly fetchedAt: number;
}
