/** The shapes the Django adapter's prompts, validation and generators all agree on. */

/**
 * Both produce the same API. The difference is where business logic lives.
 */
export type DjangoStructure =
  // Idiomatic Django: models, serializers and generic views per app. Fewest files;
  // the right start for a CRUD-shaped service.
  | "standard"
  // Adds services.py (writes) and selectors.py (reads) so views stay thin and the
  // rules do not end up in serializers or the ORM calls scattered across views.
  | "service-layer";

/** Django always has a database (auth, sessions, migrations), so there is no "none". */
export type DjangoDb = "sqlite" | "postgres";

export interface DjangoAddons {
  structure: DjangoStructure;
  db: DjangoDb;
  includeDocker: boolean;
  /** Run `django-admin startproject` when Django is already installed, instead of writing the project files. */
  useCli: boolean;
  /** Create a venv, install dependencies and run the test suite after generating. */
  install: boolean;
}

export const DJANGO_STRUCTURES: DjangoStructure[] = ["standard", "service-layer"];
export const DJANGO_DBS: DjangoDb[] = ["sqlite", "postgres"];
