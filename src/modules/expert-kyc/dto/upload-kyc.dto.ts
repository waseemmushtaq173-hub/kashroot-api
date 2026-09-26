import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Text fields accompanying the multipart credential upload.
 * The file itself arrives via FileInterceptor, not this DTO.
 */
export class UploadKycDto {
  @ApiProperty({ example: 'DEGREE', description: "e.g. 'DEGREE', 'GOVT_ID'" })
  @IsString()
  @IsNotEmpty()
  documentType: string;
}
