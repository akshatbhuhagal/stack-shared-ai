import 'package:flutter/material.dart';
import '../../domain/cart_item.dart';

class CartRow extends StatelessWidget {
  final CartItem item;
  final VoidCallback? onRemove;

  const CartRow({super.key, required this.item, this.onRemove});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text(item.productId),
      subtitle: Text('Qty: ${item.quantity}'),
      trailing: IconButton(
        icon: const Icon(Icons.close),
        onPressed: onRemove,
      ),
    );
  }
}
