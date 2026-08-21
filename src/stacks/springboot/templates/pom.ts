/**
 * Maven multi-module POMs for the generated Spring Boot solution. Mirrors
 * BuildQuickPkg's Templates/CsprojTemplates.cs: a root aggregator POM (the
 * Maven-reactor equivalent of a .sln) plus one child POM per layer module, each
 * referencing its sibling modules the way a .csproj references other .csproj
 * files via ProjectReference.
 */

const SPRING_BOOT_VERSION = "4.1.0";
const JAVA_VERSION = "21";

interface ModuleDependency {
  groupId: string;
  artifactId: string;
  scope?: "runtime" | "test" | "provided";
  /** Only needed for dependencies not covered by spring-boot-starter-parent's managed dependency BOM (e.g. jjwt). */
  version?: string;
}

/** The root aggregator POM: packaging=pom, lists every layer module as a Maven reactor module. */
export function parentPom(projectNameLower: string, moduleNames: string[]): string {
  const modulesXml = moduleNames.map((m) => `    <module>${projectNameLower}-${m}</module>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>${SPRING_BOOT_VERSION}</version>
    <relativePath/>
  </parent>

  <groupId>com.buildquick</groupId>
  <artifactId>${projectNameLower}</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <packaging>pom</packaging>

  <properties>
    <java.version>${JAVA_VERSION}</java.version>
  </properties>

  <modules>
${modulesXml}
  </modules>
</project>
`;
}

/**
 * A child module POM. `moduleDependencies` are sibling layer modules (e.g. "application"
 * depending on "domain"), rendered as `com.buildquick:{projectNameLower}-{module}` deps.
 * `includeBootPlugin` adds `spring-boot-maven-plugin`, used only by the api module so it
 * (and only it) packages into a runnable jar.
 */
export function modulePom(
  projectNameLower: string,
  moduleName: string,
  dependencies: ModuleDependency[],
  moduleDependencies: string[] = [],
  includeBootPlugin = false
): string {
  const moduleDepsXml = moduleDependencies
    .map(
      (dep) => `    <dependency>
      <groupId>com.buildquick</groupId>
      <artifactId>${projectNameLower}-${dep}</artifactId>
      <version>\${project.version}</version>
    </dependency>`
    )
    .join("\n");

  const externalDepsXml = dependencies
    .map((dep) => {
      const versionXml = dep.version ? `\n      <version>${dep.version}</version>` : "";
      const scopeXml = dep.scope ? `\n      <scope>${dep.scope}</scope>` : "";
      return `    <dependency>
      <groupId>${dep.groupId}</groupId>
      <artifactId>${dep.artifactId}</artifactId>${versionXml}${scopeXml}
    </dependency>`;
    })
    .join("\n");

  const depsXml = [moduleDepsXml, externalDepsXml].filter((s) => s.length > 0).join("\n");

  const buildXml = includeBootPlugin
    ? `
  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.buildquick</groupId>
    <artifactId>${projectNameLower}</artifactId>
    <version>0.0.1-SNAPSHOT</version>
    <relativePath>../pom.xml</relativePath>
  </parent>

  <artifactId>${projectNameLower}-${moduleName}</artifactId>

  <dependencies>
${depsXml}
  </dependencies>
${buildXml}</project>
`;
}

/**
 * A single, standalone pom.xml for Package-by-Layer/Package-by-Feature structures:
 * no reactor, no sibling-module dependencies, packaging=jar, spring-boot-maven-plugin
 * always included since this is the only (and therefore always the runnable) artifact.
 */
export function singleModulePom(projectNameLower: string, dependencies: ModuleDependency[]): string {
  const depsXml = dependencies
    .map((dep) => {
      const versionXml = dep.version ? `\n      <version>${dep.version}</version>` : "";
      const scopeXml = dep.scope ? `\n      <scope>${dep.scope}</scope>` : "";
      return `    <dependency>
      <groupId>${dep.groupId}</groupId>
      <artifactId>${dep.artifactId}</artifactId>${versionXml}${scopeXml}
    </dependency>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>${SPRING_BOOT_VERSION}</version>
    <relativePath/>
  </parent>

  <groupId>com.buildquick</groupId>
  <artifactId>${projectNameLower}</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <packaging>jar</packaging>

  <properties>
    <java.version>${JAVA_VERSION}</java.version>
  </properties>

  <dependencies>
${depsXml}
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
`;
}

/** A lightweight reactor root for microservice mode, listing each service as a Maven module for one-shot "mvn install" builds. Not tied to any one structure - every service under it is fully independent regardless. */
export function microserviceAggregatorPom(projectNameLower: string, serviceNames: string[]): string {
  const modulesXml = serviceNames.map((s) => `    <module>services/${s}</module>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.buildquick</groupId>
  <artifactId>${projectNameLower}</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <packaging>pom</packaging>

  <modules>
${modulesXml}
  </modules>
</project>
`;
}

/** The JDBC driver dependency for a chosen database provider, or null for "none". */
export function dbDriverDependency(provider: "postgres" | "mysql"): ModuleDependency {
  return provider === "postgres"
    ? { groupId: "org.postgresql", artifactId: "postgresql", scope: "runtime" }
    : { groupId: "com.mysql", artifactId: "mysql-connector-j", scope: "runtime" };
}

const JJWT_VERSION = "0.13.0";

export const JJWT_DEPENDENCIES: ModuleDependency[] = [
  { groupId: "io.jsonwebtoken", artifactId: "jjwt-api", version: JJWT_VERSION },
  { groupId: "io.jsonwebtoken", artifactId: "jjwt-impl", version: JJWT_VERSION, scope: "runtime" },
  { groupId: "io.jsonwebtoken", artifactId: "jjwt-jackson", version: JJWT_VERSION, scope: "runtime" },
];

export { SPRING_BOOT_VERSION, JAVA_VERSION };
export type { ModuleDependency };
