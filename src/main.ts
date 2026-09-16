import "reflect-metadata";
import { VersioningType, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { ApiResponseInterceptor } from "./common/interceptors/api-response.interceptor";
import { JsonLogger } from "./common/logging/json-logger";
import { AppConfigService } from "./config/app-config.service";

async function bootstrap() {
  const logger = new JsonLogger();
  const app = await NestFactory.create(AppModule, { logger, rawBody: true });
  const config = app.get(AppConfigService);

  app.use(helmet());
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1"
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );
  app.useGlobalFilters(new AllExceptionsFilter(logger));
  app.useGlobalInterceptors(new ApiResponseInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Reepay API")
    .setDescription("Provider-neutral payments and orchestration API for SangaPay.")
    .setVersion("1.0")
    .addApiKey({ type: "apiKey", name: "X-Reepay-Api-Key", in: "header" }, "reepay-api-key")
    .addApiKey({ type: "apiKey", name: "X-Reepay-Application-Id", in: "header" }, "reepay-application-id")
    .addApiKey({ type: "apiKey", name: "X-Reepay-Admin-Api-Key", in: "header" }, "reepay-admin-api-key")
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);

  await app.listen(config.port);
}

void bootstrap();
