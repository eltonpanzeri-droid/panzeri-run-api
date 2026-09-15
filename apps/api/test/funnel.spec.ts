import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RecordEventDto } from '../src/funnel/funnel.controller';
import { FunnelService } from '../src/funnel/funnel.service';

const validationPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

const bodyMetadata = { type: 'body' as const, metatype: RecordEventDto };

describe('internal funnel analytics', () => {
  it('accepts the complete valid payload currently sent by trackFunnel', async () => {
    await expect(validationPipe.transform({
      sessionId: '3f85c381-9d30-4f55-b172-7cb0dc7f9477',
      event: 'question_error',
      userId: '1abfb8f1-d5dd-493f-8317-a5fd7c8fd47d',
      questionId: 'personal_weight',
      metadata: { step: 3, errorMessage: 'network_error' },
    }, bodyMetadata)).resolves.toMatchObject({
      event: 'question_error',
      questionId: 'personal_weight',
    });
  });

  it('rejects invalid and unexpected properties with the global API rules', async () => {
    await expect(validationPipe.transform({
      sessionId: '',
      event: 'invalid-event',
      unexpected: true,
    }, bodyMetadata)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes a valid event to FunnelEvent', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'event-1' });
    const prisma = { funnelEvent: { create } };
    const service = new FunnelService(prisma as never, {} as never);

    await service.record({
      sessionId: '3f85c381-9d30-4f55-b172-7cb0dc7f9477',
      event: 'signup_completed',
      userId: '1abfb8f1-d5dd-493f-8317-a5fd7c8fd47d',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        sessionId: '3f85c381-9d30-4f55-b172-7cb0dc7f9477',
        event: 'signup_completed',
        userId: '1abfb8f1-d5dd-493f-8317-a5fd7c8fd47d',
        questionId: null,
        metadata: undefined,
      },
    });
  });
});
