import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { LeadScoringService } from './lead-scoring.service';
import { Request } from 'express';

@Controller('crm/leads')
export class LeadScoringController {
  constructor(private readonly leadScoringService: LeadScoringService) {}

  /**
   * GET /crm/leads/:id/score
   * Calcula score do lead.
   */
  @Get(':id/score')
  @HttpCode(HttpStatus.OK)
  async getLeadScore(@Param('id') leadId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant não identificado');
    }

    return this.leadScoringService.scoreLeadAsync(tenantId, leadId);
  }

  /**
   * POST /crm/leads/:id/route
   * Roteia o lead para um vendedor.
   */
  @Post(':id/route')
  @HttpCode(HttpStatus.OK)
  async routeLead(@Param('id') leadId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant não identificado');
    }

    const routing = await this.leadScoringService.routeLeadAsync(tenantId, leadId);

    if (!routing) {
      return {
        success: false,
        message: 'Nenhum vendedor disponível para roteamento',
      };
    }

    return {
      success: true,
      ...routing,
    };
  }
}
