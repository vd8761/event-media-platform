// Public surfaces — no session auth (docs/plan/09 §Public). The gallery token
// in the path IS the credential; PublicService hashes and resolves it.
import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { FileUploadInterceptor, SELFIE_UPLOAD_FIELD, getStagedUpload } from 'src/middleware/file-upload.interceptor';
import { PublicService } from 'src/services/public.service';
import { z } from 'zod';

export class SubmitSelfieDto extends createZodDto(
  z.object({
    email: z.string().email().max(320),
  }),
) {}

@ApiTags('Public')
@Controller('public')
export class PublicController {
  constructor(private publicService: PublicService) {}

  @Get('events/:slug')
  getEvent(@Param('slug') slug: string) {
    return this.publicService.getPublicEvent(slug);
  }

  @Post('events/:slug/participants')
  @HttpCode(202)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileUploadInterceptor)
  submitSelfie(@Param('slug') slug: string, @Body() dto: SubmitSelfieDto, @Req() request: Request) {
    return this.publicService.submitSelfie(
      slug,
      dto.email,
      getStagedUpload(request, SELFIE_UPLOAD_FIELD),
      request.ip ?? '',
    );
  }

  @Get('gallery/:token')
  getGallery(@Param('token') token: string) {
    return this.publicService.getGallery(token);
  }

  @Get('gallery/:token/assets/:assetId/download')
  async download(@Param('token') token: string, @Param('assetId') assetId: string, @Res() res: Response) {
    const url = await this.publicService.getGalleryDownloadUrl(token, assetId);
    res.redirect(302, url);
  }

  // "Download all" — streamed zip of matched originals (docs/plan/07 §4)
  @Get('gallery/:token/download')
  downloadAll(@Param('token') token: string, @Res() res: Response) {
    return this.publicService.streamGalleryZip(token, res);
  }
}
