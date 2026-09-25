import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CONTEXT_EVENT_TYPES, ContextEventType } from '../context-event-types';

// Usado pelo caminho manual do treinador (POST /coach/students/:studentId/context-events) — ver
// secao 26 do Passo 4. Sem interface grande no admin ainda (Passo 5); endpoint pronto pra uso via
// um form simples ou chamada direta.
export class CreateContextEventDto {
  @IsIn(CONTEXT_EVENT_TYPES)
  type!: ContextEventType;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  subtype?: string;

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
  endedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  originalText?: string;
}
