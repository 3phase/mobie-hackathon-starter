import { All, Controller } from '@nestjs/common';
import { HttpError } from '../common/errors/http.error.js';

@Controller()
export class NotFoundController {
  @All('*path')
  public notFound(): never {
    throw new HttpError(404, 'Endpoint not found. See docs/api.md.');
  }
}
