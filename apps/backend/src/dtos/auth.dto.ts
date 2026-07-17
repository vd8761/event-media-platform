import { createZodDto } from 'nestjs-zod';
import { Participant, Session, User } from 'src/schema';
import { z } from 'zod';

export class LoginDto extends createZodDto(
  z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
) {}

// First-boot only: creates the initial super admin while the user table is empty.
export class AdminSignupDto extends createZodDto(
  z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
  }),
) {}

export class ChangePasswordDto extends createZodDto(
  z.object({
    password: z.string().min(1),
    newPassword: z.string().min(8),
  }),
) {}

// Runtime auth context attached to the request by the AuthGuard.
export interface AuthDto {
  user?: User;
  session?: Session;
  participant?: Participant;
}

export interface LoginDetails {
  clientIp: string;
  isSecure: boolean;
  deviceOs: string;
  deviceType: string;
}

export interface LoginResponseDto {
  userId: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  accessToken: string;
}
