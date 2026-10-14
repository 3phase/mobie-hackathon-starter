import { IsDefined, IsString } from 'class-validator';

export class AddressReceiptDto {
  @IsDefined({ message: 'query must be a non-empty address string of at most 256 characters.' })
  @IsString({ message: 'query must be a non-empty address string of at most 256 characters.' })
  public query!: string;
}
