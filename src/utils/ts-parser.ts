import { Project, SourceFile, SyntaxKind, Node } from "ts-morph";

let project: Project | null = null;

export function getProject(rootDir: string): Project {
  if (!project) {
    project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
      },
    });
  }
  return project;
}

export function addSourceFile(project: Project, filePath: string): SourceFile {
  const existing = project.getSourceFile(filePath);
  if (existing) return existing;
  return project.addSourceFileAtPath(filePath);
}

export interface ExportedFunction {
  name: string;
  params: { name: string; type: string }[];
  returnType: string;
  isAsync: boolean;
  filePath: string;
}

export interface ExportedClass {
  name: string;
  methods: ExportedFunction[];
  properties: { name: string; type: string }[];
  filePath: string;
  extends?: string;
}

export function extractExportedFunctions(sourceFile: SourceFile): ExportedFunction[] {
  const functions: ExportedFunction[] = [];

  for (const fn of sourceFile.getFunctions()) {
    if (!fn.isExported()) continue;
    functions.push({
      name: fn.getName() || "anonymous",
      params: fn.getParameters().map((p) => ({
        name: p.getName(),
        type: p.getType().getText() || "any",
      })),
      returnType: fn.getReturnType().getText() || "void",
      isAsync: fn.isAsync(),
      filePath: sourceFile.getFilePath(),
    });
  }

  // Also check for exported arrow functions: export const fn = () => ...
  for (const varStmt of sourceFile.getVariableStatements()) {
    if (!varStmt.isExported()) continue;
    for (const decl of varStmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        functions.push({
          name: decl.getName(),
          params: init.getParameters().map((p) => ({
            name: p.getName(),
            type: p.getType().getText() || "any",
          })),
          returnType: init.getReturnType().getText() || "void",
          isAsync: init.isAsync(),
          filePath: sourceFile.getFilePath(),
        });
      }
    }
  }

  return functions;
}

export function extractExportedClasses(sourceFile: SourceFile): ExportedClass[] {
  const classes: ExportedClass[] = [];

  for (const cls of sourceFile.getClasses()) {
    if (!cls.isExported()) continue;

    const methods: ExportedFunction[] = cls.getMethods()
      .filter((m) => !m.getName().startsWith("_"))
      .map((m) => ({
        name: m.getName(),
        params: m.getParameters().map((p) => ({
          name: p.getName(),
          type: p.getType().getText() || "any",
        })),
        returnType: m.getReturnType().getText() || "void",
        isAsync: m.isAsync(),
        filePath: sourceFile.getFilePath(),
      }));

    const properties = cls.getProperties()
      .filter((p) => !p.getName().startsWith("_"))
      .map((p) => ({
        name: p.getName(),
        type: p.getType().getText() || "any",
      }));

    classes.push({
      name: cls.getName() || "AnonymousClass",
      methods,
      properties,
      filePath: sourceFile.getFilePath(),
      extends: cls.getExtends()?.getText(),
    });
  }

  return classes;
}

export function resetProject(): void {
  project = null;
}
