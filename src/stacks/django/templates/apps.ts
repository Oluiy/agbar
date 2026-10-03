import type { DjangoStructure } from "../types.js";

/** The two Django apps: `core` (health, pagination) and `items` (the example feature). */

export function appConfigPy(label: string): string {
  return `from django.apps import AppConfig


class ${label.charAt(0).toUpperCase()}${label.slice(1)}Config(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.${label}"
`;
}

export function paginationPy(): string {
  return `from rest_framework.pagination import LimitOffsetPagination


class StandardPagination(LimitOffsetPagination):
    """
    Every list endpoint is paginated and capped.

    max_limit is enforced by DRF, not by whoever writes the next view: a client
    asking for limit=100000 gets 200 rows, and no later edit can quietly remove the cap.
    """

    default_limit = 50
    max_limit = 200
`;
}

export function coreViewsPy(): string {
  return `from django.db import connection
from django.http import JsonResponse
from rest_framework import status
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response


def liveness(_request) -> JsonResponse:
    """Liveness: "am I running?" Cheap on purpose - it must not touch the database, or a
    slow database makes the orchestrator restart a perfectly healthy process."""
    return JsonResponse({"status": "ok"})


# Probes are never rate limited: a throttled probe reports a false outage.
@api_view(["GET"])
@throttle_classes([])
def readiness(_request) -> Response:
    """
    Readiness: "can I serve traffic?" - so it actually queries the database. A process
    that is up but cannot reach its database should be pulled out of the load balancer,
    not sent requests, which is why this returns 503.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:  # noqa: BLE001 - any failure to reach the database means not ready
        return Response({"status": "not ready", "database": "unreachable"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({"status": "ready", "database": "ok"})
`;
}

export function coreUrlsPy(): string {
  return `from django.urls import path

from . import views

urlpatterns = [
    path("health/ready", views.readiness, name="readiness"),
]
`;
}

export function modelsPy(): string {
  return `from django.db import models


class Item(models.Model):
    # Indexed because listing and lookup both sort or filter on it; an unindexed name
    # column is the first thing to hurt once the table grows.
    name = models.CharField(max_length=200, db_index=True)
    description = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return self.name
`;
}

/** Written by hand so \`migrate\` works on a fresh clone; a test asserts it matches the model. */
export function initialMigrationPy(): string {
  return `from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Item",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(db_index=True, max_length=200)),
                ("description", models.TextField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["id"]},
        ),
    ]
`;
}

export function serializersPy(): string {
  return `from rest_framework import serializers

from .models import Item


class ItemSerializer(serializers.ModelSerializer):
    """Validated at the edge: a blank or oversized name never reaches a view or a service."""

    class Meta:
        model = Item
        fields = ["id", "name", "description", "created_at"]
        # The client never chooses these. Declared here rather than trusted to the
        # caller, so adding a field later cannot quietly make it client-writable.
        read_only_fields = ["id", "created_at"]
`;
}

export function servicesPy(): string {
  return `from .models import Item


def create_item(*, name: str, description: str | None = None) -> Item:
    """
    Every write goes through here. Keyword-only arguments so a call reads clearly and
    cannot swap name and description by position.

    No request, no serializer and no HTTP status: the same function can back a view, a
    management command or a queue consumer. Business rules (uniqueness, limits) belong
    here, not in the serializer and not scattered across views.
    """
    return Item.objects.create(name=name, description=description)
`;
}

export function selectorsPy(): string {
  return `from django.db.models import QuerySet

from .models import Item


class ItemNotFoundError(Exception):
    """Raised instead of returning None, so a caller cannot forget the missing case."""

    def __init__(self, item_id: int) -> None:
        super().__init__(f"Item {item_id} does not exist")
        self.item_id = item_id


def list_items() -> QuerySet[Item]:
    """
    Returns a lazy queryset, not a list: the paginator applies LIMIT and OFFSET to it,
    so the database never materialises rows nobody asked for. Every read query for items
    lives in this module, which is what makes "is this indexed?" answerable from one file.
    """
    return Item.objects.order_by("id")


def get_item(item_id: int) -> Item:
    try:
        return Item.objects.get(pk=item_id)
    except Item.DoesNotExist:
        raise ItemNotFoundError(item_id) from None
`;
}

export function viewsPy(structure: DjangoStructure): string {
  if (structure === "service-layer") {
    return `from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.pagination import StandardPagination

from . import selectors, services
from .serializers import ItemSerializer


class ItemListCreateView(APIView):
    """HTTP only: parse, call a service or selector, shape the response. No ORM calls here."""

    def get(self, request) -> Response:
        paginator = StandardPagination()
        page = paginator.paginate_queryset(selectors.list_items(), request, view=self)
        return paginator.get_paginated_response(ItemSerializer(page, many=True).data)

    def post(self, request) -> Response:
        serializer = ItemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = services.create_item(**serializer.validated_data)
        return Response(ItemSerializer(item).data, status=status.HTTP_201_CREATED)


class ItemDetailView(APIView):
    def get(self, _request, pk: int) -> Response:
        try:
            item = selectors.get_item(pk)
        except selectors.ItemNotFoundError:
            # Translating the domain error into HTTP happens here and only here.
            raise NotFound("Item not found") from None
        return Response(ItemSerializer(item).data)
`;
  }

  return `from rest_framework import generics

from .models import Item
from .serializers import ItemSerializer


class ItemListCreateView(generics.ListCreateAPIView):
    """List (paginated by the project-wide default) and create. DRF supplies the rest."""

    queryset = Item.objects.order_by("id")
    serializer_class = ItemSerializer


class ItemDetailView(generics.RetrieveAPIView):
    """Get one item; a missing id is a 404, not a 500."""

    queryset = Item.objects.all()
    serializer_class = ItemSerializer
`;
}

export function itemsUrlsPy(): string {
  return `from django.urls import path

from . import views

urlpatterns = [
    path("items", views.ItemListCreateView.as_view(), name="item-list"),
    path("items/<int:pk>", views.ItemDetailView.as_view(), name="item-detail"),
]
`;
}

export function adminPy(): string {
  return `from django.contrib import admin

from .models import Item


@admin.register(Item)
class ItemAdmin(admin.ModelAdmin):
    list_display = ["id", "name", "created_at"]
    search_fields = ["name"]
`;
}

export function testCorePy(): string {
  return `from io import StringIO

from django.core.management import call_command
from django.test import TestCase


class HealthTests(TestCase):
    def test_liveness_is_unversioned(self) -> None:
        """Probes point at a fixed path, so /health must not move when the API version does."""
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_readiness_checks_the_database(self) -> None:
        """Readiness has to actually reach the database, not return 200 blindly."""
        response = self.client.get("/api/v1/health/ready")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ready", "database": "ok"})


class MigrationTests(TestCase):
    def test_models_and_migrations_agree(self) -> None:
        """
        The initial migration is written by hand, so this guards against it drifting from
        the model: if someone edits a field and forgets to run makemigrations, this fails
        here instead of in production.
        """
        out = StringIO()
        try:
            call_command("makemigrations", "--check", "--dry-run", stdout=out)
        except SystemExit:
            self.fail(f"Model changes have no migration:\\n{out.getvalue()}")
`;
}

export function testItemsPy(): string {
  return `from rest_framework.test import APITestCase

ITEMS = "/api/v1/items"


class ItemApiTests(APITestCase):
    def test_create_then_read_an_item(self) -> None:
        created = self.client.post(ITEMS, {"name": "first", "description": "hello"}, format="json")
        self.assertEqual(created.status_code, 201)

        fetched = self.client.get(f"{ITEMS}/{created.json()['id']}")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["name"], "first")

    def test_missing_item_is_404_not_500(self) -> None:
        self.assertEqual(self.client.get(f"{ITEMS}/999999").status_code, 404)

    def test_listing_is_paginated_and_capped(self) -> None:
        for index in range(3):
            self.client.post(ITEMS, {"name": f"item-{index}"}, format="json")

        page = self.client.get(ITEMS, {"limit": 2})
        body = page.json()

        self.assertEqual(page.status_code, 200)
        self.assertEqual(body["count"], 3)
        self.assertEqual(len(body["results"]), 2, "limit must actually bound the response")

        # DRF clamps an over-large limit to max_limit rather than returning everything.
        from apps.core.pagination import StandardPagination

        self.assertEqual(StandardPagination.max_limit, 200)

    def test_blank_name_is_rejected(self) -> None:
        self.assertEqual(self.client.post(ITEMS, {"name": ""}, format="json").status_code, 400)

    def test_client_cannot_choose_the_id(self) -> None:
        created = self.client.post(ITEMS, {"id": 424242, "name": "x"}, format="json")

        self.assertNotEqual(created.json()["id"], 424242)
`;
}
