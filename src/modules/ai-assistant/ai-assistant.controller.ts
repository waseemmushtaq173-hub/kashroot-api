import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Req,
  ParseFilePipeBuilder,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiOperation } from '@nestjs/swagger';

import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../auth/user-role.enum';
import { AiAssistantService } from './ai-assistant.service';
import { VoiceQueryResponseDto } from './dto/voice-query-response.dto';

@ApiTags('AI Assistant')
@ApiBearerAuth()
@Controller('assistant')
export class AiAssistantController {
  constructor(private readonly assistant: AiAssistantService) {}

  /**
   * POST /api/v1/assistant/voice   (global prefix adds /api/v1)
   *
   * Voice-to-voice for the farmer app: the phone only records, uploads, and plays.
   * All ML runs server-side so low-end devices do no client-side processing.
   * Synchronous (HTTP 200) for the MVP — see AiAssistantService for the pipeline.
   */
  @Post('voice')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles(UserRole.FARMER)
  @ApiOperation({ summary: 'Voice-to-voice assistant query (FARMER)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('audio')) // memory storage; buffer handed to service
  async handleVoiceQuery(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /audio\/(mpeg|mp4|wav|webm|ogg|m4a)/ })
        .addMaxSizeValidator({ maxSize: 10 * 1024 * 1024 }) // 10 MB
        .build({ fileIsRequired: true }),
    )
    audio: Express.Multer.File,
    @Req() req: any,
  ): Promise<VoiceQueryResponseDto> {
    return this.assistant.handleVoiceQuery({
      userId: req.user.sub, // identity from the token, never the body
      audioBuffer: audio.buffer,
      mimeType: audio.mimetype,
    });
  }
}
