import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Req,
  ParseFilePipeBuilder,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiOperation } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ExpertKycService } from './expert-kyc.service';
import { UploadKycDto } from './dto/upload-kyc.dto';

@ApiTags('Expert KYC')
@ApiBearerAuth()
@Controller('experts/kyc')
export class ExpertKycController {
  constructor(private readonly kyc: ExpertKycService) {}

  /**
   * POST /api/v1/experts/kyc/upload   (global prefix adds /api/v1)
   * Accepts one credential document (PDF/JPEG/PNG) for the authenticated expert.
   */
  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Upload an expert credential document' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('document'))
  async upload(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(application\/pdf|image\/(jpeg|png))/ })
        .addMaxSizeValidator({ maxSize: 10 * 1024 * 1024 }) // 10 MB
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @Body() dto: UploadKycDto,
    @Req() req: any,
  ) {
    return this.kyc.uploadKycDocument({
      userId: req.user.sub, // identity from the token, never the body
      documentType: dto.documentType,
      file,
    });
  }
}
