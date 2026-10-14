import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { JsonContentTypeGuard } from '../common/guards/json-content-type.guard.js';
import { AddressReceiptService } from './address-receipt.service.js';
import { AddressReceiptDto } from './dto/address-receipt.dto.js';

@Controller('api/addresses')
export class AddressReceiptController {
  public constructor(@Inject(AddressReceiptService) private readonly receipts: AddressReceiptService) {}

  @Get('received')
  public list() {
    return this.receipts.list();
  }

  @Post('receive')
  @HttpCode(200)
  @UseGuards(JsonContentTypeGuard)
  public receive(@Body() body: AddressReceiptDto) {
    return this.receipts.receive(body.query);
  }
}
