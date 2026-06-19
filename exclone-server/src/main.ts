import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allow REST calls from any origin during development.
  // (The Socket.IO CORS is configured separately in the @WebSocketGateway decorator.)
  app.enableCors();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Whiteboard server listening on http://localhost:${port}`);
}
bootstrap();
