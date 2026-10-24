import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import {
  API_SCHEME,
  type ApiCode,
  type ApiCodeLink,
  type ApiEntry,
  type ApiKind,
  type ApiMember,
  type ApiModel,
  type ApiSource,
  type ApiSymbol,
  type ApiTarget,
  type ApiWarning
} from './model';
import { excerpt, startAfterExport } from './source';

/** The packages whose entry points the reference covers, in its order. */
const PACKAGES = ['core', 'vue', 'react'];

/** The order of the kinds on a page. */
export const KIND_ORDER: readonly ApiKind[] = [
  'function',
  'component',
  'class',
  'interface',
  'type',
  'variable'
];

interface EntryFile {
  readonly name: string;
  readonly specifier: string;
  readonly file: string;
}

interface Manifest {
  readonly name: string;
  readonly exports: Readonly<Record<string, string | Readonly<Record<string, string>>>>;
}

/** Every entry point of the packages, from the `exports` of their manifests. */
export function entryFiles(repoRoot: string): EntryFile[] {
  return PACKAGES.flatMap((directory) => {
    const root = join(repoRoot, 'packages', directory);
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest;
    return Object.entries(manifest.exports).flatMap(([key, value]) => {
      if (typeof value === 'string') {
        return [];
      }

      const source = value['@kumochart-sdk/source'];

      if (source === undefined) {
        throw new Error(`${manifest.name} exports ${key} without a @kumochart-sdk/source file.`);
      }

      const subpath = key === '.' ? '' : `/${key.slice(2)}`;
      return [
        {
          name: `${directory}${subpath}`,
          specifier: `${manifest.name}${subpath}`,
          file: join(root, source)
        }
      ];
    });
  });
}

/** The program of the packages, with the compiler options of the repository. */
function createProgram(repoRoot: string, files: readonly string[]): ts.Program {
  const configFile = join(repoRoot, 'tsconfig.base.json');
  const read = ts.readConfigFile(configFile, (path) => ts.sys.readFile(path));

  if (read.error) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  }

  const config = read.config as { compilerOptions: Record<string, unknown> };
  const parsed = ts.parseJsonConfigFileContent(
    { compilerOptions: { ...config.compilerOptions, types: [] } },
    ts.sys,
    repoRoot
  );
  return ts.createProgram({ rootNames: [...files], options: parsed.options });
}

function kindOf(declaration: ts.Declaration): ApiKind | null {
  if (ts.isFunctionDeclaration(declaration)) {
    return 'function';
  }

  if (ts.isClassDeclaration(declaration)) {
    return 'class';
  }

  if (ts.isInterfaceDeclaration(declaration)) {
    return 'interface';
  }

  if (ts.isTypeAliasDeclaration(declaration)) {
    return 'type';
  }

  if (ts.isVariableDeclaration(declaration)) {
    return componentProps(declaration) ? 'component' : 'variable';
  }

  return null;
}

/**
 * The `props` of a Vue component made with `defineComponent({ props: { … } })`, written there or
 * in a constant of the same file.
 */
function componentProps(declaration: ts.VariableDeclaration): ts.ObjectLiteralExpression | null {
  const initializer = declaration.initializer;

  if (
    !initializer ||
    !ts.isCallExpression(initializer) ||
    !ts.isIdentifier(initializer.expression) ||
    initializer.expression.text !== 'defineComponent'
  ) {
    return null;
  }

  const options = initializer.arguments[0];
  const props =
    options && ts.isObjectLiteralExpression(options)
      ? options.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) && property.name.getText() === 'props'
        )
      : undefined;
  const value = props?.initializer;

  if (value && ts.isIdentifier(value)) {
    return constantObject(declaration.getSourceFile(), value.text);
  }

  return value && ts.isObjectLiteralExpression(value) ? value : null;
}

/** The object literal a top-level constant of a file is set to, or `null`. */
function constantObject(file: ts.SourceFile, name: string): ts.ObjectLiteralExpression | null {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const each of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(each.name) &&
        each.name.text === name &&
        each.initializer &&
        ts.isObjectLiteralExpression(each.initializer)
      ) {
        return each.initializer;
      }
    }
  }

  return null;
}

function memberName(member: ts.Node): string {
  if (ts.isCallSignatureDeclaration(member)) {
    return '(call)';
  }

  if (ts.isConstructSignatureDeclaration(member) || ts.isConstructorDeclaration(member)) {
    return 'constructor';
  }

  if (ts.isIndexSignatureDeclaration(member)) {
    return '[index]';
  }

  const name = (member as { name?: ts.Node }).name;
  return name ? name.getText() : '(member)';
}

/** Whether a class member is hidden from the users of the class. */
function isHidden(member: ts.ClassElement): boolean {
  const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
  return (
    modifiers.some(
      (modifier) =>
        modifier.kind === ts.SyntaxKind.PrivateKeyword ||
        modifier.kind === ts.SyntaxKind.ProtectedKeyword
    ) ||
    (member.name !== undefined && ts.isPrivateIdentifier(member.name))
  );
}

const PRINT_FLAGS: ts.TypeFormatFlags =
  ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

/** Extracts the API reference of every entry point from the sources and their comments. */
export function extractApi(repoRoot: string): ApiModel {
  const entries = entryFiles(repoRoot);
  const program = createProgram(
    repoRoot,
    entries.map((entry) => entry.file)
  );
  const checker = program.getTypeChecker();
  const warnings: ApiWarning[] = [];
  const warned = new Set<string>();
  /** Symbols documented on a page, by the symbol of their declaration. */
  const targets = new Map<ts.Symbol, ApiTarget>();
  /** Members of interfaces and classes, for comments that link to them. */
  const memberTargets = new Map<ts.Symbol, ApiTarget>();
  /** Documented symbols by name, for types the checker prints. */
  const byName = new Map<string, ApiTarget[]>();

  const resolve = (symbol: ts.Symbol): ts.Symbol =>
    (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;

  const sourceOf = (node: ts.Node): ApiSource => {
    const file = node.getSourceFile();
    return {
      file: relative(repoRoot, file.fileName).split(sep).join('/'),
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
    };
  };

  /** Warns once per `key`. */
  const warn = (node: ts.Node, message: string, key = message) => {
    const source = sourceOf(node);

    if (!warned.has(key)) {
      warned.add(key);
      warnings.push({ ...source, message });
    }
  };

  const exportsOf = (entry: EntryFile): ts.Symbol[] => {
    const file = program.getSourceFile(entry.file);
    const module = file && checker.getSymbolAtLocation(file);

    if (!module) {
      throw new Error(`The entry point ${entry.file} could not be read.`);
    }

    return checker.getExportsOfModule(module);
  };

  // First the anchor of every symbol and member, so that any declaration can link to any other.
  const primary = new Map<string, { exported: ts.Symbol; symbol: ts.Symbol }[]>();
  const reexports = new Map<string, { name: string; target: ApiTarget }[]>();

  for (const entry of entries) {
    for (const exported of exportsOf(entry)) {
      const symbol = resolve(exported);
      const existing = targets.get(symbol);

      if (existing) {
        reexports.set(entry.name, [
          ...(reexports.get(entry.name) ?? []),
          { name: exported.name, target: existing }
        ]);
        continue;
      }

      const target = { entry: entry.name, anchor: exported.name };
      targets.set(symbol, target);
      byName.set(exported.name, [...(byName.get(exported.name) ?? []), target]);
      primary.set(entry.name, [...(primary.get(entry.name) ?? []), { exported, symbol }]);

      for (const declaration of symbol.declarations ?? []) {
        if (ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration)) {
          for (const member of declaration.members) {
            const memberSymbol = (member as { symbol?: ts.Symbol }).symbol;

            if (memberSymbol) {
              memberTargets.set(memberSymbol, {
                entry: entry.name,
                anchor: `${exported.name}.${memberName(member)}`
              });
            }
          }
        }
      }
    }
  }

  /** Links of the identifiers in a node that name documented symbols. */
  const linksIn = (node: ts.Node, offset: (position: number) => number | null): ApiCodeLink[] => {
    const links: ApiCodeLink[] = [];
    const file = node.getSourceFile();

    const visit = (child: ts.Node) => {
      const start = offset(child.getStart(file));
      const end = offset(child.end);

      if (
        ts.isIdentifier(child) &&
        (child.parent as { name?: ts.Node }).name !== child &&
        start !== null &&
        end !== null
      ) {
        const found = checker.getSymbolAtLocation(child);
        const symbol = found && resolve(found);
        const target = symbol && targets.get(symbol);

        if (target) {
          links.push({ start, end, target });
        } else if (symbol) {
          const declaration = symbol.declarations?.[0];
          const inPackages = declaration
            ? relative(join(repoRoot, 'packages'), declaration.getSourceFile().fileName)
            : '..';

          if (
            declaration &&
            !inPackages.startsWith('..') &&
            (ts.isInterfaceDeclaration(declaration) ||
              ts.isTypeAliasDeclaration(declaration) ||
              ts.isClassDeclaration(declaration)) &&
            ts.isSourceFile(declaration.parent)
          ) {
            warn(
              child,
              `${child.text} is part of the public API but not exported`,
              `export ${child.text}`
            );
          }
        }
      }

      ts.forEachChild(child, visit);
    };

    visit(node);
    return links;
  };

  /** Links of a type the checker printed, by the names in it. */
  const printedLinks = (text: string, entry: string, from: number): ApiCodeLink[] => {
    const prefix = 'type T = ';
    const file = ts.createSourceFile(
      'printed.ts',
      `${prefix}${text};`,
      ts.ScriptTarget.Latest,
      true
    );
    const links: ApiCodeLink[] = [];

    const visit = (node: ts.Node) => {
      const name = ts.isTypeReferenceNode(node)
        ? node.typeName
        : ts.isTypeQueryNode(node)
          ? node.exprName
          : null;

      if (name && ts.isIdentifier(name)) {
        const candidates = byName.get(name.text) ?? [];
        const target = candidates.find((item) => item.entry === entry) ?? candidates[0];

        if (target) {
          const start = name.getStart(file) - prefix.length + from;
          links.push({ start, end: start + name.text.length, target });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(file);
    return links;
  };

  const code = (node: ts.Node, start: number, end: number, indent = 0): ApiCode => {
    const part = excerpt(node.getSourceFile(), start, end, indent);
    return { text: part.text, links: linksIn(node, part.offset) };
  };

  /** A comment as Markdown, its links as links to the API. */
  const docOf = (node: ts.Node, container: ts.Node | null): string => {
    const comments = ts.getJSDocCommentsAndTags(node).filter((item) => ts.isJSDoc(item));
    const comment = comments[comments.length - 1]?.comment;

    if (comment === undefined) {
      return '';
    }

    if (typeof comment === 'string') {
      return comment;
    }

    return comment
      .map((part) => {
        if (ts.isJSDocLink(part) || ts.isJSDocLinkCode(part) || ts.isJSDocLinkPlain(part)) {
          const name = part.name ? part.name.getText() : '';
          const label = part.text.trim() === '' ? name : part.text.trim();
          const found = part.name && checker.getSymbolAtLocation(part.name);
          const symbol = found && resolve(found);
          let target = symbol && (targets.get(symbol) ?? memberTargets.get(symbol));

          if (
            !target &&
            container &&
            (ts.isInterfaceDeclaration(container) || ts.isClassDeclaration(container))
          ) {
            const member = container.members.find((item) => memberName(item) === name);
            const memberSymbol = member && (member as { symbol?: ts.Symbol }).symbol;
            target = memberSymbol && memberTargets.get(memberSymbol);
          }

          if (!target) {
            const source = sourceOf(part);
            warn(
              part,
              `{@link ${name}} names nothing in the API reference`,
              `${source.file}:${source.line}:${name}`
            );
            return `\`${label}\``;
          }

          const text = label === name ? `\`${label}\`` : label;
          return `[${text}](${API_SCHEME}${target.entry}#${target.anchor})`;
        }

        return part.text;
      })
      .join('');
  };

  const functionCode = (
    declaration: ts.SignatureDeclaration & { body?: ts.Node | undefined },
    entry: string,
    indent = 0
  ): ApiCode => {
    const file = declaration.getSourceFile();
    const start = startAfterExport(declaration, file);
    const end = declaration.body ? declaration.body.getStart(file) : declaration.end;
    const base = code(declaration, start, end, indent);

    if (declaration.type || ts.isConstructorDeclaration(declaration)) {
      return base;
    }

    const signature = checker.getSignatureFromDeclaration(declaration);
    const returned = signature
      ? checker.typeToString(signature.getReturnType(), declaration, PRINT_FLAGS)
      : 'void';
    const text = `${base.text}: ${returned}`;
    return {
      text,
      links: [...base.links, ...printedLinks(returned, entry, base.text.length + 2)]
    };
  };

  const membersOf = (
    owner: string,
    entry: string,
    declaration: ts.InterfaceDeclaration | ts.ClassDeclaration
  ): ApiMember[] => {
    const file = declaration.getSourceFile();
    const members = new Map<string, { code: ApiCode[]; doc: string; source: ApiSource }>();

    for (const member of declaration.members) {
      if (ts.isClassElement(member) && isHidden(member)) {
        continue;
      }

      const name = memberName(member);
      const start = member.getStart(file);
      const indent = file.getLineAndCharacterOfPosition(start).character;
      const body = (member as { body?: ts.Node }).body;
      const part =
        ts.isMethodSignature(member) ||
        ts.isMethodDeclaration(member) ||
        ts.isCallSignatureDeclaration(member)
          ? functionCode(member, entry, indent)
          : code(member, start, body ? body.getStart(file) : member.end, indent);
      const existing = members.get(name);

      if (existing) {
        existing.code.push(part);
        existing.doc ||= docOf(member, declaration);
      } else {
        members.set(name, {
          code: [part],
          doc: docOf(member, declaration),
          source: sourceOf(member)
        });
      }
    }

    return [...members].map(([name, member]) => ({ name, anchor: `${owner}.${name}`, ...member }));
  };

  const propsOf = (owner: string, props: ts.ObjectLiteralExpression): ApiMember[] =>
    props.properties.filter(ts.isPropertyAssignment).map((prop) => {
      const name = prop.name.getText();
      const options = prop.initializer;
      const type =
        ts.isObjectLiteralExpression(options) &&
        options.properties
          .filter(ts.isPropertyAssignment)
          .find((option) => option.name.getText() === 'type')?.initializer;
      const propType =
        type && ts.isAsExpression(type) && ts.isTypeReferenceNode(type.type)
          ? type.type.typeArguments?.[0]
          : undefined;

      if (!propType) {
        throw new Error(`The prop ${owner}.${name} has no "type: … as PropType<…>".`);
      }

      const file = prop.getSourceFile();
      const typeCode = code(propType, propType.getStart(file), propType.end);
      const prefix = `${name}?: `;
      return {
        name,
        anchor: `${owner}.${name}`,
        code: [
          {
            text: `${prefix}${typeCode.text}`,
            links: typeCode.links.map((link) => ({
              ...link,
              start: link.start + prefix.length,
              end: link.end + prefix.length
            }))
          }
        ],
        doc: docOf(prop, null),
        source: sourceOf(prop)
      };
    });

  const variableCode = (declaration: ts.VariableDeclaration, entry: string): ApiCode => {
    const keyword = (declaration.parent.flags & ts.NodeFlags.Const) !== 0 ? 'const' : 'let';
    const prefix = `${keyword} ${declaration.name.getText()}: `;

    if (componentProps(declaration)) {
      return {
        text: `${keyword} ${declaration.name.getText()} = defineComponent({ … })`,
        links: []
      };
    }

    if (declaration.type) {
      const file = declaration.getSourceFile();
      const type = code(declaration.type, declaration.type.getStart(file), declaration.type.end);
      return {
        text: `${prefix}${type.text}`,
        links: type.links.map((link) => ({
          ...link,
          start: link.start + prefix.length,
          end: link.end + prefix.length
        }))
      };
    }

    const printed = checker.typeToString(
      checker.getTypeAtLocation(declaration),
      declaration,
      PRINT_FLAGS
    );
    return { text: `${prefix}${printed}`, links: printedLinks(printed, entry, prefix.length) };
  };

  const symbolOf = (entry: string, exported: ts.Symbol, symbol: ts.Symbol): ApiSymbol | null => {
    const declarations = (symbol.declarations ?? []).filter((item) => kindOf(item) !== null);
    const first = declarations[0];

    if (!first) {
      return null;
    }

    const kind = kindOf(first) ?? 'variable';
    const functions = declarations.filter(ts.isFunctionDeclaration);
    // An overloaded function shows its overloads, not its implementation.
    const overloads = functions.filter((item) => !item.body);
    const shown =
      functions.length > 1 && overloads.length > 0
        ? declarations.filter((item) => !ts.isFunctionDeclaration(item) || !item.body)
        : declarations;
    const file = first.getSourceFile();
    const codes: ApiCode[] = [];
    let members: ApiMember[] = [];

    for (const declaration of shown) {
      if (ts.isFunctionDeclaration(declaration)) {
        codes.push(functionCode(declaration, entry));
      } else if (ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration)) {
        const start = startAfterExport(declaration, file);
        codes.push(code(declaration, start, declaration.members.pos - 1));
        members = [...members, ...membersOf(exported.name, entry, declaration)];
      } else if (ts.isTypeAliasDeclaration(declaration)) {
        codes.push(code(declaration, startAfterExport(declaration, file), declaration.end));
      } else if (ts.isVariableDeclaration(declaration)) {
        codes.push(variableCode(declaration, entry));
        const props = componentProps(declaration);

        if (props) {
          members = [...members, ...propsOf(exported.name, props)];
        }
      }
    }

    const doc =
      shown.map((declaration) => docOf(declaration, declaration)).find((text) => text !== '') ?? '';
    return { name: exported.name, kind, entry, code: codes, doc, members, source: sourceOf(first) };
  };

  const kindRank = (kind: ApiKind) => KIND_ORDER.indexOf(kind);
  const result: ApiEntry[] = entries.map((entry) => ({
    name: entry.name,
    specifier: entry.specifier,
    symbols: (primary.get(entry.name) ?? [])
      .map(({ exported, symbol }) => symbolOf(entry.name, exported, symbol))
      .filter((symbol) => symbol !== null)
      .sort(
        (a, b) =>
          kindRank(a.kind) - kindRank(b.kind) ||
          a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
          a.name.localeCompare(b.name, 'en')
      ),
    reexports: reexports.get(entry.name) ?? []
  }));

  return { entries: result, warnings };
}
