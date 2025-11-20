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

@ApiBearerAuth()
@Roles(RoleEnum.admin)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiTags('Users')
@Controller({
  path: 'users',
  version: '1',
})
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
}
