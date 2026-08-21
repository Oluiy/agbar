/**
 * A starter JPA base entity, mirroring EfCoreTemplate.DbContext's "empty, guiding
 * comment" starter shape. Takes an explicit package name (see controller.ts for why).
 */
export function baseEntity(entityPackage: string): string {
  return `package ${entityPackage};

import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;

// Extend this to create your entities.
// Example: public class User extends BaseEntity { private String name; ... }
@MappedSuperclass
public abstract class BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

}
`;
}
