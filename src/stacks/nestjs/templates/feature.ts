/**
 * The example feature: one Item, modelled end to end, so the generated project is
 * a working reference to copy rather than an empty folder tree.
 *
 * In "clean" the domain entity and the repository port are separate files and
 * Prisma appears only in infrastructure, bound to the port in the module.
 */

export function dtoTs(): string {
  return `import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class ListItemsQueryDto {
  /**
   * The cap lives here, not in the handler: validation rejects limit=100000 before
   * any code runs, and no later edit to the controller can quietly remove it.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

export class ItemResponseDto {
  id!: number;
  name!: string;
  description!: string | null;
  createdAt!: Date;
}

export class ItemPageDto {
  items!: ItemResponseDto[];
  total!: number;
  limit!: number;
  offset!: number;
}
`;
}

export function entityTs(): string {
  return `/**
 * The domain's own Item: no Nest decorators, no Prisma types, no HTTP.
 *
 * Nothing in this folder imports outward. That is what lets the rules be tested
 * without a database and keeps a schema change from rippling into them.
 */
export interface Item {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: Date;
}

/** A new item, before storage has assigned it an id or a timestamp. */
export interface NewItem {
  readonly name: string;
  readonly description: string | null;
}
`;
}

export function repositoryPortTs(): string {
  return `import type { Item, NewItem } from "./item.entity";

/**
 * What the application layer needs from storage, declared by the domain rather
 * than by the database. Infrastructure implements this; a test implements it with
 * an array.
 */
export interface ItemsRepository {
  add(item: NewItem): Promise<Item>;
  findById(id: number): Promise<Item | null>;
  findPage(limit: number, offset: number): Promise<{ items: Item[]; total: number }>;
}

/**
 * Interfaces vanish at runtime, so Nest needs a token to inject by. Exported from
 * the domain because the domain is what declares the dependency.
 */
export const ITEMS_REPOSITORY = Symbol("ITEMS_REPOSITORY");
`;
}

export function repositoryTs(isClean: boolean): string {
  if (isClean) {
    return `import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import type { Item, NewItem } from "../domain/item.entity";
import type { ItemsRepository } from "../domain/items.repository.port";

/** The Prisma-backed implementation of the domain's port. Nothing else imports this. */
@Injectable()
export class PrismaItemsRepository implements ItemsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async add(item: NewItem): Promise<Item> {
    return this.prisma.item.create({ data: { name: item.name, description: item.description } });
  }

  async findById(id: number): Promise<Item | null> {
    return this.prisma.item.findUnique({ where: { id } });
  }

  async findPage(limit: number, offset: number): Promise<{ items: Item[]; total: number }> {
    // One round trip for both, and never an unbounded read.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.item.findMany({ take: limit, skip: offset, orderBy: { id: "asc" } }),
      this.prisma.item.count(),
    ]);
    return { items, total };
  }
}
`;
  }

  return `import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export interface ItemRecord {
  id: number;
  name: string;
  description: string | null;
  createdAt: Date;
}

/**
 * Every query for this feature lives here. Keeping Prisma out of the service is
 * what makes "is this query indexed?" answerable by reading one file - and lets
 * the service be unit-tested without a database.
 */
@Injectable()
export class ItemsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async add(name: string, description: string | null): Promise<ItemRecord> {
    return this.prisma.item.create({ data: { name, description } });
  }

  async findById(id: number): Promise<ItemRecord | null> {
    return this.prisma.item.findUnique({ where: { id } });
  }

  async findPage(limit: number, offset: number): Promise<{ items: ItemRecord[]; total: number }> {
    // One round trip for both, and never an unbounded read.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.item.findMany({ take: limit, skip: offset, orderBy: { id: "asc" } }),
      this.prisma.item.count(),
    ]);
    return { items, total };
  }
}
`;
}

export function serviceTs(isClean: boolean): string {
  if (isClean) {
    return `import { Inject, Injectable } from "@nestjs/common";
import type { Item } from "../domain/item.entity";
import { ITEMS_REPOSITORY, type ItemsRepository } from "../domain/items.repository.port";

export class ItemNotFoundError extends Error {
  constructor(readonly itemId: number) {
    super(\`Item \${itemId} does not exist\`);
    this.name = "ItemNotFoundError";
  }
}

/**
 * The use cases. Depends on the port, never on Prisma - so these rules can be
 * tested against an array, and the storage choice can change without touching them.
 * Throws a plain error rather than HttpException, which is what lets this same
 * service back a CLI or a queue consumer.
 */
@Injectable()
export class ItemsService {
  constructor(@Inject(ITEMS_REPOSITORY) private readonly repository: ItemsRepository) {}

  async create(name: string, description: string | null): Promise<Item> {
    return this.repository.add({ name, description });
  }

  async getById(id: number): Promise<Item> {
    const item = await this.repository.findById(id);
    if (item === null) {
      throw new ItemNotFoundError(id);
    }
    return item;
  }

  async list(limit: number, offset: number): Promise<{ items: Item[]; total: number }> {
    return this.repository.findPage(limit, offset);
  }
}
`;
  }

  return `import { Injectable } from "@nestjs/common";
import { ItemsRepository, type ItemRecord } from "./items.repository";

export class ItemNotFoundError extends Error {
  constructor(readonly itemId: number) {
    super(\`Item \${itemId} does not exist\`);
    this.name = "ItemNotFoundError";
  }
}

/**
 * The business rules. Takes a repository, not a Prisma client, so it can be unit
 * tested with a fake. Throws a plain error rather than HttpException: translating
 * to HTTP is the controller's job, which is what lets this service also back a CLI
 * or a queue consumer.
 */
@Injectable()
export class ItemsService {
  constructor(private readonly repository: ItemsRepository) {}

  async create(name: string, description: string | null): Promise<ItemRecord> {
    return this.repository.add(name, description);
  }

  async getById(id: number): Promise<ItemRecord> {
    const item = await this.repository.findById(id);
    if (item === null) {
      throw new ItemNotFoundError(id);
    }
    return item;
  }

  async list(limit: number, offset: number): Promise<{ items: ItemRecord[]; total: number }> {
    return this.repository.findPage(limit, offset);
  }
}
`;
}

export function controllerTs(isClean: boolean): string {
  const dtoPath = isClean ? "./dto/item.dto" : "./dto/item.dto";
  const servicePath = isClean ? "../application/items.service" : "./items.service";

  return `import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseIntPipe, Post, Query } from "@nestjs/common";
import { CreateItemDto, ItemPageDto, ItemResponseDto, ListItemsQueryDto } from "${dtoPath}";
import { ItemNotFoundError, ItemsService } from "${servicePath}";

@Controller("items")
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateItemDto): Promise<ItemResponseDto> {
    return this.items.create(body.name, body.description ?? null);
  }

  @Get()
  async list(@Query() query: ListItemsQueryDto): Promise<ItemPageDto> {
    const { items, total } = await this.items.list(query.limit, query.offset);
    return { items, total, limit: query.limit, offset: query.offset };
  }

  @Get(":id")
  async getOne(@Param("id", ParseIntPipe) id: number): Promise<ItemResponseDto> {
    try {
      return await this.items.getById(id);
    } catch (error) {
      // Translating the domain error into HTTP happens here and only here.
      if (error instanceof ItemNotFoundError) {
        throw new NotFoundException("Item not found");
      }
      throw error;
    }
  }
}
`;
}

export function moduleTs(isClean: boolean): string {
  if (isClean) {
    return `import { Module } from "@nestjs/common";
import { ItemsController } from "./api/items.controller";
import { ItemsService } from "./application/items.service";
import { ITEMS_REPOSITORY } from "./domain/items.repository.port";
import { PrismaItemsRepository } from "./infrastructure/prisma-items.repository";

/**
 * The only file that knows which implementation backs the port. Swapping storage
 * is this one line, and the service never changes.
 */
@Module({
  controllers: [ItemsController],
  providers: [ItemsService, { provide: ITEMS_REPOSITORY, useClass: PrismaItemsRepository }],
  exports: [ItemsService],
})
export class ItemsModule {}
`;
  }

  return `import { Module } from "@nestjs/common";
import { ItemsController } from "./items.controller";
import { ItemsRepository } from "./items.repository";
import { ItemsService } from "./items.service";

@Module({
  controllers: [ItemsController],
  providers: [ItemsService, ItemsRepository],
  exports: [ItemsService],
})
export class ItemsModule {}
`;
}
