import type { DjangoDb } from "../types.js";

/** The Django project package (`config/`) and its entrypoints. */

export function managePy(): string {
  return `#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys


def main() -> None:
    # Development default only: manage.py is a developer tool. wsgi.py and asgi.py
    # deliberately do NOT set this, so a deployed server must provide a real
    # DJANGO_SECRET_KEY instead of silently running with debug on.
    os.environ.setdefault("DJANGO_DEBUG", "true")
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Is it installed and is your virtual environment activated? "
            "Try: pip install -r requirements.txt"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
`;
}

export function wsgiPy(): string {
  return `"""WSGI entrypoint - what gunicorn imports in production."""
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
application = get_wsgi_application()
`;
}

export function asgiPy(): string {
  return `"""ASGI entrypoint, for async servers."""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
application = get_asgi_application()
`;
}

export function urlsPy(): string {
  return `from django.contrib import admin
from django.urls import include, path

from apps.core.views import liveness

urlpatterns = [
    # Outside the version prefix: probes point at a fixed path, and moving it when
    # the API version changes is how a deploy starts failing its own checks.
    path("health", liveness, name="liveness"),
    path("admin/", admin.site.urls),
    path("api/v1/", include("apps.core.urls")),
    path("api/v1/", include("apps.items.urls")),
]
`;
}

export function settingsPy(projectName: string, db: DjangoDb): string {
  const dbName = projectName.toLowerCase();
  const databases =
    db === "sqlite"
      ? `DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        # A file next to the project, so a fresh clone runs with no database server.
        "NAME": BASE_DIR / "${dbName}.sqlite3",
    }
}`
      : `DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "${dbName}"),
        "USER": os.environ.get("POSTGRES_USER", "postgres"),
        # No default: a password in source is a leaked password. Set it in the
        # environment (.env locally, a secret in deployment).
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""),
        "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        # Reuse connections for a minute instead of reconnecting on every request,
        # and have Django check a pooled one is still alive before using it.
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
    }
}`;

  return `"""
Settings, read from the environment.

Nothing secret lives in this file. A missing SECRET_KEY fails at startup with a clear
message rather than running with a default anyone can read.
"""
import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.environ.get("DJANGO_DEBUG", "false").lower() == "true"

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if DEBUG:
        # Only reachable with DJANGO_DEBUG=true, which manage.py sets for local work.
        SECRET_KEY = "dev-only-insecure-key-do-not-use-in-production"
    else:
        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY is not set. Generate one with: "
            "python -c 'from django.core.management.utils import get_random_secret_key as g; print(g())'"
        )

# "testserver" is the host Django's test client uses.
ALLOWED_HOSTS = [h.strip() for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",") if h.strip()]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "apps.core",
    "apps.items",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

${databases}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"

REST_FRAMEWORK = {
    # Bounded by default: an unpaginated list is fine at 200 rows and a timeout at 2 million.
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "PAGE_SIZE": 50,
    # Rate limiting for every view, configured once - so a route added next month is
    # covered without anyone remembering to decorate it.
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle", "rest_framework.throttling.UserRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {
        "anon": os.environ.get("THROTTLE_ANON", "100/min"),
        "user": os.environ.get("THROTTLE_USER", "1000/min"),
    },
}

# Most HTTP clients have no timeout unless you set one, which lets a single slow
# dependency hold a worker open indefinitely. Pass this to every client you build.
REQUEST_TIMEOUT_SECONDS = float(os.environ.get("REQUEST_TIMEOUT_SECONDS", "10"))
`;
}
