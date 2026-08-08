import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";

import { SupportedApi } from "../../../../api-visibility/api-visibility.decorator.js";
import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { SessionCsrfGuard } from "../../../../common/security/session-csrf.guard.js";
import { SessionRequired } from "../../../../common/security/session-required.decorator.js";
import {
  BuildTenantAuthorizationContextUseCase,
  TenantAuthorizationDeniedError,
} from "../../application/use-cases/build-tenant-authorization-context.use-case.js";
import { DemoteOwnerUseCase } from "../../application/use-cases/demote-owner.use-case.js";
import { ListMembershipsUseCase } from "../../application/use-cases/list-memberships.use-case.js";
import { PromoteOwnerUseCase } from "../../application/use-cases/promote-owner.use-case.js";
import { RevokeMembershipUseCase } from "../../application/use-cases/revoke-membership.use-case.js";
import { SuspendMembershipUseCase } from "../../application/use-cases/suspend-membership.use-case.js";
import {
  LastTenantOwnerError,
  MembershipInactiveError,
  MembershipRequiredError,
  RoleGrantNotAllowedError,
} from "../../domain/membership-errors.js";
import {
  TenantMembershipLifecycleMutationResponseDto,
  TenantMembershipResponseDto,
  TenantMembershipRoleMutationResponseDto,
} from "./tenant-memberships.dto.js";

function requireUuid(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
  ) {
    throw new BadRequestException("membershipId must be a UUID.");
  }
  return normalized;
}

@SupportedApi()
@ApiTags("memberships")
@UseGuards(SessionCsrfGuard)
@Controller("memberships")
export class TenantMembershipsController {
  constructor(
    @Inject(RequestContextStorage) private readonly requestContext: RequestContextStorage,
    @Inject(BuildTenantAuthorizationContextUseCase)
    private readonly authorization: BuildTenantAuthorizationContextUseCase,
    @Inject(ListMembershipsUseCase) private readonly listMemberships: ListMembershipsUseCase,
    @Inject(SuspendMembershipUseCase)
    private readonly suspendMembership: SuspendMembershipUseCase,
    @Inject(RevokeMembershipUseCase) private readonly revokeMembership: RevokeMembershipUseCase,
    @Inject(PromoteOwnerUseCase) private readonly promoteOwnerMembership: PromoteOwnerUseCase,
    @Inject(DemoteOwnerUseCase) private readonly demoteOwnerMembership: DemoteOwnerUseCase,
  ) {}

  @SessionRequired()
  @Get()
  @ApiOperation({ operationId: "listTenantMemberships" })
  @ApiOkResponse({ type: TenantMembershipResponseDto, isArray: true })
  async list() {
    try {
      const authenticated = this.requestContext.requireAuthenticated();
      return await this.listMemberships.execute({
        authorization: await this.authorization.execute(authenticated),
        requestId: authenticated.requestId,
      });
    } catch (error: unknown) {
      return this.mapError(error);
    }
  }

  @SessionRequired()
  @Post(":membershipId/suspend")
  @HttpCode(200)
  @ApiOperation({ operationId: "suspendTenantMembership" })
  @ApiParam({ name: "membershipId", type: String, format: "uuid" })
  @ApiOkResponse({ type: TenantMembershipLifecycleMutationResponseDto })
  async suspend(@Param("membershipId") membershipId: string) {
    return this.executeMutation(this.suspendMembership, membershipId);
  }

  @SessionRequired()
  @Post(":membershipId/revoke")
  @HttpCode(200)
  @ApiOperation({ operationId: "revokeTenantMembership" })
  @ApiParam({ name: "membershipId", type: String, format: "uuid" })
  @ApiOkResponse({ type: TenantMembershipLifecycleMutationResponseDto })
  async revoke(@Param("membershipId") membershipId: string) {
    return this.executeMutation(this.revokeMembership, membershipId);
  }

  @SessionRequired()
  @Post(":membershipId/promote-owner")
  @HttpCode(200)
  @ApiOperation({ operationId: "promoteTenantMembershipOwner" })
  @ApiParam({ name: "membershipId", type: String, format: "uuid" })
  @ApiOkResponse({ type: TenantMembershipRoleMutationResponseDto })
  async promoteOwner(@Param("membershipId") membershipId: string) {
    return this.executeMutation(this.promoteOwnerMembership, membershipId);
  }

  @SessionRequired()
  @Post(":membershipId/demote-owner")
  @HttpCode(200)
  @ApiOperation({ operationId: "demoteTenantMembershipOwner" })
  @ApiParam({ name: "membershipId", type: String, format: "uuid" })
  @ApiOkResponse({ type: TenantMembershipRoleMutationResponseDto })
  async demoteOwner(@Param("membershipId") membershipId: string) {
    return this.executeMutation(this.demoteOwnerMembership, membershipId);
  }

  private async executeMutation(
    useCase: {
      execute(command: {
        readonly authorization: Awaited<
          ReturnType<BuildTenantAuthorizationContextUseCase["execute"]>
        >;
        readonly membershipId: string;
        readonly requestId: string;
      }): Promise<unknown>;
    },
    membershipId: string,
  ) {
    const normalizedMembershipId = requireUuid(membershipId);
    try {
      const authenticated = this.requestContext.requireAuthenticated();
      return await useCase.execute({
        authorization: await this.authorization.execute(authenticated),
        membershipId: normalizedMembershipId,
        requestId: authenticated.requestId,
      });
    } catch (error: unknown) {
      return this.mapError(error);
    }
  }

  private mapError(error: unknown): never {
    if (
      error instanceof TenantAuthorizationDeniedError ||
      error instanceof RoleGrantNotAllowedError
    ) {
      throw new ForbiddenException("Tenant membership administration is required.");
    }
    if (error instanceof MembershipRequiredError) throw new NotFoundException();
    if (error instanceof MembershipInactiveError || error instanceof LastTenantOwnerError) {
      throw new ConflictException("Tenant membership mutation conflicts with current state.");
    }
    throw error;
  }
}
