import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';

import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../../prisma/prisma.service';

const TEST_SECRET = 'e2e-test-access-secret';

// Valid v4 UUIDs so the DTO's @IsUUID() checks pass on the happy path.
const validBody = {
  listingId:          'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  quantity:           5,
  appointmentId:      'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  feeConfigVersionId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
};

describe('OrdersController (e2e)', () => {
  let app: INestApplication;
  let ordersService: { createOrder: jest.Mock };
  const jwt = new JwtService({ secret: TEST_SECRET, signOptions: { expiresIn: '1h' } });

  const tokenFor = (sub: string, roles: string[]) =>
    jwt.sign({ sub, roles, email: 'buyer@example.com', permissions: [], regionIds: [] });

  beforeAll(async () => {
    ordersService = {
      createOrder: jest.fn().mockResolvedValue({ id: 'order-1', status: 'PLACED' }),
    };

    // JwtStrategy.validate() re-checks the user exists and is ACTIVE.
    const prismaMock = {
      user: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) => {
          if (where.id === 'user-ghost') return Promise.resolve(null);
          if (where.id === 'user-suspended')
            return Promise.resolve({ id: where.id, status: 'SUSPENDED' });
          return Promise.resolve({ id: where.id, status: 'ACTIVE' });
        }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: ordersService },
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: { getOrThrow: () => TEST_SECRET } },
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirror main.ts so the real prefix + validation pipeline are exercised.
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => jest.clearAllMocks());

  it('rejects an unauthenticated request with 401', async () => {
    await request(app.getHttpServer()).post('/api/v1/orders').send(validBody).expect(401);
    expect(ordersService.createOrder).not.toHaveBeenCalled();
  });

  it('rejects a garbage token with 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer not-a-real-token')
      .send(validBody)
      .expect(401);
    expect(ordersService.createOrder).not.toHaveBeenCalled();
  });

  it('rejects a valid token whose user is suspended with 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenFor('user-suspended', ['BUYER'])}`)
      .send(validBody)
      .expect(401);
    expect(ordersService.createOrder).not.toHaveBeenCalled();
  });

  it('rejects a non-BUYER role with 403 (RolesGuard)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenFor('user-farmer', ['FARMER'])}`)
      .send(validBody)
      .expect(403);
    expect(ordersService.createOrder).not.toHaveBeenCalled();
  });

  it('accepts a BUYER and passes req.user.sub as the buyer identifier', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenFor('user-buyer', ['BUYER'])}`)
      .send(validBody)
      .expect(201);

    expect(res.body).toEqual({ id: 'order-1', status: 'PLACED' });
    // Plumbing guarantee: sub from the token becomes arg #1; the body never supplies it.
    expect(ordersService.createOrder).toHaveBeenCalledTimes(1);
    expect(ordersService.createOrder).toHaveBeenCalledWith(
      'user-buyer',
      validBody.listingId,
      validBody.quantity,
      validBody.appointmentId,
      validBody.feeConfigVersionId,
    );
  });

  it('rejects a body that smuggles buyerProfileId with 400 (IDOR closed)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenFor('user-buyer', ['BUYER'])}`)
      .send({ ...validBody, buyerProfileId: 'attacker-supplied-id' })
      .expect(400);
    expect(ordersService.createOrder).not.toHaveBeenCalled();
  });

  it('rejects an invalid DTO (quantity < 1) with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenFor('user-buyer', ['BUYER'])}`)
      .send({ ...validBody, quantity: 0 })
      .expect(400);
    expect(ordersService.createOrder).not.toHaveBeenCalled();
  });
});
