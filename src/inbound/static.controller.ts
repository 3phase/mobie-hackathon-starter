import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'node:path';
import { Public } from '../common/decorators/public.decorator.js';

const publicDirectory = join(process.cwd(), 'public');

@Public()
@Controller()
export class StaticController {
  @Get()
  public index(@Res() response: Response): void {
    response.type('html').sendFile(join(publicDirectory, 'index.html'));
  }

  @Get('page.js')
  public script(@Res() response: Response): void {
    response.type('text/javascript').sendFile(join(publicDirectory, 'page.js'));
  }
}
