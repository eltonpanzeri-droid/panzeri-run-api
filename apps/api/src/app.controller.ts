import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

@Controller()
export class AppController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'panzeri-run-api',
    };
  }

  @Get('maintenance/migrate')
  async migrate(@Query('secret') secret: string) {
    const expectedSecret = process.env.MIGRATION_SECRET;
    if (!expectedSecret || secret !== expectedSecret) {
      throw new ForbiddenException('Migration secret invalido.');
    }

    const { stdout, stderr } = await execFileAsync('npx', [
      'prisma',
      'migrate',
      'deploy',
      '--schema',
      'prisma/schema.prisma',
    ]);

    return {
      status: 'ok',
      stdout,
      stderr,
    };
  }
}
