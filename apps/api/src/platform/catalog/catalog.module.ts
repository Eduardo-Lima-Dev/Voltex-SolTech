import { Global, Module } from '@nestjs/common';
import { CatalogSourcesService } from './catalog-sources.service';
import { CatalogImportService } from './catalog-import.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PriceListService } from './price-list.service';
import { ReferencesService } from './references.service';

/** Catálogo técnico por empresa (ADR-0017). */
@Global()
@Module({
  controllers: [CatalogController],
  providers: [
    CatalogService,
    CatalogImportService,
    CatalogSourcesService,
    PriceListService,
    ReferencesService,
  ],
  exports: [CatalogService, PriceListService],
})
export class CatalogModule {}
