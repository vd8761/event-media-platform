// Public surfaces — no session auth (docs/plan/09 §Public). The gallery token
// in the path IS the credential; PublicService hashes and resolves it.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { FileUploadInterceptor, SELFIE_UPLOAD_FIELD, getStagedUploads } from 'src/middleware/file-upload.interceptor';
import { PublicService } from 'src/services/public.service';
import { z } from 'zod';

export class SubmitSelfieDto extends createZodDto(
  z.object({
    email: z.string().email().max(320),
    // required: it labels their face for everyone viewing the photos
    name: z.string().trim().min(1).max(200),
    // Optional fallback contact when an email bounces. Kept loose on purpose —
    // international formats vary too much to validate usefully here.
    phone: z.string().trim().min(4).max(32).optional(),
  }),
) {}

export class GalleryZipDto extends createZodDto(
  z.object({
    // omitted/empty = every photo matched to this participant
    ids: z.array(z.string().uuid()).max(1000).optional(),
  }),
) {}


export class GalleryAssetsQueryDto extends createZodDto(
  z.object({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    cursor: z.string().optional(),
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
      dto.name,
      dto.phone,
      getStagedUploads(request, SELFIE_UPLOAD_FIELD),
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

  // Multi-select download: same stream, narrowed to the chosen photos.
  @Post('gallery/:token/download')
  downloadSelection(@Param('token') token: string, @Body() dto: GalleryZipDto, @Res() res: Response) {
    return this.publicService.streamGalleryZip(token, res, dto.ids);
  }

  // Whole-event gallery — 404s unless the organiser shared it.
  @Get('gallery/:token/event-assets')
  getEventAssets(@Param('token') token: string, @Query() query: GalleryAssetsQueryDto) {
    return this.publicService.getEventGallery(token, query.limit, query.cursor);
  }

  // Face boxes for the viewer overlay.
  @Get('gallery/:token/assets/:assetId/faces')
  getAssetFaces(@Param('token') token: string, @Param('assetId') assetId: string) {
    return this.publicService.getGalleryAssetFaces(token, assetId);
  }

  // Photos of one person — only when the organiser shares the whole event.
  @Get('gallery/:token/people/:personId')
  getPerson(@Param('token') token: string, @Param('personId') personId: string) {
    return this.publicService.getPersonGallery(token, personId);
  }
}
