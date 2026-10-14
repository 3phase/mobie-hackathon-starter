import { IsDefined, IsString } from 'class-validator';

export class LocationSearchDto {
  @IsDefined({ message: 'query must contain 1–256 characters, at most 20 words and no semicolon.' })
  @IsString({ message: 'query must contain 1–256 characters, at most 20 words and no semicolon.' })
  public query!: string;
}
