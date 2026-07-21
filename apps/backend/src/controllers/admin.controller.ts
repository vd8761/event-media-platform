import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AuditFlushDto,
  AuditQueryDto,
  EventRetentionDto,
  GpuAutostartDto,
  GpuHoldDto,
  UpdatePlanDto,
} from 'src/dtos/admin.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { CreateOrgDto, UpdateOrgDto } from 'src/dtos/org.dto';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { AdminService, QueueAction } from 'src/services/admin.service';
import { AuditLogService } from 'src/services/audit-log.service';
import { GpuLifecycleService } from 'src/services/gpu-lifecycle.service';
import { OrganizationService } from 'src/services/organization.service';

@ApiTags('Super Admin')
@Controller('admin')
export class AdminController {
  constructor(
    private adminService: AdminService,
    private auditLogService: AuditLogService,
    private gpuLifecycleService: GpuLifecycleService,
    private organizationService: OrganizationService,
  ) {}

  @Get('organizations')
  @Authenticated({ superAdmin: true })
  listOrganizations() {
    return this.organizationService.list();
  }

  @Post('organizations')
  @Authenticated({ superAdmin: true })
  createOrganization(@Auth() auth: AuthDto, @Body() dto: CreateOrgDto) {
    return this.organizationService.create(dto, auth.user!.id);
  }

  @Get('organizations/:orgId')
  @Authenticated({ superAdmin: true })
  getOrganization(@Param('orgId') orgId: string) {
    return this.organizationService.get(orgId);
  }

  @Put('organizations/:orgId')
  @Authenticated({ superAdmin: true })
  updateOrganization(@Param('orgId') orgId: string, @Body() dto: UpdateOrgDto) {
    return this.organizationService.update(orgId, dto);
  }

  @Delete('organizations/:orgId')
  @HttpCode(204)
  @Authenticated({ superAdmin: true })
  removeOrganization(@Param('orgId') orgId: string) {
    return this.organizationService.remove(orgId);
  }

  // Plan and, for Enterprise, the negotiated limits.
  @Put('organizations/:orgId/plan')
  @Authenticated({ superAdmin: true })
  updatePlan(@Auth() auth: AuthDto, @Param('orgId') orgId: string, @Body() dto: UpdatePlanDto) {
    return this.organizationService.updatePlan(orgId, dto, auth.user!.id);
  }

  @Get('stats')
  @Authenticated({ superAdmin: true })
  getStats() {
    return this.adminService.getStats();
  }

  @Get('queues')
  @Authenticated({ superAdmin: true })
  getQueues() {
    return this.adminService.getQueues();
  }

  @Get('jobs')
  @Authenticated({ superAdmin: true })
  getJobs() {
    return this.adminService.getJobs();
  }

  @Get('queues/:name/failed')
  @Authenticated({ superAdmin: true })
  getFailedJobs(@Param('name') name: string) {
    return this.adminService.getFailedJobs(name);
  }

  @Get('system')
  @Authenticated({ superAdmin: true })
  getSystemStatus() {
    return this.adminService.getSystemStatus();
  }

  // --- GPU box lifecycle ---

  @Get('gpu')
  @Authenticated({ superAdmin: true })
  getGpuStatus() {
    return this.gpuLifecycleService.getStatus();
  }

  @Put('gpu/config')
  @Authenticated({ superAdmin: true })
  updateGpuConfig(@Body() dto: GpuAutostartDto) {
    return this.adminService.updateGpuAutostart(dto);
  }

  // "Process all" — wake the box now, ignoring the thresholds.
  @Post('gpu/start')
  @Authenticated({ superAdmin: true })
  startGpu(@Auth() auth: AuthDto) {
    return this.gpuLifecycleService.startNow(`manual start by ${auth.user!.email}`);
  }

  // Pause the idle-shutdown timer. Does not start the box — "do not shut down"
  // is a different request from "turn on", and turning on costs money.
  @Post('gpu/hold')
  @Authenticated({ superAdmin: true })
  holdGpu(@Auth() auth: AuthDto, @Body() dto: GpuHoldDto) {
    return this.gpuLifecycleService.holdIdle(dto.minutes, auth.user!.id);
  }

  @Delete('gpu/hold')
  @Authenticated({ superAdmin: true })
  clearGpuHold(@Auth() auth: AuthDto) {
    return this.gpuLifecycleService.clearHold(auth.user!.id);
  }

  @Post('gpu/stop')
  @Authenticated({ superAdmin: true })
  stopGpu(@Auth() auth: AuthDto) {
    return this.gpuLifecycleService.stopNow(`manual stop by ${auth.user!.email}`);
  }

  // Read-only provider check — for JarvisLabs this runs `jl get`, proving the
  // binary, API key and instance id all work before autostart depends on them.
  @Post('gpu/test')
  @HttpCode(200)
  @Authenticated({ superAdmin: true })
  testGpuProvider() {
    return this.gpuLifecycleService.testProvider();
  }

  @Put('retention')
  @Authenticated({ superAdmin: true })
  updateRetention(@Body() dto: EventRetentionDto) {
    return this.adminService.updateEventRetention(dto);
  }

  // Newest first. The page polls with `after` set to the newest row it holds,
  // which is what makes the live tail cheap — an idle poll returns [].
  @Get('audit')
  @Authenticated({ superAdmin: true })
  listAudit(@Query() query: AuditQueryDto) {
    return this.auditLogService.list(query);
  }

  @Get('audit/summary')
  @Authenticated({ superAdmin: true })
  auditSummary() {
    return this.auditLogService.getSummary();
  }

  @Post('audit/flush')
  @Authenticated({ superAdmin: true })
  flushAudit(@Auth() auth: AuthDto, @Body() dto: AuditFlushDto) {
    return this.auditLogService
      .flush(dto.retention, auth.user!.id)
      .then((removed) => ({ removed }));
  }

  @Post('queues/:name/:action')
  @HttpCode(204)
  @Authenticated({ superAdmin: true })
  runQueueAction(@Param('name') name: string, @Param('action') action: QueueAction) {
    return this.adminService.runQueueAction(name, action);
  }
}
