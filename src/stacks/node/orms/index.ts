import type { NodeOrm } from "../types.js";
import { drizzlePlugin } from "./drizzle.js";
import { prismaPlugin } from "./prisma.js";
import { sequelizePlugin } from "./sequelize.js";
import { typeormPlugin } from "./typeorm.js";
import type { OrmPlugin } from "./types.js";

const PLUGINS: Partial<Record<NodeOrm, OrmPlugin>> = {
  prisma: prismaPlugin,
  drizzle: drizzlePlugin,
  typeorm: typeormPlugin,
  sequelize: sequelizePlugin,
};

/** The plug-in for an ORM, or undefined for "none" (and for any ORM not built yet). */
export function ormPlugin(orm: NodeOrm): OrmPlugin | undefined {
  return PLUGINS[orm];
}

/** The interactive ORM menu: every registered plug-in by its own label, then "none". */
export function ormMenuOptions(): { value: NodeOrm; label: string }[] {
  const orms = Object.values(PLUGINS).map((plugin) => ({ value: plugin.id, label: plugin.label }));
  return [...orms, { value: "none", label: "None (routes only)" }];
}

/** The ORMs that can actually be generated - derived from what is registered, so it cannot drift. */
export function implementedOrms(): NodeOrm[] {
  return ["none", ...(Object.keys(PLUGINS) as NodeOrm[])];
}
