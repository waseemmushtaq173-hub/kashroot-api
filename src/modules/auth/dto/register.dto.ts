import {
  IsEmail, IsOptional, IsString, MinLength,
  IsPhoneNumber, ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiPropertyOptional({ example: 'farmer@example.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsPhoneNumber()
  @IsOptional()
  phone?: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  password: string;

  // At least one of email or phone is required
  // (enforced at service layer since class-validator can't express this cleanly)
}
