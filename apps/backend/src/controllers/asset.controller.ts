import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AssetJobDto, AssetListQueryDto, BulkUploadCheckDto, DeleteAssetsDto } from 'src/dtos/asset.dto';
import { OrgRole } from 'src/enum';
import { FileUploadInterceptor, getStagedUpload } from 'src/middleware/file-upload.interceptor';
import { Authenticated } from 'src/middleware/auth.guard';
import { AssetService } from 'src/services/asset.service';
import { UploadService } from 'src/services/upload.service';
import { BadRequestException } from '@nestjs/common';

@ApiTags('Assets')
@Controller('events/:eventId/assets')
export class AssetController {
  constructor(
    private assetService: AssetService,
    private uploadService: UploadService,
  ) {}

  @Post()
  @Authenticated({ orgRole: OrgRole.Member })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileUploadInterceptor)
  async upload(@Param('eventId') eventId: string, @Req() request: Request, @Res() res: Response) {
    const staged = getStagedUpload(request);
    if (!staged) {
      throw new BadRequestException('Missing assetData file');
    }
    const result = await this.uploadService.uploadAsset(eventId, staged);
    // 200 duplicate / 201 created (Immich DUPLICATE response pattern)
    res.status(result.status === 'duplicate' ? 200 : 201).json(result);
  }

  @Post('bulk-upload-check')
  @HttpCode(200)
  @Authenticated({ orgRole: OrgRole.Member })
  bulkUploadCheck(@Param('eventId') eventId: string, @Body() dto: BulkUploadCheckDto) {
    return this.uploadService.bulkUploadCheck(eventId, dto.assets);
  }

  @Get()
  @Authenticated({ orgRole: OrgRole.Member })
  list(@Param('eventId') eventId: string, @Query() query: AssetListQueryDto) {
    return this.assetService.list(eventId, query.limit, query.cursor);
  }

  @Get(':assetId')
  @Authenticated({ orgRole: OrgRole.Member })
  get(@Param('eventId') eventId: string, @Param('assetId') assetId: string) {
    return this.assetService.get(eventId, assetId);
  }

  @Get(':assetId/download')
  @Authenticated({ orgRole: OrgRole.Member })
  async download(@Param('eventId') eventId: string, @Param('assetId') assetId: string, @Res() res: Response) {
    const url = await this.assetService.getDownloadUrl(eventId, assetId);
    res.redirect(302, url);
  }

  @Delete()
  @HttpCode(200)
  @Authenticated({ orgRole: OrgRole.Admin })
  deleteMany(@Param('eventId') eventId: string, @Body() dto: DeleteAssetsDto) {
    return this.assetService.deleteMany(eventId, dto.ids);
  }

  @Post(':assetId/jobs')
  @HttpCode(204)
  @Authenticated({ orgRole: OrgRole.Admin })
  runJob(@Param('eventId') eventId: string, @Param('assetId') assetId: string, @Body() dto: AssetJobDto) {
    return this.assetService.runJob(eventId, assetId, dto);
  }
}
