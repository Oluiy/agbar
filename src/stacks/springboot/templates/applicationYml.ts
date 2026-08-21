/**
 * application.yml (base) + application-dev.yml / application-prod.yml (profile
 * overlays), mirroring BuildQuickPkg's AppSettingsTemplate.cs base/dev/prod
 * layering. Spring merges the base file with whichever profile is active
 * (spring.profiles.active), the same way ASP.NET Core merges appsettings.json
 * with appsettings.{Environment}.json.
 */

export type DbProvider = "none" | "postgres" | "mysql";

export function baseYaml(projectNameLower: string, httpPort: number, includeJwt: boolean): string {
  const jwtBlock = includeJwt
    ? `
jwt:
  issuer: https://localhost
  audience: https://localhost
  key: ""
  expiry-minutes: 60
`
    : "";

  return `spring:
  application:
    name: ${projectNameLower}

server:
  port: ${httpPort}
${jwtBlock}`;
}

function datasourceBlock(projectNameLower: string, provider: DbProvider, env: "dev" | "prod"): string {
  if (provider === "none") return "";

  if (env === "dev") {
    const url =
      provider === "postgres"
        ? `jdbc:postgresql://localhost:5432/${projectNameLower}_dev`
        : `jdbc:mysql://localhost:3306/${projectNameLower}_dev?useSSL=false&serverTimezone=UTC`;
    const username = provider === "postgres" ? "postgres" : "root";
    const password = provider === "postgres" ? "postgres" : "root";

    return `
spring:
  datasource:
    url: ${url}
    username: ${username}
    password: ${password}
  jpa:
    hibernate:
      ddl-auto: update
    show-sql: true
`;
  }

  // Production: never a hardcoded connection string, always sourced from
  // environment variables with an empty default - mirrors AppSettingsTemplate.Production().
  return `
spring:
  datasource:
    url: \${DB_URL:}
    username: \${DB_USERNAME:}
    password: \${DB_PASSWORD:}
  jpa:
    hibernate:
      ddl-auto: validate
    show-sql: false
`;
}

export function devYaml(projectNameLower: string, dbProvider: DbProvider, includeJwt: boolean): string {
  const jwtBlock = includeJwt
    ? `
jwt:
  key: dev-only-signing-key-do-not-use-in-production-32chars-min
`
    : "";

  return `${datasourceBlock(projectNameLower, dbProvider, "dev")}${jwtBlock}`;
}

export function prodYaml(projectNameLower: string, dbProvider: DbProvider, includeJwt: boolean): string {
  const jwtBlock = includeJwt
    ? `
jwt:
  key: \${JWT_KEY:}
`
    : "";

  return `${datasourceBlock(projectNameLower, dbProvider, "prod")}${jwtBlock}`;
}
