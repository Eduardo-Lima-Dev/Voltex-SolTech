import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { PermissionsGuard } from './permissions.guard';
import { SessionCookieService } from './session-cookie.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController, MfaController],
  providers: [
    AuthService,
    MfaService,
    PasswordService,
    SessionCookieService,
    JwtAuthGuard,
    PermissionsGuard,
  ],
  exports: [
    AuthService,
    MfaService,
    PasswordService,
    SessionCookieService,
    JwtAuthGuard,
    PermissionsGuard,
    JwtModule,
  ],
})
export class AuthModule {}
