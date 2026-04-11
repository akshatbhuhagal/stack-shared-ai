import '../../domain/cart_item.dart';

abstract class CartRepository {
  Future<List<CartItem>> fetchCart();
  Future<void> addItem(String productId, int quantity);
  Future<void> removeItem(String productId);
  Future<void> clear();
}

class CartRepositoryImpl extends CartRepository {
  @override
  Future<List<CartItem>> fetchCart() async => [];

  @override
  Future<void> addItem(String productId, int quantity) async {}

  @override
  Future<void> removeItem(String productId) async {}

  @override
  Future<void> clear() async {}
}
