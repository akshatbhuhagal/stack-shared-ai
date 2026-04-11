// Dart symbol extractor for stack-shared-ai.
//
// Reads a list of Dart file paths from argv (or one per line from stdin if
// no args are given), parses each one via the official `analyzer` package
// (syntactic parse only — no resolution, so it's fast and needs no pub get
// of the user's project), and emits a single JSON array to stdout with the
// shape consumed by `src/utils/dart-analyzer-bridge.ts`.
//
// One entry per input file:
//   { "file": "...", "classes": [...], "enums": [...] }
// or on error:
//   { "file": "...", "error": "message" }

import 'dart:convert';
import 'dart:io';

import 'package:analyzer/dart/analysis/utilities.dart';
import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/visitor.dart';

Future<void> main(List<String> args) async {
  List<String> files = args.toList();
  if (files.isEmpty) {
    // Read newline-separated file paths from stdin
    final input = await stdin.transform(utf8.decoder).join();
    files = input
        .split(RegExp(r'\r?\n'))
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList();
  }

  final output = <Map<String, dynamic>>[];
  for (final path in files) {
    try {
      final content = File(path).readAsStringSync();
      final parseResult = parseString(
        content: content,
        throwIfDiagnostics: false,
      );
      final visitor = _SymbolVisitor(path);
      parseResult.unit.visitChildren(visitor);
      output.add({
        'file': path,
        'classes': visitor.classes,
        'enums': visitor.enums,
      });
    } catch (e) {
      output.add({'file': path, 'error': e.toString()});
    }
  }

  stdout.write(jsonEncode(output));
}

class _SymbolVisitor extends RecursiveAstVisitor<void> {
  final String filePath;
  final List<Map<String, dynamic>> classes = [];
  final List<Map<String, dynamic>> enums = [];

  _SymbolVisitor(this.filePath);

  @override
  void visitClassDeclaration(ClassDeclaration node) {
    final fields = <Map<String, dynamic>>[];
    final methods = <Map<String, dynamic>>[];
    final constructorParams = <Map<String, dynamic>>[];

    for (final member in node.members) {
      if (member is FieldDeclaration) {
        final typeStr = member.fields.type?.toSource() ?? 'dynamic';
        for (final v in member.fields.variables) {
          fields.add({
            'name': v.name.lexeme,
            'type': typeStr,
            'isFinal': member.fields.isFinal,
            'isLate': member.fields.isLate,
            'isNullable': typeStr.endsWith('?'),
            'defaultValue': v.initializer?.toSource(),
          });
        }
      } else if (member is MethodDeclaration &&
          !member.isGetter &&
          !member.isSetter) {
        methods.add({
          'name': member.name.lexeme,
          'returnType': member.returnType?.toSource() ?? 'dynamic',
          'isAsync': member.body.isAsynchronous,
          'isStatic': member.isStatic,
          'params': _params(member.parameters),
        });
      } else if (member is ConstructorDeclaration &&
          constructorParams.isEmpty) {
        for (final p in member.parameters.parameters) {
          constructorParams.add(_paramEntry(p));
        }
      }
    }

    final mixins = <String>[];
    final withClause = node.withClause;
    if (withClause != null) {
      for (final m in withClause.mixinTypes) {
        mixins.add(m.toSource());
      }
    }

    // Dart 3 class modifiers — analyzer exposes each as an optional token.
    final modifiers = <String>[];
    if (node.abstractKeyword != null) modifiers.add('abstract');
    if (node.sealedKeyword != null) modifiers.add('sealed');
    if (node.baseKeyword != null) modifiers.add('base');
    if (node.finalKeyword != null) modifiers.add('final');
    if (node.interfaceKeyword != null) modifiers.add('interface');

    classes.add({
      'name': node.name.lexeme,
      'superclass': node.extendsClause?.superclass.toSource(),
      'mixins': mixins,
      'annotations':
          node.metadata.map((m) => m.name.name).toList(growable: false),
      'fields': fields,
      'methods': methods,
      'constructorParams': constructorParams,
      'filePath': filePath,
      if (modifiers.isNotEmpty) 'modifiers': modifiers,
    });

    super.visitClassDeclaration(node);
  }

  @override
  void visitEnumDeclaration(EnumDeclaration node) {
    enums.add({
      'name': node.name.lexeme,
      'values':
          node.constants.map((c) => c.name.lexeme).toList(growable: false),
    });
    super.visitEnumDeclaration(node);
  }

  List<Map<String, dynamic>> _params(FormalParameterList? list) {
    if (list == null) return const [];
    return list.parameters.map(_paramEntry).toList();
  }

  Map<String, dynamic> _paramEntry(FormalParameter p) {
    FormalParameter inner = p;
    if (inner is DefaultFormalParameter) {
      inner = inner.parameter;
    }
    String type = 'dynamic';
    String name = inner.name?.lexeme ?? '';
    String? defaultValue;
    if (p is DefaultFormalParameter) {
      defaultValue = p.defaultValue?.toSource();
    }
    if (inner is SimpleFormalParameter) {
      type = inner.type?.toSource() ?? 'dynamic';
    } else if (inner is FieldFormalParameter) {
      // `this.field` constructor parameter. If an explicit type is written
      // (rare), keep it; otherwise emit the `"this"` placeholder so the TS
      // side can resolve it against the parsed fields (same behavior as the
      // regex parser).
      type = inner.type?.toSource() ?? 'this';
    } else if (inner is FunctionTypedFormalParameter) {
      type = inner.returnType?.toSource() ?? 'Function';
    }
    return {
      'name': name,
      'type': type,
      'isRequired': p.isRequired || p.isRequiredNamed,
      'isNamed': p.isNamed,
      if (defaultValue != null) 'defaultValue': defaultValue,
    };
  }
}
