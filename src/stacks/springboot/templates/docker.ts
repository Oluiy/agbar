import type { DbProvider } from "./applicationYml.js";

/**
 * Multi-stage Dockerfile: Maven build stage, JRE runtime stage. Mirrors
 * DockerTemplate.cs's Dockerfile shape. `apiModule`, if given, targets that
 * Maven module specifically (Multi-Module structure); omitted for
 * Package-by-Layer/Package-by-Feature, which have no submodule to target - the
 * whole project builds and packages as one jar.
 */
export function dockerfile(projectNameLower: string, apiModule?: string): string {
  const buildCommand = apiModule
    ? `RUN mvn -pl ${apiModule} -am clean package -DskipTests`
    : "RUN mvn clean package -DskipTests";
  const jarPath = apiModule ? `/build/${apiModule}/target/*.jar` : "/build/target/*.jar";

  return `FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

COPY . .
${buildCommand}

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build ${jarPath} app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
`;
}

/** docker-compose.yml running the API on `httpPort`, plus a database service when `dbProvider` is set. Mirrors DockerTemplate.cs's DockerCompose shape. */
export function dockerCompose(projectNameLower: string, httpPort: number, dbProvider: DbProvider): string {
  if (dbProvider === "none") {
    return `services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "${httpPort}:8080"
    environment:
      - SPRING_PROFILES_ACTIVE=dev
`;
  }

  const dbService =
    dbProvider === "postgres"
      ? `  db:
    image: postgres:16
    environment:
      - POSTGRES_DB=${projectNameLower}_dev
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    ports:
      - "5432:5432"
    volumes:
      - db-data:/var/lib/postgresql/data
`
      : `  db:
    image: mysql:8
    environment:
      - MYSQL_DATABASE=${projectNameLower}_dev
      - MYSQL_ROOT_PASSWORD=root
    ports:
      - "3306:3306"
    volumes:
      - db-data:/var/lib/mysql
`;

  return `services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "${httpPort}:8080"
    environment:
      - SPRING_PROFILES_ACTIVE=dev
    depends_on:
      - db

${dbService}
volumes:
  db-data:
`;
}
