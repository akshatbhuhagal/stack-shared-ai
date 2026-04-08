import * as fs from "fs";
import * as path from "path";
import { ScanOptions, ScanResult } from "../types";
import { walkFiles } from "../../utils/file-walker";
import { heading, joinSections, bulletList } from "../../utils/markdown";

type SchemaType = "prisma" | "drizzle" | "mongoose" | "typeorm" | "none";

interface Model {
  name: string;
  fields: string[];
  relations: string[];
  type: SchemaType;
}

// --- Prisma ---

function parsePrismaSchema(content: string): Model[] {
  const models: Model[] = [];

  // Collect enum names so we don't treat them as relations
  const enumNames = new Set<string>();
  const enumRegex = /enum\s+(\w+)\s*\{/g;
  let em;
  while ((em = enumRegex.exec(content)) !== null) {
    enumNames.add(em[1]);
  }

  // Match: model Foo { ... }
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
  let match;

  while ((match = modelRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];
    const lines = body.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//") && !l.startsWith("@@"));

    const fields: string[] = [];
    const relations: string[] = [];

    for (const line of lines) {
      // Field: `name Type modifiers`
      const fieldMatch = line.match(/^(\w+)\s+([\w\[\]?]+)(?:\s+(.+))?$/);
      if (!fieldMatch) continue;

      const fname = fieldMatch[1];
      const ftype = fieldMatch[2];
      const attrs = fieldMatch[3] ?? "";

      // Detect relation: field with @relation OR model-reference type (Capitalized)
      const bareType = ftype.replace(/[\[\]?]/g, "");
      const isScalar = ["String", "Int", "Float", "Boolean", "DateTime", "Json", "Bytes", "Decimal", "BigInt"].includes(bareType);
      const isEnum = enumNames.has(bareType);
      const isRelation = !isScalar && !isEnum && (attrs.includes("@relation") || /^[A-Z]/.test(bareType));

      if (isRelation) {
        relations.push(`${fname}: ${ftype}`);
      } else {
        const markers: string[] = [];
        if (attrs.includes("@id")) markers.push("id");
        if (attrs.includes("@unique")) markers.push("unique");
        if (attrs.includes("@default")) {
          // Balance parens so @default(cuid()) captures `cuid()` not `cuid(`
          const idx = attrs.indexOf("@default(");
          if (idx >= 0) {
            let depth = 1;
            let i = idx + "@default(".length;
            while (i < attrs.length && depth > 0) {
              if (attrs[i] === "(") depth++;
              else if (attrs[i] === ")") depth--;
              if (depth === 0) break;
              i++;
            }
            const defVal = attrs.substring(idx + "@default(".length, i);
            markers.push(`default=${defVal}`);
          }
        }
        const suffix = markers.length > 0 ? ` [${markers.join(", ")}]` : "";
        fields.push(`${fname}: ${ftype}${suffix}`);
      }
    }

    models.push({ name, fields, relations, type: "prisma" });
  }

  return models;
}

// --- Drizzle ---

function parseDrizzleSchema(content: string): Model[] {
  const models: Model[] = [];
  // Match: export const users = pgTable('users', { ... })
  //        export const users = mysqlTable(...)
  //        export const users = sqliteTable(...)
  const tableRegex = /export\s+const\s+(\w+)\s*=\s*(?:pgTable|mysqlTable|sqliteTable)\s*\(\s*['"`](\w+)['"`]\s*,\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g;
  let match;

  while ((match = tableRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[3];

    const fields: string[] = [];
    // Match: fieldName: type('col_name', {...}).modifiers()
    const fieldRegex = /(\w+):\s*(\w+)\s*\(/g;
    let fm;
    while ((fm = fieldRegex.exec(body)) !== null) {
      fields.push(`${fm[1]}: ${fm[2]}`);
    }

    if (fields.length > 0) {
      models.push({ name, fields, relations: [], type: "drizzle" });
    }
  }

  return models;
}

// --- Mongoose ---

function parseMongooseSchema(content: string): Model[] {
  const models: Model[] = [];
  // Match: const userSchema = new Schema({ ... }) or mongoose.Schema({...})
  //        const User = mongoose.model('User', userSchema)
  const schemaRegex = /(?:const|let|var)\s+(\w+Schema)\s*=\s*new\s+(?:mongoose\.)?Schema\s*\(\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g;
  const modelNameMap = new Map<string, string>(); // schemaVar → modelName

  // Find mongoose.model calls: mongoose.model('User', userSchema)
  const modelRegex = /mongoose\.model\s*\(\s*['"`](\w+)['"`]\s*,\s*(\w+)\s*\)/g;
  let mm;
  while ((mm = modelRegex.exec(content)) !== null) {
    modelNameMap.set(mm[2], mm[1]);
  }

  let match;
  while ((match = schemaRegex.exec(content)) !== null) {
    const schemaVar = match[1];
    const body = match[2];

    const fields: string[] = [];
    // Match: fieldName: Type  OR  fieldName: { type: Type, ... }
    const fieldRegex = /(\w+):\s*(?:\{[^}]*type:\s*(\w+)[^}]*\}|(\w+))/g;
    let fm;
    while ((fm = fieldRegex.exec(body)) !== null) {
      const fname = fm[1];
      const ftype = fm[2] || fm[3];
      if (ftype && ftype !== "type") {
        fields.push(`${fname}: ${ftype}`);
      }
    }

    const modelName = modelNameMap.get(schemaVar) ?? schemaVar.replace(/Schema$/, "");
    if (fields.length > 0) {
      models.push({ name: modelName, fields, relations: [], type: "mongoose" });
    }
  }

  return models;
}

// --- TypeORM ---

function parseTypeORMEntities(content: string): Model[] {
  const models: Model[] = [];

  // Match: @Entity() ... class Foo { ... }
  if (!content.includes("@Entity")) return models;

  const classRegex = /@Entity\s*\([^)]*\)\s*(?:export\s+)?class\s+(\w+)\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g;
  let match;

  while ((match = classRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];

    const fields: string[] = [];
    const relations: string[] = [];

    // Match field with @Column or relation decorators
    const fieldRegex = /@(Column|PrimaryGeneratedColumn|PrimaryColumn|ManyToOne|OneToMany|ManyToMany|OneToOne|CreateDateColumn|UpdateDateColumn)\s*\([^)]*\)\s*(\w+)(?:!|\?)?\s*:\s*([\w<>\[\]]+)/g;
    let fm;
    while ((fm = fieldRegex.exec(body)) !== null) {
      const decorator = fm[1];
      const fname = fm[2];
      const ftype = fm[3];

      if (["ManyToOne", "OneToMany", "ManyToMany", "OneToOne"].includes(decorator)) {
        relations.push(`${fname}: ${ftype} (${decorator})`);
      } else {
        const markers: string[] = [];
        if (decorator.startsWith("Primary")) markers.push("pk");
        if (decorator === "CreateDateColumn") markers.push("created");
        if (decorator === "UpdateDateColumn") markers.push("updated");
        const suffix = markers.length > 0 ? ` [${markers.join(", ")}]` : "";
        fields.push(`${fname}: ${ftype}${suffix}`);
      }
    }

    if (fields.length > 0 || relations.length > 0) {
      models.push({ name, fields, relations, type: "typeorm" });
    }
  }

  return models;
}

export async function scanSchema(options: ScanOptions): Promise<ScanResult | null> {
  const models: Model[] = [];
  let detectedType: SchemaType = "none";

  // 1. Prisma — look for schema.prisma file
  const prismaPaths = [
    options.schema,
    path.join(options.rootDir, "prisma", "schema.prisma"),
    path.join(options.rootDir, "schema.prisma"),
  ].filter(Boolean) as string[];

  for (const p of prismaPaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf-8");
      const prismaModels = parsePrismaSchema(content);
      if (prismaModels.length > 0) {
        models.push(...prismaModels);
        detectedType = "prisma";
        break;
      }
    }
  }

  // 2. Drizzle / Mongoose / TypeORM — scan TS/JS files
  if (detectedType === "none") {
    const files = walkFiles(options.rootDir, {
      include: options.include,
      exclude: options.exclude,
      extensions: [".ts", ".js"],
    });

    for (const file of files) {
      let content: string;
      try {
        content = fs.readFileSync(file, "utf-8");
      } catch {
        continue;
      }

      if (content.includes("pgTable") || content.includes("mysqlTable") || content.includes("sqliteTable")) {
        const drizzleModels = parseDrizzleSchema(content);
        if (drizzleModels.length > 0) {
          models.push(...drizzleModels);
          detectedType = "drizzle";
        }
      } else if (content.includes("mongoose.Schema") || content.includes("new Schema(")) {
        const mongooseModels = parseMongooseSchema(content);
        if (mongooseModels.length > 0) {
          models.push(...mongooseModels);
          detectedType = "mongoose";
        }
      } else if (content.includes("@Entity")) {
        const typeormModels = parseTypeORMEntities(content);
        if (typeormModels.length > 0) {
          models.push(...typeormModels);
          detectedType = "typeorm";
        }
      }
    }
  }

  if (models.length === 0) return null;

  // Build markdown
  const typeLabel = {
    prisma: "Prisma",
    drizzle: "Drizzle ORM",
    mongoose: "Mongoose",
    typeorm: "TypeORM",
    none: "Unknown",
  }[detectedType];

  const sections: string[] = [
    heading(1, "Database Schema"),
    heading(2, `ORM: ${typeLabel}`),
  ];

  for (const model of models) {
    const lines = [...model.fields];
    if (model.relations.length > 0) {
      lines.push(`**Relations:** ${model.relations.join(", ")}`);
    }
    sections.push(joinSections(heading(3, model.name), bulletList(lines)));
  }

  return {
    filename: "schema.md",
    content: sections.join("\n\n") + "\n",
  };
}
