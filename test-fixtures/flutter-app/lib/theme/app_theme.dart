import 'package:flutter/material.dart';

class AppColors {
  static const Color primary = Color(0xFF2563EB);
  static const Color secondary = Color(0xFF10B981);
  static const Color background = Color(0xFFF9FAFB);
  static const Color error = Color(0xFFEF4444);
}

const Color brandAccent = Color(0xFFF59E0B);

class AppTheme {
  static ThemeData get light => ThemeData(
        brightness: Brightness.light,
        colorScheme: ColorScheme.fromSeed(seedColor: AppColors.primary),
        primaryColor: AppColors.primary,
        useMaterial3: true,
      );

  static ThemeData get dark => ThemeData(
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: AppColors.primary,
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      );
}

class BrandSpacing extends ThemeExtension<BrandSpacing> {
  final double small;
  final double medium;
  final double large;

  const BrandSpacing({required this.small, required this.medium, required this.large});

  @override
  ThemeExtension<BrandSpacing> copyWith({double? small, double? medium, double? large}) {
    return BrandSpacing(
      small: small ?? this.small,
      medium: medium ?? this.medium,
      large: large ?? this.large,
    );
  }

  @override
  ThemeExtension<BrandSpacing> lerp(ThemeExtension<BrandSpacing>? other, double t) => this;
}
