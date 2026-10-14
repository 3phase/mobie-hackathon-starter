export interface AppConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly audience: string;
  readonly redirectUri: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly mapboxToken: string;
  readonly port: number;
  readonly host: string;
}

export type Environment = Readonly<Record<string, string | undefined>>;
