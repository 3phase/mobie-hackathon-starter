import { Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { APP_CONFIG } from '../config/configuration.js';
import type { AppConfig } from '../config/config.types.js';
import { AuthService } from './auth.service.js';

function stateCookie(value: string, maxAge: number, secure: boolean): string {
  return `mobie_oauth_state=${value}; Path=/callback; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function readCookie(request: Request, name: string): string | undefined {
  return request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

@Controller()
export class AuthController {
  private readonly secureCookie: boolean;

  public constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.secureCookie = new URL(config.redirectUri).protocol === 'https:';
  }

  @Post('auth/login')
  @HttpCode(200)
  public login(@Res({ passthrough: true }) response: Response): { url: string } {
    const { url, state } = this.auth.beginLogin();
    response.setHeader('Set-Cookie', stateCookie(state, 600, this.secureCookie));
    return { url };
  }

  @Public()
  @Get('callback')
  public async callback(
    @Req() request: Request,
    @Res() response: Response,
    @Query('code') code: unknown,
    @Query('state') state: unknown,
  ): Promise<void> {
    await this.auth.finishLogin({ code, state, cookieState: readCookie(request, 'mobie_oauth_state') });
    response.setHeader('Location', '/?login=success');
    response.setHeader('Set-Cookie', stateCookie('', 0, this.secureCookie));
    response.status(303).end();
  }

  @Post('api/logout')
  @HttpCode(200)
  public logout(): { authenticated: false } {
    this.auth.logout();
    return { authenticated: false };
  }

  @Get('api/status')
  public status() {
    return this.auth.status();
  }
}
