import { Module } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { InvitationsController, UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, InvitationsController],
  providers: [UsersService, InvitationsService],
  exports: [UsersService],
})
export class UsersModule {}
