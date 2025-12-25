import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Request,
  HttpStatus,
  HttpCode,
  SerializeOptions,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiOperation,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiUnprocessableEntityResponse,
  ApiQuery,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { AuthGuard } from '@nestjs/passport';

import {
  InfinityPaginationResponse,
  InfinityPaginationResponseDto,
} from '../utils/dto/infinity-pagination-response.dto';
import { NullableType } from '../utils/types/nullable.type';
import { QueryUserDto } from './dto/query-user.dto';
import { User } from './domain/user';
import { UsersService } from './users.service';
import { RolesGuard } from '../roles/roles.guard';
import { infinityPagination } from '../utils/infinity-pagination';
import { UserManagerAssignmentService } from './domain/services/user-manager-assignment.service';
import { CreateUserManagerAssignmentDto } from './dto/create-user-manager-assignment.dto';
import { UserManagerAssignmentResponseDto } from './dto/user-manager-assignment-response.dto';
import { UserManagerAssignment } from './domain/entities/user-manager-assignment.entity';
import { plainToClass } from 'class-transformer';

@ApiBearerAuth()
@Roles(RoleEnum.admin)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiTags('Users')
@Controller({
  path: 'users',
  version: '1',
})
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly userManagerAssignmentService: UserManagerAssignmentService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create User (Admin Only)',
    description:
      'Create a new user account. This endpoint is restricted to administrators only.',
  })
  @ApiCreatedResponse({
    type: User,
    description: 'User created successfully',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request body or validation errors',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Email already exists or invalid data',
  })
  @SerializeOptions({
    groups: ['admin'],
  })
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createProfileDto: CreateUserDto): Promise<User> {
    return this.usersService.create(createProfileDto);
  }

  @Get()
  @ApiOperation({
    summary: 'List Users (Admin Only)',
    description:
      'Get a paginated list of all users with optional filtering and sorting. ' +
      'Maximum 50 items per page. This endpoint is restricted to administrators only.',
  })
  @ApiOkResponse({
    type: InfinityPaginationResponse(User),
    description: 'Paginated list of users',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10, max: 50)',
    example: 10,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
  })
  @SerializeOptions({
    groups: ['admin'],
  })
  @HttpCode(HttpStatus.OK)
  async findAll(
    @Query() query: QueryUserDto,
  ): Promise<InfinityPaginationResponseDto<User>> {
    const page = query?.page ?? 1;
    let limit = query?.limit ?? 10;
    if (limit > 50) {
      limit = 50;
    }

    return infinityPagination(
      await this.usersService.findManyWithPagination({
        filterOptions: query?.filters,
        sortOptions: query?.sort,
        paginationOptions: {
          page,
          limit,
        },
      }),
      { page, limit },
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get User by ID (Admin Only)',
    description:
      'Get detailed information about a specific user by ID. This endpoint is restricted to administrators only.',
  })
  @ApiOkResponse({
    type: User,
    description: 'User information',
  })
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'User ID',
    example: '123',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'User not found',
  })
  @SerializeOptions({
    groups: ['admin'],
  })
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id') id: User['id']): Promise<NullableType<User>> {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update User (Admin Only)',
    description:
      'Update user information by ID. This endpoint is restricted to administrators only.',
  })
  @ApiOkResponse({
    type: User,
    description: 'Updated user information',
  })
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'User ID',
    example: '123',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request body or validation errors',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'User not found',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Email already exists or invalid data',
  })
  @SerializeOptions({
    groups: ['admin'],
  })
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id') id: User['id'],
    @Body() updateProfileDto: UpdateUserDto,
  ): Promise<User | null> {
    return this.usersService.update(id, updateProfileDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete User (Admin Only)',
    description:
      'Delete a user account by ID. This endpoint is restricted to administrators only.',
  })
  @ApiNoContentResponse({
    description: 'User deleted successfully',
  })
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'User ID',
    example: '123',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'User not found',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: User['id']): Promise<void> {
    return this.usersService.remove(id);
  }

  // ============================================
  // Manager Assignment Endpoints
  // ============================================

  @Post(':userId/manager-assignments')
  @ApiOperation({
    summary: 'Assign User to Manager (Admin Only)',
    description:
      'Create a user-manager assignment relationship. This endpoint is restricted to administrators only.',
  })
  @ApiCreatedResponse({
    type: UserManagerAssignmentResponseDto,
    description: 'Assignment created successfully',
  })
  @ApiParam({
    name: 'userId',
    type: Number,
    required: true,
    description: 'User ID',
    example: 456,
  })
  @ApiBadRequestResponse({
    description: 'Invalid manager/user, duplicate assignment, or self-assignment',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'User or manager not found',
  })
  @HttpCode(HttpStatus.CREATED)
  async createManagerAssignment(
    @Param('userId', { transform: (value) => parseInt(value, 10) })
    userId: number,
    @Body() dto: Omit<CreateUserManagerAssignmentDto, 'userId'>,
    @Request() req: Request & { user: { id: number } },
  ): Promise<UserManagerAssignmentResponseDto> {
    // userId comes from path parameter, managerId from body
    const assignmentDto: CreateUserManagerAssignmentDto = {
      userId,
      managerId: dto.managerId,
    };
    const assignment = await this.userManagerAssignmentService.assignUserToManager(
      assignmentDto,
      req.user.id,
    );
    return this.toAssignmentResponseDto(assignment);
  }

  @Get(':userId/manager-assignments')
  @ApiOperation({
    summary: 'List Manager Assignments for User (Admin Only)',
    description:
      'Get all manager assignments for a specific user. This endpoint is restricted to administrators only.',
  })
  @ApiOkResponse({
    type: [UserManagerAssignmentResponseDto],
    description: 'List of manager assignments',
  })
  @ApiParam({
    name: 'userId',
    type: Number,
    required: true,
    description: 'User ID',
    example: 456,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'User not found',
  })
  @HttpCode(HttpStatus.OK)
  async getManagerAssignments(
    @Param('userId', { transform: (value) => parseInt(value, 10) })
    userId: number,
  ): Promise<UserManagerAssignmentResponseDto[]> {
    const assignments =
      await this.userManagerAssignmentService.getAssignmentsByUser(userId);
    return assignments.map((assignment) =>
      this.toAssignmentResponseDto(assignment),
    );
  }

  @Delete(':userId/manager-assignments/:managerId')
  @ApiOperation({
    summary: 'Remove Manager Assignment (Admin Only)',
    description:
      'Remove a user-manager assignment relationship. This endpoint is restricted to administrators only.',
  })
  @ApiNoContentResponse({
    description: 'Assignment removed successfully',
  })
  @ApiParam({
    name: 'userId',
    type: Number,
    required: true,
    description: 'User ID',
    example: 456,
  })
  @ApiParam({
    name: 'managerId',
    type: Number,
    required: true,
    description: 'Manager ID',
    example: 123,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'Assignment not found',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeManagerAssignment(
    @Param('userId', { transform: (value) => parseInt(value, 10) })
    userId: number,
    @Param('managerId', { transform: (value) => parseInt(value, 10) })
    managerId: number,
    @Request() req: Request & { user: { id: number } },
  ): Promise<void> {
    await this.userManagerAssignmentService.removeAssignment(
      userId,
      managerId,
      req.user.id,
    );
  }

  @Get('managers/:managerId/assigned-users')
  @ApiOperation({
    summary: 'List Users Assigned to Manager (Admin Only)',
    description:
      'Get all users assigned to a specific manager. This endpoint is restricted to administrators only.',
  })
  @ApiOkResponse({
    type: [UserManagerAssignmentResponseDto],
    description: 'List of user assignments',
  })
  @ApiParam({
    name: 'managerId',
    type: Number,
    required: true,
    description: 'Manager ID',
    example: 123,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
  })
  @HttpCode(HttpStatus.OK)
  async getAssignedUsers(
    @Param('managerId', { transform: (value) => parseInt(value, 10) })
    managerId: number,
  ): Promise<UserManagerAssignmentResponseDto[]> {
    const assignments =
      await this.userManagerAssignmentService.getAssignmentsByManager(
        managerId,
      );
    return assignments.map((assignment) =>
      this.toAssignmentResponseDto(assignment),
    );
  }

  /**
   * Transform domain entity to response DTO
   */
  private toAssignmentResponseDto(
    assignment: UserManagerAssignment,
  ): UserManagerAssignmentResponseDto {
    return plainToClass(UserManagerAssignmentResponseDto, {
      id: assignment.id,
      userId: assignment.userId,
      managerId: assignment.managerId,
      assignedById: assignment.assignedById,
      assignedAt: assignment.assignedAt,
      status: assignment.deletedAt ? 'deleted' : 'active',
    } as UserManagerAssignmentResponseDto, {
      excludeExtraneousValues: true,
    });
  }
}
