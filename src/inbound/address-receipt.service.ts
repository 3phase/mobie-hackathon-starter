import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { HttpError } from '../common/errors/http.error.js';

interface AddressReceipt {
  readonly id: string;
  readonly query: string;
  readonly receivedAt: string;
}

@Injectable()
export class AddressReceiptService {
  private readonly receipts: AddressReceipt[] = [];

  public receive(query: string): { received: true; message: string } & AddressReceipt {
    if (!query.trim() || query.length > 256) {
      throw new HttpError(400, 'query must be a non-empty address string of at most 256 characters.');
    }

    const receipt = { id: randomUUID(), query, receivedAt: new Date().toISOString() };
    this.receipts.unshift(receipt);
    if (this.receipts.length > 20) this.receipts.pop();
    return { received: true, ...receipt, message: 'Die Adresse ist in unserer App angekommen.' };
  }

  public list(): { receipts: readonly AddressReceipt[] } {
    return { receipts: this.receipts };
  }
}
