import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiTags,
  ApiOperation,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FilesS3PresignedService } from './files.service';
import { FileUploadDto } from './dto/file.dto';
import { FileResponseDto } from './dto/file-response.dto';

@ApiTags('Files')
@Controller({
  path: 'files',
  version: '1',
})
export class FilesS3PresignedController {
  constructor(private readonly filesService: FilesS3PresignedService) {}

  @Post('upload')
  @ApiOperation({
    summary: 'Get Presigned URL for File Upload',
    description:
      'Get a presigned URL for uploading a file to S3/GCS. The client should use this URL to upload the file directly to storage.',
  })
  @ApiCreatedResponse({
    type: FileResponseDto,
    description: 'Presigned URL generated successfully',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request body or validation errors',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async uploadFile(@Body() file: FileUploadDto) {
    return this.filesService.create(file);
  }
}
