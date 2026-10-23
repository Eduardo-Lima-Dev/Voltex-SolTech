import { Controller, Delete, Post, Param, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { LgpdService } from './lgpd.service';
import { Request } from 'express';

@Controller('crm/privacy')
export class LgpdController {
  constructor(private readonly lgpdService: LgpdService) {}

  /**
   * DELETE /crm/privacy/accounts/:accountId/erase
   * Apaga toda a informação pessoal de uma conta.
   */
  @Delete('accounts/:accountId/erase')
  @HttpCode(HttpStatus.OK)
  async eraseAccount(@Param('accountId') accountId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.lgpdService.eraseAccountAsync(tenantId, accountId);
  }

  /**
   * POST /crm/privacy/export
   * Exporta dados da empresa para conformidade LGPD.
   */
  @Post('export')
  @HttpCode(HttpStatus.OK)
  async exportData(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.lgpdService.exportTenantDataAsync(tenantId);
  }
}
