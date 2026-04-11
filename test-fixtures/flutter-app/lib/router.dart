import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'screens/home_screen.dart';
import 'screens/product_list_screen.dart';
import 'screens/product_detail_screen.dart';
import 'screens/cart_screen.dart';

final router = GoRouter(
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomeScreen(),
    ),
    ShellRoute(
      builder: (context, state, child) => Scaffold(body: child),
      routes: [
        GoRoute(
          path: '/products',
          builder: (context, state) => const ProductListScreen(),
          routes: [
            GoRoute(
              path: ':id',
              builder: (context, state) => ProductDetailScreen(
                productId: state.pathParameters['id']!,
              ),
              routes: [
                GoRoute(
                  path: 'reviews',
                  builder: (context, state) => const ProductListScreen(),
                ),
              ],
            ),
          ],
        ),
        GoRoute(
          path: '/cart',
          builder: (context, state) => const CartScreen(),
          redirect: (context, state) => authGuard(context, state),
        ),
      ],
    ),
  ],
);
