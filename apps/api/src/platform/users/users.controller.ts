import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  listUsersQuerySchema,
  updateUserSchema,
} from '@voltex/shared';
import type { RequestUser } from '../../common/context/request-user';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { SessionCookieService } from '../auth/session-cookie.service';
import { InvitationsService } from './invitations.service';
import { UsersService } from './users.service';

class ListUsersQueryDto extends createZodDto(listUsersQuerySchema) {}
class UpdateUserDto extends createZodDto(updateUserSchema) {}
class CreateInvitationDto extends createZodDto(createInvitationSchema) {}
class AcceptInvitationDto extends createZodDto(acceptInvitationSchema) {}

@ApiTags('Usuários')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('platform.user.read')
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Get(':id')
  @RequirePermissions('platform.user.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Patch(':id')
  @RequirePermissions('platform.user.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.users.update(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('platform.user.manage')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.users.remove(id, actor);
  }
}

@ApiTags('Convites')
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly cookies: SessionCookieService,
  ) {}

  @Post()
  @ApiBearerAuth()
  @RequirePermissions('platform.user.manage')
  create(@Body() body: CreateInvitationDto, @CurrentUser() actor: RequestUser) {
    return this.invitations.create(body, actor);
  }

  @Get()
  @ApiBearerAuth()
  @RequirePermissions('platform.user.manage')
  list() {
    return this.invitations.list();
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiBearerAuth()
  @RequirePermissions('platform.user.manage')
  revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.invitations.revoke(id);
  }

  @Public()
  @Post('accept')
  @HttpCode(200)
  async accept(
    @Body() body: AcceptInvitationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.invitations.accept(body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return this.cookies.respond(res, session);
  }
}
