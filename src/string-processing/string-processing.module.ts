import { Module } from '@nestjs/common';
import { StringProcessingService } from './string-processing.service.js';

@Module({
  providers: [StringProcessingService],
  exports: [StringProcessingService],
})
export class StringProcessingModule {}
