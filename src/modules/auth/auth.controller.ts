import {
  Controller, Post, Get, Body, Res, Req, UseGuards,
  HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthenticatedUser } from '../../common/types/request-with-user.type';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email/phone OTP' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Public()
  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-send the email/phone verification OTP' })
  async resendOtp(@Body() body: { email?: string; phone?: string }) {
    const target = body?.email ?? body?.phone;
    if (!target) throw new BadRequestException('email or phone is required');

    await this.authService.sendOtp(target);

    // The response is identical whether or not the account exists: this route is
    // public, so it must not become an account-enumeration oracle.
    return { message: 'If the account exists, a new code has been sent.' };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset instructions' })
  forgotPassword(@Body('email') email: string) {
    return this.authService.forgotPassword(email);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login — returns access token + sets refresh cookie' })
  login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.authService.login(dto, { ip, userAgent }, res);
  }

  @UseGuards(AuthGuard('jwt-refresh'))
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token' })
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = req.user as { sub: string; refreshTokenId: string };
    return this.authService.refresh(user.sub, user.refreshTokenId, res);
  }

  @UseGuards(AuthGuard('jwt-refresh'))
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke current device refresh token' })
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = req.user as { sub: string; refreshTokenId: string };
    return this.authService.logout(user.refreshTokenId, res);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke all refresh tokens (all devices)' })
  logoutAll(@CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) res: Response) {
    return this.authService.logoutAll(user.sub, res);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Get current authenticated user' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('mfa/setup')
  @ApiOperation({ summary: 'Generate TOTP secret + otpauth URL for QR code' })
  setupMfa(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.setupMfa(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('mfa/verify-setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm TOTP code to activate MFA' })
  verifyMfaSetup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { totpCode: string },
  ) {
    return this.authService.verifyMfaSetup(user.sub, body.totpCode);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('mfa/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable MFA (requires current TOTP code)' })
  disableMfa(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { totpCode: string },
  ) {
    return this.authService.disableMfa(user.sub, body.totpCode);
  }

  @Public()
  @Get('oauth/google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Redirect to Google OAuth (buyers only)' })
  googleAuth() {}

  @Public()
  @Get('oauth/google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth callback' })
  googleCallback(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken } = req.user as { accessToken: string };
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/auth/oauth-success?token=${accessToken}`);
  }
}