import { Global, Module } from '@nestjs/common';
import { AneelImportService, AneelSource, HttpAneelSource } from './aneel-import.service';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';

@Global()
@Module({
  controllers: [ReferenceDataController],
  providers: [
    ReferenceDataService,
    AneelImportService,
    { provide: AneelSource, useClass: HttpAneelSource },
  ],
  exports: [ReferenceDataService, AneelSource],
})
export class ReferenceDataModule {}
