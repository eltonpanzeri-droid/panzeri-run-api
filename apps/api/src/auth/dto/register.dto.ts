import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class AcquisitionAttributionDto {
  @IsOptional() @IsString() @MaxLength(300) source?: string;
  @IsOptional() @IsString() @MaxLength(300) medium?: string;
  @IsOptional() @IsString() @MaxLength(300) campaign?: string;
  @IsOptional() @IsString() @MaxLength(300) content?: string;
  @IsOptional() @IsString() @MaxLength(300) term?: string;
  @IsOptional() @IsString() @MaxLength(1000) referrer?: string;
  @IsOptional() @IsString() @MaxLength(300) fbclid?: string;
  @IsOptional() @IsString() @MaxLength(300) gclid?: string;
  // sessionId = funnelSessionId do cliente — vincula acquisitionAttribution aos FunnelEvents da mesma jornada
  // via WHERE FunnelEvent.sessionId = acquisitionAttribution->>'sessionId'.
  // Diferente de FunnelEvent.journeyId (campo cross-device, nunca implementado, sempre null).
  @IsOptional() @IsString() @MaxLength(64) sessionId?: string;
  // _fbp / _fbc: cookies Meta Pixel para matching no CAPI. Capturados no PWA e repassados ao
  // servidor para enriquecer a chamada de CompleteRegistration sem expor ao lado do cliente.
  @IsOptional() @IsString() @MaxLength(200) _fbp?: string;
  @IsOptional() @IsString() @MaxLength(500) _fbc?: string;
}

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsBoolean()
  acceptedTerms!: boolean;

  @IsBoolean()
  acceptedExerciseResponsibility!: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => AcquisitionAttributionDto)
  attribution?: AcquisitionAttributionDto;
}
