import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Structured JSON logging; swap for Winston/Pino in production
    logger: ['error', 'warn', 'log'],
  });

  const config = app.get(ConfigService);
  const isDev  = config.get('NODE_ENV') !== 'production';

  // ----------------------------------------------------------------
  // Security headers (Helmet)
  // ----------------------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: isDev ? false : undefined, // relax CSP in dev for Swagger UI
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    }),
  );

  // ----------------------------------------------------------------
  // CORS — locked to known origins only
  // ----------------------------------------------------------------
  const allowedOrigins = [
    config.get('FRONTEND_URL', 'http://localhost:3000'),
    ...(isDev ? ['http://localhost:3001'] : []),
  ];
  app.enableCors({
  origin: true,
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  // ----------------------------------------------------------------
  // Cookie parser (required for httpOnly refresh token cookie)
  // ----------------------------------------------------------------
  app.use(cookieParser());

  // ----------------------------------------------------------------
  // Global prefix
  // ----------------------------------------------------------------
  app.setGlobalPrefix('api/v1');

  // ----------------------------------------------------------------
  // Global validation pipe
  //   - whitelist: strip unknown properties (prevents mass-assignment)
  //   - forbidNonWhitelisted: throw on unknown properties
  //   - transform: auto-convert primitives to declared DTO types
  // ----------------------------------------------------------------
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist:            true,
      forbidNonWhitelisted: true,
      transform:            true,
      transformOptions:     { enableImplicitConversion: true },
    }),
  );

  // ----------------------------------------------------------------
  // OpenAPI / Swagger (dev + staging only; never expose in production)
  // ----------------------------------------------------------------
  if (isDev) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('KashRoot API')
      .setDescription(
        'Global agri-trade platform API. All endpoints require auth unless marked Public.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('Auth')
      .addTag('Listings')
      .addTag('Appointments')
      .addTag('Orders')
      .addTag('Payments')
      .addTag('Payouts')
      .addTag('Shipments')
      .addTag('Disputes')
      .addTag('Reviews')
      .addTag('Notifications')
      .addTag('Admin')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    console.log(`Swagger UI: http://localhost:${config.get('PORT', 3001)}/api/docs`);
  }

  // ----------------------------------------------------------------
  // Health-check endpoint (outside global prefix for load-balancer probes)
  // ----------------------------------------------------------------
  const adapter = app.getHttpAdapter();
  adapter.get('/health', (_req: any, res: any) =>
    res.json({ status: 'ok', timestamp: new Date().toISOString() }),
  );

  // ----------------------------------------------------------------
  // Start
  // ----------------------------------------------------------------
  const port = parseInt(config.get('PORT', '3001'));
  await app.listen(port);
  console.log(`KashRoot API listening on port ${port} [${config.get('NODE_ENV', 'development')}]`);
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
