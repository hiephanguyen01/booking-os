import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";

import { SupportedApi } from "../../../../api-visibility/api-visibility.decorator.js";
import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { SessionCsrfGuard } from "../../../../common/security/session-csrf.guard.js";
import { SessionRequired } from "../../../../common/security/session-required.decorator.js";
import { MembershipInactiveError, MembershipRequiredError } from "../../../memberships/domain/membership-errors.js";
import { CurrentAuthorizationContext, PermissionGuard, RequiresPermission } from "../../authorization.http.js";
import { ArchiveTenantCustomRoleUseCase } from "../../application/use-cases/tenant-rbac/archive-tenant-custom-role.use-case.js";
import { CreateTenantCustomRoleUseCase } from "../../application/use-cases/tenant-rbac/create-tenant-custom-role.use-case.js";
import { GetTenantCustomRoleUseCase } from "../../application/use-cases/tenant-rbac/get-tenant-custom-role.use-case.js";
import { GrantMembershipCustomRoleUseCase } from "../../application/use-cases/tenant-rbac/grant-membership-custom-role.use-case.js";
import { ListMembershipCustomRolesUseCase } from "../../application/use-cases/tenant-rbac/list-membership-custom-roles.use-case.js";
import { ListTenantCustomRolesUseCase } from "../../application/use-cases/tenant-rbac/list-tenant-custom-roles.use-case.js";
import { ListTenantPermissionsUseCase } from "../../application/use-cases/tenant-rbac/list-tenant-permissions.use-case.js";
import { ReplaceTenantCustomRolePermissionsUseCase } from "../../application/use-cases/tenant-rbac/replace-tenant-custom-role-permissions.use-case.js";
import { RevokeMembershipCustomRoleUseCase } from "../../application/use-cases/tenant-rbac/revoke-membership-custom-role.use-case.js";
import { UpdateTenantCustomRoleUseCase } from "../../application/use-cases/tenant-rbac/update-tenant-custom-role.use-case.js";
import {
  TenantCustomRoleArchivedError,
  TenantCustomRoleNameConflictError,
  TenantCustomRoleNameInvalidError,
  TenantCustomRoleNotFoundError,
  TenantCustomRoleVersionConflictError,
  TenantRbacAssignmentNotAllowedError,
  TenantRbacAssignmentNotFoundError,
  TenantRbacError,
  TenantRbacPermissionGrantNotAllowedError,
  TenantRbacPermissionNotDelegableError,
  TenantRbacPermissionScopeInvalidError,
  TenantRbacPermissionUnknownError,
} from "../../domain/tenant-rbac/tenant-rbac.errors.js";
import {
  ArchiveTenantCustomRoleRequestDto,
  CreateTenantCustomRoleRequestDto,
  ReplaceTenantCustomRolePermissionsRequestDto,
  TenantCustomRoleAssignmentResponseDto,
  TenantCustomRoleResponseDto,
  TenantRbacPermissionResponseDto,
  UpdateTenantCustomRoleRequestDto,
} from "./tenant-rbac.dto.js";

function requireUuid(value: unknown, field: "roleId" | "membershipId"): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
  ) {
    throw new BadRequestException({
      code: "INVALID_UUID",
      message: `${field} must be a UUID.`,
    });
  }
  return normalized;
}

function requireExpectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new BadRequestException({
      code: "INVALID_EXPECTED_VERSION",
      message: "expectedVersion must be a positive integer.",
    });
  }
  return value as number;
}

function safeErrorBody(error: TenantRbacError, message: string) {
  return { code: error.code, message };
}

@SupportedApi()
@ApiTags("tenant-rbac")
@UseGuards(SessionCsrfGuard, PermissionGuard)
@Controller("tenant/rbac")
export class TenantRbacController {
  constructor(
    @Inject(RequestContextStorage) private readonly requestContext: RequestContextStorage,
    @Inject(ListTenantPermissionsUseCase)
    private readonly listTenantPermissions: ListTenantPermissionsUseCase,
    @Inject(ListTenantCustomRolesUseCase)
    private readonly listTenantCustomRoles: ListTenantCustomRolesUseCase,
    @Inject(CreateTenantCustomRoleUseCase)
    private readonly createTenantCustomRole: CreateTenantCustomRoleUseCase,
    @Inject(GetTenantCustomRoleUseCase)
    private readonly getTenantCustomRole: GetTenantCustomRoleUseCase,
    @Inject(UpdateTenantCustomRoleUseCase)
    private readonly updateTenantCustomRole: UpdateTenantCustomRoleUseCase,
    @Inject(ReplaceTenantCustomRolePermissionsUseCase)
    private readonly replaceTenantCustomRolePermissions: ReplaceTenantCustomRolePermissionsUseCase,
    @Inject(ArchiveTenantCustomRoleUseCase)
    private readonly archiveTenantCustomRole: ArchiveTenantCustomRoleUseCase,
    @Inject(ListMembershipCustomRolesUseCase)
    private readonly listMembershipCustomRoles: ListMembershipCustomRolesUseCase,
    @Inject(GrantMembershipCustomRoleUseCase)
    private readonly grantMembershipCustomRole: GrantMembershipCustomRoleUseCase,
    @Inject(RevokeMembershipCustomRoleUseCase)
    private readonly revokeMembershipCustomRole: RevokeMembershipCustomRoleUseCase,
  ) {}

  @SessionRequired()
  @RequiresPermission(PERMISSION_KEYS.tenantRbacPermissionRead)
  @Get("permissions")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ operationId: "listTenantRbacPermissions" })
  @ApiOkResponse({ type: TenantRbacPermissionResponseDto, isArray: true })
  async listPermissions(@CurrentAuthorizationContext() authorization: AuthorizationContext) {
    try {
      return await this.listTenantPermissions.execute({ authorization });
    } catch (error: unknown) {
      return this.mapError(error);
    }
  }

  @SessionRequired()
  @RequiresPermission(PERMISSION_KEYS.tenantRbacRoleRead)
  @Get("roles")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ operationId: "listTenantRbacRoles" })
  @ApiOkResponse({ type: TenantCustomRoleResponseDto, isArray: true })
  async listRoles(@CurrentAuthorizationContext() authorization: AuthorizationContext) {
    try {
      return await this.listTenantCustomRoles.execute({ authorization });
    } catch (error: unknown) {
      return this.mapError(error);
    }
  }

  @SessionRequired()
  @RequiresPermission(PERMISSION_KEYS.tenantRbacRoleCreate)
  @Post("roles")
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ operationId: "createTenantRbacRole" })
  @ApiOkResponse({ type: TenantCustomRoleResponseDto })
  async createRole(
    @Body() body: CreateTenantCustomRoleRequestDto,
    @CurrentAuthorizationContext() authorization: AuthorizationContext,
  ) {
    try {
      const authenticated = this.requestContext.requireAuthenticated();
      return await this.createTenantCustomRole.execute({
        authorization,
        name: body.name,
        description: body.description,
        permissionKeys: body.permissionKeys,
        requestId: authenticated.requestId,
        now: new Date(),
      });
    } catch (error: unknown) {
      return this.mapError(error);
    }
  }

  @SessionRequired()
  @RequiresPermission(PERMISSION_KEYS.tenantRbacRoleRead)
  @Get("roles/:roleId")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ operationId: "getTenantRbacRole" })
  @ApiParam({ name: "roleId", type: String, format: "uuid" })
  @ApiOkResponse({ type: TenantCustomRoleResponseDto })
  async getRole(
    @Param("roleId") roleId: string,
    @CurrentAuthorizationContext() authorization: AuthorizationContext,
  ) {
    try {
      return await this.getTenantCustomRole.execute({
        authorization,
        roleId: requireUuid(roleId, "roleId"),
      });
    } catch (error: unknown) {
      return this.mapError(error);
    }
  }

  @SessionRequired()
  @RequiresPermission(PERMISSION_KEYS.tenantRbacRoleUpdate)
  @Patch("roles/:roleId")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ operationId: "updateTenantRbacRole" })
  @ApiParam({ name: "roleId", type: String, format: "uuid" })
  @ApiOkResponse({ type: TenantCustomRoleResponseDto })
  async updateRole(
    @Param("roleId") roleId: string,
    @Body() body: UpdateTenantCustomRoleRequestDto,
    @CurrentAuthorizationContext() authorization: AuthorizationContext,
  ) {
    try {
      const authenticated = this.requestContext.requireAuthenticated();
      return await this.updateTenantCustomRole.execute({
        authorization,
        roleId: requireUuid(roleId, "roleId"),
        name: body.name,
        description: body.description,
        expectedVersion: requireExpectedVersion(body.expectedVersion),
        requestId: authenticated.requestId,
        now: new Date(),
      });
    } catch (error: unknown) {
      return this.mapError(error);
    }
  }

  @SessionRequired()
  @RequiresPermission(PERMISSION_KEYS.tenantRbacRolePermissionGrant)
  @Put("roles/:roleId/permissions")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ operationId: "replaceTenantRbacRolePermissions" })
  @ApiParam({ name: "roleId", type: String, format: "uuid" })
  @ApiOkResponse({ type: TenantCustomRoleResponseDto })
  async replaceRolePermissions(
    @Param("roleId") roleId: string,
    @Body() body: ReplaceTenantCustomRolePermissionsRequestDto,
    @CurrentAuthorizationContext() authorization: AuthorizationContext,
  ) {
    try {
      const authenticated = this.requestContext.requireAuthenticated();
      return await this.replaceTenantCustomRolePermissions.execute({
        authorization,
        roleId: requireUuid(roleId, "roleId"),
        permissionKeys: body.permissionKeys,
        expectedVersion: requireExpectedVersion(body.expectedVersion),
        requestId: authenticated.requestId,
        now: new Date(),
      });
    } catch (error: unknown) {
      return this.mapError(error);
    }
  }

  @SessionRequired()
  @RequiresPermission(PERMISSION_KEYS.tenantRbacRoleArchive)
  @Delete("roles/:roleId")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ operationId: "archiveTenantRbacRole" })
  @ApiParam({ name: "roleId", type: String, format: "uuid" })
  @ApiOkResponse({ type: TenantCustomRoleResponseDto })
  async archiveRole(
    @Param("roleId") roleId: string,
    @Body() body: ArchiveTenantCustomRoleRequestDto,
    @CurrentAuthorizationContext() authorization: AuthorizationContext,
  ) {
    try {
      const authenticated = this.requestContext.requireAuthenticated();
      return await this.archiveTenantCustomRole.execute({
        authorization,
        roleId: requireUuid(roleId, "roleId"),
        expectedVersion: requireExpectedVersion(body.expectedVersion),
        requestId: authenticated.requestId,
        now: new Date(),
      });
    } catch (error: unknown) {
      return this.mapError(error);
    }
  }

  @SessionRequired()
  @RequiresPermission(PERMISSION_KEYS.tenantRbacAssignmentRead)
  @Get("memberships/:membershipId/roles")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ operationId: "listTenantMembershipRbacRoles" })
  @ApiParam({ name: "membershipId", type: String, format: "uuid" })
  @ApiOkResponse({ type: TenantCustomRoleResponseDto, isArray: true })
  async listMembershipRoles(
    @Param("membershipId") membershipId: string,
    @CurrentAuthorizationContext() authorization: AuthorizationContext,
  ) {
    try {
      return await this.listMembershipCustomRoles.execute({
        authorization,
        membershipId: requireUuid(membershipId, "membershipId"),
      });
    } catch (error: unknown) {
      return this.mapError(error);
    }
  }

  @SessionRequired()
  @RequiresPermission(PERMISSION_KEYS.tenantRbacAssignmentGrant)
  @Post("memberships/:membershipId/roles/:roleId")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ operationId: "grantTenantMembershipRbacRole" })
  @ApiParam({ name: "membershipId", type: String, format: "uuid" })
  @ApiParam({ name: "roleId", type: String, format: "uuid" })
  @ApiOkResponse({ type: TenantCustomRoleAssignmentResponseDto })
  async grantMembershipRole(
    @Param("membershipId") membershipId: string,
    @Param("roleId") roleId: string,
    @CurrentAuthorizationContext() authorization: AuthorizationContext,
  ) {
    try {
      const authenticated = this.requestContext.requireAuthenticated();
      return await this.grantMembershipCustomRole.execute({
        authorization,
        membershipId: requireUuid(membershipId, "membershipId"),
        roleId: requireUuid(roleId, "roleId"),
        requestId: authenticated.requestId,
        now: new Date(),
      });
    } catch (error: unknown) {
      return this.mapError(error);
    }
  }

  @SessionRequired()
  @RequiresPermission(PERMISSION_KEYS.tenantRbacAssignmentRevoke)
  @Delete("memberships/:membershipId/roles/:roleId")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ operationId: "revokeTenantMembershipRbacRole" })
  @ApiParam({ name: "membershipId", type: String, format: "uuid" })
  @ApiParam({ name: "roleId", type: String, format: "uuid" })
  @ApiOkResponse({ type: Boolean })
  async revokeMembershipRole(
    @Param("membershipId") membershipId: string,
    @Param("roleId") roleId: string,
    @CurrentAuthorizationContext() authorization: AuthorizationContext,
  ) {
    try {
      const authenticated = this.requestContext.requireAuthenticated();
      return await this.revokeMembershipCustomRole.execute({
        authorization,
        membershipId: requireUuid(membershipId, "membershipId"),
        roleId: requireUuid(roleId, "roleId"),
        requestId: authenticated.requestId,
        now: new Date(),
      });
    } catch (error: unknown) {
      return this.mapError(error);
    }
  }

  private mapError(error: unknown): never {
    if (error instanceof TenantCustomRoleVersionConflictError) {
      throw new ConflictException(safeErrorBody(error, "Tenant custom role version conflict."));
    }
    if (
      error instanceof TenantCustomRoleNotFoundError ||
      error instanceof TenantRbacAssignmentNotFoundError
    ) {
      throw new NotFoundException(safeErrorBody(error, "Tenant RBAC resource was not found."));
    }
    if (error instanceof MembershipRequiredError) {
      throw new NotFoundException({
        code: "MEMBERSHIP_REQUIRED",
        message: "Tenant membership was not found.",
      });
    }
    if (
      error instanceof TenantRbacPermissionGrantNotAllowedError ||
      error instanceof TenantRbacAssignmentNotAllowedError
    ) {
      throw new ForbiddenException(safeErrorBody(error, "Tenant RBAC mutation is not allowed."));
    }
    if (
      error instanceof TenantCustomRoleNameInvalidError ||
      error instanceof TenantRbacPermissionUnknownError ||
      error instanceof TenantRbacPermissionScopeInvalidError ||
      error instanceof TenantRbacPermissionNotDelegableError
    ) {
      throw new BadRequestException(safeErrorBody(error, "Tenant RBAC input is invalid."));
    }
    if (
      error instanceof TenantCustomRoleNameConflictError ||
      error instanceof TenantCustomRoleArchivedError
    ) {
      throw new ConflictException(safeErrorBody(error, "Tenant RBAC resource conflicts with current state."));
    }
    if (error instanceof MembershipInactiveError) {
      throw new ConflictException({
        code: "MEMBERSHIP_INACTIVE",
        message: "Tenant membership is inactive.",
      });
    }
    throw error;
  }
}
