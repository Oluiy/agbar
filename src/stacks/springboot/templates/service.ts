/**
 * Interface + implementation pairs, mirroring BuildQuickPkg's service-controller
 * pattern. Takes an explicit package name (see controller.ts for why).
 */

export function healthServiceInterface(servicePackage: string): string {
  return `package ${servicePackage};

import java.util.Map;

public interface HealthService {

    Map<String, Object> getHealth();

}
`;
}

export function healthServiceImpl(servicePackage: string, projectName: string): string {
  return `package ${servicePackage};

import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Map;

@Service
public class HealthServiceImpl implements HealthService {

    @Override
    public Map<String, Object> getHealth() {
        return Map.of(
            "status", "Healthy",
            "project", "${projectName} API",
            "timestamp", Instant.now().toString()
        );
    }

}
`;
}

export function authServiceInterface(servicePackage: string): string {
  return `package ${servicePackage};

public interface AuthService {

    String issueToken(String username);

}
`;
}

export function authServiceImpl(servicePackage: string): string {
  return `package ${servicePackage};

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;

@Service
public class AuthServiceImpl implements AuthService {

    private final SecretKey key;
    private final String issuer;
    private final String audience;
    private final long expiryMinutes;

    public AuthServiceImpl(
            @Value("\${jwt.key}") String jwtKey,
            @Value("\${jwt.issuer}") String issuer,
            @Value("\${jwt.audience}") String audience,
            @Value("\${jwt.expiry-minutes:60}") long expiryMinutes
    ) {
        this.key = Keys.hmacShaKeyFor(jwtKey.getBytes());
        this.issuer = issuer;
        this.audience = audience;
        this.expiryMinutes = expiryMinutes;
    }

    @Override
    public String issueToken(String username) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(username)
                .issuer(issuer)
                .claim("aud", audience)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(expiryMinutes, ChronoUnit.MINUTES)))
                .signWith(key)
                .compact();
    }

}
`;
}
