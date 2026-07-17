import { Body, Controller, Get, HttpCode, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AdminSignupDto, AuthDto, ChangePasswordDto, LoginDetails, LoginDto, LoginResponseDto } from 'src/dtos/auth.dto';
import { Auth, Authenticated, GetLoginDetails } from 'src/middleware/auth.guard';
import { ConfigRepository } from 'src/repositories/config.repository';
import { OrganizationRepository } from 'src/repositories/organization.repository';
import { AuthService, SESSION_COOKIE } from 'src/services/auth.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private configRepository: ConfigRepository,
    private organizationRepository: OrganizationRepository,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @GetLoginDetails() details: LoginDetails,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const response = await this.authService.login(dto, details);
    this.setSessionCookie(res, response.accessToken);
    return response;
  }

  // First boot only — creates the initial super admin while no users exist.
  @Post('admin-signup')
  async adminSignup(
    @Body() dto: AdminSignupDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const response = await this.authService.adminSignup(dto);
    this.setSessionCookie(res, response.accessToken);
    return response;
  }

  @Post('logout')
  @HttpCode(200)
  @Authenticated()
  async logout(@Auth() auth: AuthDto, @Res({ passthrough: true }) res: Response): Promise<void> {
    res.clearCookie(SESSION_COOKIE);
    await this.authService.logout(auth);
  }

  @Get('me')
  @Authenticated()
  async me(@Auth() auth: AuthDto) {
    const user = auth.user!;
    const memberships = await this.organizationRepository.listForUser(user.id);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin: user.isSuperAdmin,
      organizations: memberships.map(({ id, name, slug, role }) => ({ id, name, slug, role })),
    };
  }

  @Put('password')
  @Authenticated()
  changePassword(@Auth() auth: AuthDto, @Body() dto: ChangePasswordDto): Promise<void> {
    return this.authService.changePassword(auth, dto);
  }

  private setSessionCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: !this.configRepository.isDev(),
      maxAge: this.configRepository.getEnv().sessionTtlDays * 24 * 60 * 60 * 1000,
    });
  }
}
