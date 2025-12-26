import { Module, forwardRef } from '@nestjs/common';
import { HomeService } from './home.service';
import { HomeController } from './home.controller';
import { HealthService } from './health.service';
import { ConfigModule } from '@nestjs/config';
import { DocumentProcessingModule } from '../document-processing/document-processing.module';

@Module({
  imports: [
    ConfigModule,
    // Import DocumentProcessingModule to access GcpStorageAdapter
    forwardRef(() => DocumentProcessingModule),
  ],
  controllers: [HomeController],
  providers: [HomeService, HealthService],
  // Export HealthService so it can be used elsewhere if needed
  exports: [HealthService],
})
export class HomeModule {}
