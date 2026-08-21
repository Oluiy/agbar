/**
 * Spring Boot Test smoke test for the health endpoint, mirroring HealthEndpointTestTemplate.cs.
 * Uses RestTestClient (Spring Boot 4 / Spring Framework 7's fluent test client), not the
 * deprecated TestRestTemplate - this is a brand-new generated file, so it should use the
 * current, non-deprecated API rather than something already on its way out.
 *
 * Deliberately does not depend on real external infrastructure: a "does the app start and
 * answer /api/health" smoke test should run in any CI environment with no real secrets and no
 * real database server available.
 * - When JWT is included, jwt.key is overridden directly with a throwaway test-only value
 *   (JJWT's Keys.hmacShaKeyFor validates minimum key strength at bean-construction time,
 *   unlike .NET's SymmetricSecurityKey, so the base application.yml's blank placeholder would
 *   otherwise fail context startup before the test even runs).
 * - When a database is included, the test points at an in-memory H2 database instead of the
 *   configured PostgreSQL/MySQL: @EnableJpaRepositories on the main class needs a working
 *   entityManagerFactory bean unconditionally (even with zero repository interfaces defined
 *   yet), so excluding JPA autoconfiguration entirely isn't an option - H2 satisfies that
 *   without requiring a real database server.
 */
export function healthControllerTest(mainPackage: string, includeJwt: boolean, hasDb: boolean): string {
  const properties: string[] = [];
  if (includeJwt) properties.push('"jwt.key=test-only-signing-key-not-for-production-use-32chars"');
  if (hasDb) {
    properties.push('"spring.datasource.url=jdbc:h2:mem:testdb"');
    properties.push('"spring.jpa.hibernate.ddl-auto=create-drop"');
  }
  const propertiesArg = properties.length > 0 ? `,\n        properties = {${properties.join(", ")}}` : "";

  // Same package as the @SpringBootApplication class: @SpringBootTest's default
  // context-class detection searches upward from the test's own package for one,
  // so it needs to actually be reachable from here.
  return `package ${mainPackage};

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureRestTestClient;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.client.RestTestClient;

@AutoConfigureRestTestClient
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT${propertiesArg}
)
class HealthControllerTests {

    @Autowired
    private RestTestClient restClient;

    @Test
    void healthEndpointReturnsOk() {
        restClient
                .get()
                .uri("/api/health")
                .exchange()
                .expectStatus()
                .is2xxSuccessful();
    }

}
`;
}
