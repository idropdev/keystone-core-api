import { Test, TestingModule } from '@nestjs/testing';
import { AtAGlanceController } from './at-a-glance.controller';
import { AtAGlanceService } from './at-a-glance.service';
import { AtAGlanceSummaryDto } from './dto/at-a-glance-summary.dto';

describe('AtAGlanceController', () => {
  let controller: AtAGlanceController;
  let service: { getSummaryForUser: jest.Mock };

  beforeEach(async () => {
    service = { getSummaryForUser: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AtAGlanceController],
      providers: [{ provide: AtAGlanceService, useValue: service }],
    }).compile();
    controller = module.get(AtAGlanceController);
  });

  it('should call service.getSummaryForUser with the requesting user id', async () => {
    const summary = {
      categories: {} as AtAGlanceSummaryDto['categories'],
      last_updated: null,
      documents_analyzed: 0,
    };
    service.getSummaryForUser.mockResolvedValue(summary);
    const result = await controller.getSummary({
      user: { id: 99 },
    } as any);
    expect(service.getSummaryForUser).toHaveBeenCalledWith(99);
    expect(result).toBe(summary);
  });

  it('should coerce a string user id from the JWT sub claim to a number', async () => {
    const summary = {
      categories: {} as AtAGlanceSummaryDto['categories'],
      last_updated: null,
      documents_analyzed: 0,
    };
    service.getSummaryForUser.mockResolvedValue(summary);
    // Simulate the JWT strategy resolving payload.sub (string) into request.user.id
    await controller.getSummary({ user: { id: '99' } } as any);
    expect(service.getSummaryForUser).toHaveBeenCalledWith(99);
  });

  it('should throw UnauthorizedException when user id is missing or not a number', async () => {
    await expect(
      controller.getSummary({ user: { id: undefined } } as any),
    ).rejects.toThrow('Unauthorized');
    await expect(
      controller.getSummary({ user: { id: 'not-a-number' } } as any),
    ).rejects.toThrow('Unauthorized');
  });
});
