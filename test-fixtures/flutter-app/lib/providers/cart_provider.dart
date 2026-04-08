import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/product.dart';

class CartItem {
  final Product product;
  final int quantity;
  CartItem({required this.product, required this.quantity});
}

class CartState {
  final List<CartItem> items;
  final double total;
  CartState({this.items = const [], this.total = 0});
}

class CartNotifier extends StateNotifier<CartState> {
  CartNotifier() : super(CartState());

  void addItem(Product product, int qty) {}
  void removeItem(String id) {}
  void clear() {}
}

final cartProvider = StateNotifierProvider<CartNotifier, CartState>(
  (ref) => CartNotifier(),
);
