import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExtractedFieldEntity } from '../document-processing/infrastructure/persistence/relational/entities/extracted-field.entity';
import { AtAGlanceController } from './at-a-glance.controller';
import { AtAGlanceService } from './at-a-glance.service';

@Module({
  imports: [TypeOrmModule.forFeature([ExtractedFieldEntity])],
  controllers: [AtAGlanceController],
  providers: [AtAGlanceService],
})
export class AtAGlanceModule {}
