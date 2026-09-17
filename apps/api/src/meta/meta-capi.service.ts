import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import * as https from 'node:https';

@Injectable()
export class MetaCapiService {
  private readonly logger = new Logger(MetaCapiService.name);

  constructor(private readonly config: ConfigService) {}

  private sha256(value: string): string {
    return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
  }

  // Fire-and-forget — nunca lança, nunca bloqueia fluxo de negócio.
  sendEvent(params: {
    eventName: string;
    eventId: string;
    eventTime?: number;
    userData: {
      em?: string;
      _fbp?: string | null;
      _fbc?: string | null;
      clientIpAddress?: string | null;
      clientUserAgent?: string | null;
    };
    customData?: { value?: number; currency?: string };
    eventSourceUrl?: string;
  }): void {
    const pixelId = this.config.get<string>('META_PIXEL_ID');
    const accessToken = this.config.get<string>('META_ACCESS_TOKEN');
    if (!pixelId || !accessToken) return;

    const { eventName, eventId, eventTime, userData, customData } = params;
    const ud: Record<string, unknown> = {};
    if (userData.em) ud['em'] = [this.sha256(userData.em)];
    if (userData._fbp) ud['fbp'] = userData._fbp;
    if (userData._fbc) ud['fbc'] = userData._fbc;
    if (userData.clientIpAddress) ud['client_ip_address'] = userData.clientIpAddress;
    if (userData.clientUserAgent) ud['client_user_agent'] = userData.clientUserAgent;

    const event: Record<string, unknown> = {
      event_name: eventName,
      event_time: eventTime ?? Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      user_data: ud,
    };
    if (params.eventSourceUrl) event['event_source_url'] = params.eventSourceUrl;
    if (customData) event['custom_data'] = customData;

    const testEventCode = this.config.get<string>('META_TEST_EVENT_CODE');
    const payload: Record<string, unknown> = { data: [event] };
    if (testEventCode) payload['test_event_code'] = testEventCode;
    const body = JSON.stringify(payload);
    const path = `/v20.0/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;

    const req = https.request(
      {
        hostname: 'graph.facebook.com',
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            this.logger.warn(`Meta CAPI ${eventName} (${eventId}) HTTP ${res.statusCode}: ${data.slice(0, 200)}`);
          }
        });
      },
    );
    req.on('error', (err) => {
      this.logger.warn(`Meta CAPI ${eventName} (${eventId}) erro: ${err.message}`);
    });
    req.write(body);
    req.end();
  }
}
