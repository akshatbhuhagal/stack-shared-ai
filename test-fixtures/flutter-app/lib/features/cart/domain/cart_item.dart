import 'package:freezed_annotation/freezed_annotation.dart';

part 'cart_item.freezed.dart';
part 'cart_item.g.dart';

@freezed
class CartItem with _$CartItem {
  const factory CartItem({
    required String id,
    required String productId,
    required int quantity,
    required double unitPrice,
  }) = _CartItem;

  factory CartItem.fromJson(Map<String, dynamic> json) => _$CartItemFromJson(json);
}

// Dart 3 sealed class — used for discriminated union state.
sealed class CartEvent {}

class CartItemAdded extends CartEvent {
  final String productId;
  CartItemAdded(this.productId);
}

class CartItemRemoved extends CartEvent {
  final String productId;
  CartItemRemoved(this.productId);
}

class CartCleared extends CartEvent {}

// Extension on an existing type
extension CartItemX on CartItem {
  double get total => unitPrice * quantity;
  bool get isFree => unitPrice == 0;
}

// Typedefs
typedef CartJson = Map<String, dynamic>;
typedef CartChangedCallback = void Function(CartItem item);
