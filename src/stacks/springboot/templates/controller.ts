/**
 * Controller + service pair for the sample endpoints - the Spring Boot
 * equivalent of BuildQuickPkg's Templates/ControllerTemplate.cs. Spring MVC has
 * no Minimal-API-style alternative, so this is the only API style.
 *
 * Takes explicit package names rather than deriving fixed suffixes internally,
 * so the same templates work across all three project structures (Multi-Module,
 * Package-by-Layer, Package-by-Feature) - only where classes physically live
 * differs between them, not what they contain.
 */

export function healthController(controllerPackage: string, servicePackage: string): string {
  return `package ${controllerPackage};

import ${servicePackage}.HealthService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class HealthController {

    private final HealthService healthService;

    public HealthController(HealthService healthService) {
        this.healthService = healthService;
    }

    @GetMapping("/api/health")
    public Map<String, Object> health() {
        return healthService.getHealth();
    }

}
`;
}

export function authController(controllerPackage: string, servicePackage: string): string {
  return `package ${controllerPackage};

import ${servicePackage}.AuthService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/api/auth/token")
    public Map<String, String> token(@RequestParam String username) {
        return Map.of("token", authService.issueToken(username));
    }

    @GetMapping("/api/secure")
    public Map<String, String> secure() {
        return Map.of("message", "You are authenticated!");
    }

}
`;
}
