import {
  IsEmail, IsOptional, IsString, MinLength,
  IsPhoneNumber, ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'Waseem Mushtaq' })
  @IsString()
  fullName: string;

  @ApiProperty({ example: 'FARMER' })
  @IsString()
  role: string;

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
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  // At least one of email or phone is required
}