import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { RETURN_REASON_OPTIONS, ReturnReasonOption, TRAINING_DURING_GAP_OPTIONS, TrainingDuringGapOption } from '../context-event-types';

export class SubmitReturnQuestionnaireDto {
  @IsIn(TRAINING_DURING_GAP_OPTIONS)
  trainingDuringGap!: TrainingDuringGapOption;

  @IsIn(RETURN_REASON_OPTIONS)
  reason!: ReturnReasonOption;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reasonOtherDescription?: string;

  @IsInt()
  @Min(1)
  @Max(5)
  physicalStateComparedToBefore!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  mentalReadinessComparedToBefore!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
