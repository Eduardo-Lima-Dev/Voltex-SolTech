import { Module } from '@nestjs/common';
import { PriceExtractionController } from './price-extraction.controller';
import { PriceExtractionService } from './price-extraction.service';

/** Procurement assistido (Fase 12H). Usa a lista de preços do catálogo (módulo global) e o gateway de IA. */
@Module({
  controllers: [PriceExtractionController],
  providers: [PriceExtractionService],
})
export class ProcurementModule {}
