import { Global, Module } from '@nestjs/common';
import { ClimateService } from './climate.service';
import { DataHubController } from './data-hub.controller';
import { DataHubHttp, FetchDataHubHttp } from './data-hub-http';
import { DataHubQueue } from './data-hub.queue';
import { DataSourcesService } from './data-sources.service';
import { SolarResourceProposalService } from './solar-resource-proposal.service';
import { SourceWatchService } from './source-watch.service';
import { TariffScanService } from './tariff-scan.service';
import { UpdateProposalsService } from './update-proposals.service';

/** Central de Dados Externos (ADR-0018): coleta, vigilância e caixa de atualizações. */
@Global()
@Module({
  controllers: [DataHubController],
  providers: [
    { provide: DataHubHttp, useClass: FetchDataHubHttp },
    DataSourcesService,
    ClimateService,
    SourceWatchService,
    UpdateProposalsService,
    TariffScanService,
    SolarResourceProposalService,
    DataHubQueue,
  ],
  exports: [DataSourcesService, ClimateService, UpdateProposalsService, DataHubQueue],
})
export class DataHubModule {}
