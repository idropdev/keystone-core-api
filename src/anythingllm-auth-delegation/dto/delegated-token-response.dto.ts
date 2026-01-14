import { ApiProperty } from '@nestjs/swagger';

export class DelegatedTokenResponseDto {
  @ApiProperty({
    description: 'Delegated JWT token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  token: string;

  @ApiProperty({
    description: 'Token expiration in seconds',
    example: 300,
  })
  expiresIn: number;

  @ApiProperty({
    description: 'Token expiration timestamp (Unix)',
    example: 1738000900,
  })
  expiresAt: number;

  @ApiProperty({
    description: 'Token audience',
    example: 'anythingllm',
  })
  audience: string;
}
