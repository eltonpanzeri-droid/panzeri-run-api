import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { WearService } from './wear.service';

// Credencial do RELOGIO (nao e' o JWT da aluna): "Authorization: Bearer <credencial>". Coloca { deviceId, userId } na requisicao; sem credencial valida, 401.
export interface WearRequest {
  headers: Record<string, string | string[] | undefined>;
  wearDevice?: { deviceId: string; userId: string };
}

@Injectable()
export class WearDeviceGuard implements CanActivate {
  constructor(private readonly wear: WearService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WearRequest>();
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    const match = typeof value === 'string' ? /^Bearer\s+(\S+)$/i.exec(value) : null;
    if (!match) throw new UnauthorizedException();
    request.wearDevice = await this.wear.authenticate(match[1]);
    return true;
  }
}
