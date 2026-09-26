import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ParseFilePipeBuilder,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiOperation } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../auth/user-role.enum';
import { AgroGuardTesterService } from './agroguard-tester.service';
import { InspectAgencyProductDto } from './dto/inspect-agency-product.dto';

/**
 * AgroGuard testing station — TESTER-only. Field testers scan agency-sold
 * pesticide/insecticide bottles and get an immediate genuine-vs-counterfeit
 * verdict against the industry golden reference, plus the authentic dosage.
 */
@ApiTags('AgroGuard Tester')
@ApiBearerAuth()
@Controller('tester')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TESTER)
export class AgroGuardTesterController {
  constructor(private readonly tester: AgroGuardTesterService) {}

  /**
   * POST /api/v1/tester/inspect — upload an agency bottle scan + dealer info and
   * get an immediate counterfeit-detection verdict.
   */
  @Post('inspect')
  @HttpCode(200)
  @ApiOperation({ summary: 'Inspect an agency pesticide bottle (TESTER)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('bottleImage'))
  async inspect(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /image\/(png|jpe?g|webp)/ })
        .addMaxSizeValidator({ maxSize: 10 * 1024 * 1024 }) // 10 MB
        .build({ fileIsRequired: false }),
    )
    bottleImage: Express.Multer.File | undefined,
    @Body() dto: InspectAgencyProductDto,
    @Req() req: any,
  ) {
    const testerProfileId = await this.tester.resolveTesterProfileId(req.user.sub);
    return this.tester.compareAgencyProduct(testerProfileId, { ...dto, bottleImage });
  }

  /** GET /api/v1/tester/history — past agency audits for this tester. */
  @Get('history')
  @ApiOperation({ summary: 'List past agency inspections (TESTER)' })
  async history(@Req() req: any) {
    const testerProfileId = await this.tester.resolveTesterProfileId(req.user.sub);
    return this.tester.getInspectionHistory(testerProfileId);
  }
}
