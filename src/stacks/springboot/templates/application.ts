/**
 * The main @SpringBootApplication class. `mainPackage` is where the class itself
 * lives; `scanBasePackage`, if given, adds an explicit @ComponentScan pointing at
 * it - needed in Multi-Module, where Service/Repository/Entity classes live in
 * sibling Maven modules the default scan (main class's own package + subpackages)
 * would never reach. Package-by-Layer and Package-by-Feature don't need it: the
 * main class already sits at the root of everything else, so the default applies.
 */
export function mainApplicationClass(mainPackage: string, projectName: string, includeJpa: boolean, scanBasePackage?: string): string {
  const jpaImports = includeJpa
    ? `
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;`
    : "";
  const jpaScanTarget = scanBasePackage ?? mainPackage;
  const jpaAnnotations = includeJpa
    ? `
@EnableJpaRepositories(basePackages = "${jpaScanTarget}")
@EntityScan(basePackages = "${jpaScanTarget}")`
    : "";
  const componentScanImport = scanBasePackage ? "\nimport org.springframework.context.annotation.ComponentScan;" : "";
  const componentScanAnnotation = scanBasePackage ? `\n@ComponentScan(basePackages = "${scanBasePackage}")` : "";

  return `package ${mainPackage};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;${componentScanImport}${jpaImports}

@SpringBootApplication${componentScanAnnotation}${jpaAnnotations}
public class ${projectName}Application {

    public static void main(String[] args) {
        SpringApplication.run(${projectName}Application.class, args);
    }

}
`;
}
