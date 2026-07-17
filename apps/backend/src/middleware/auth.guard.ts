// Ported from immich:server/src/middleware/auth.guard.ts. Tiers per
// docs/plan/09-api-surface.md §1: @Authenticated() any user,
// { superAdmin: true }, { orgRole: 'member' | 'admin' | 'owner' },
// { participant: true } (gallery token allowed).
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth, ApiCookieAuth, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthDto, LoginDetails } from 'src/dtos/auth.dto';
import { MetadataKey } from 'src/enum';
import { AuthService, AuthenticateOptions, GALLERY_TOKEN_QUERY } from 'src/services/auth.service';

export const Authenticated = (options: AuthenticateOptions = {}): MethodDecorator => {
  const decorators: MethodDecorator[] = [
    ApiBearerAuth(),
    ApiCookieAuth(),
    SetMetadata(MetadataKey.AuthRoute, options),
  ];

  if (options.participant) {
    decorators.push(ApiQuery({ name: GALLERY_TOKEN_QUERY, type: String, required: false }));
  }

  return applyDecorators(...decorators);
};

export const Auth = createParamDecorator((data, context: ExecutionContext): AuthDto => {
  return context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
});

export const GetLoginDetails = createParamDecorator((data, context: ExecutionContext): LoginDetails => {
  const request = context.switchToHttp().getRequest<Request>();
  const userAgent = request.headers['user-agent'] ?? '';

  return {
    clientIp: request.ip ?? '',
    isSecure: request.secure,
    deviceOs: '',
    deviceType: userAgent.slice(0, 255),
  };
});

export interface AuthRequest extends Request {
  auth?: AuthDto;
}

export interface AuthenticatedRequest extends Request {
  auth: AuthDto;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<AuthenticateOptions | undefined>(MetadataKey.AuthRoute, [
      context.getHandler(),
    ]);
    if (!options) {
      // routes without @Authenticated are public (e.g. /api/public/**)
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthRequest>();

    request.auth = await this.authService.authenticate({
      headers: request.headers,
      queryParams: request.query as Record<string, string>,
      pathParams: request.params as Record<string, string>,
      options,
    });

    return true;
  }
}
